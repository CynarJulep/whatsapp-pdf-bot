require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
// Polyfill WebSocket for Supabase in Node.js environments
global.WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
const { 
    default: makeWASocket, 
    DisconnectReason, 
    BufferJSON, 
    initAuthCreds 
} = require('@whiskeysockets/baileys');

// Initialize Express App
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SESSION_ID = process.env.SESSION_ID || 'pai';
const MOCK_CONNECTION = process.env.MOCK_CONNECTION === 'true';
const STANDDOWN_ON_CONFLICT = process.env.STANDDOWN_ON_CONFLICT === 'true';
const RECONNECT_WATCHDOG_MS = Number(process.env.RECONNECT_WATCHDOG_MS || 30000);

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("CRITICAL ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables are missing.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Global state variables
let sock = null;
let isConnected = false;
let isConnecting = false;
let qrCode = null;

/**
 * Custom Supabase Auth State Provider for Baileys
 * Synchronizes creds and keys in real-time to Supabase database.
 */
async function useSupabaseAuthState(supabase, sessionId) {
    let creds;

    // 1. Fetch credentials
    const { data: dbCreds, error: credsError } = await supabase
        .from('baileys_creds')
        .select('creds')
        .eq('session_id', sessionId)
        .single();

    if (credsError || !dbCreds) {
        console.log(`[Supabase Auth] No existing credentials found for session "${sessionId}". Creating new.`);
        creds = initAuthCreds();
    } else {
        console.log(`[Supabase Auth] Loaded credentials for session "${sessionId}" from Supabase.`);
        creds = JSON.parse(JSON.stringify(dbCreds.creds), BufferJSON.reviver);
    }

    const saveCreds = async () => {
        const { error } = await supabase
            .from('baileys_creds')
            .upsert({
                session_id: sessionId,
                creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
                updated_at: new Date().toISOString()
            });

        if (error) {
            console.error('[Supabase Auth] Error saving credentials:', error);
        }
    };

    const keys = {
        get: async (type, ids) => {
            const data = {};
            const { data: dbKeys, error } = await supabase
                .from('baileys_keys')
                .select('key_id, data')
                .eq('session_id', sessionId)
                .eq('key_type', type)
                .in('key_id', ids);

            if (error) {
                console.error(`[Supabase Auth] Error getting keys of type "${type}":`, error);
                return data;
            }

            if (dbKeys) {
                for (const row of dbKeys) {
                    if (row.data) {
                        data[row.key_id] = JSON.parse(JSON.stringify(row.data), BufferJSON.reviver);
                    }
                }
            }
            return data;
        },
        set: async (data) => {
            const toUpsert = [];
            const toDelete = [];

            for (const type of Object.keys(data)) {
                for (const id of Object.keys(data[type])) {
                    const value = data[type][id];
                    if (value) {
                        toUpsert.push({
                            session_id: sessionId,
                            key_type: type,
                            key_id: id,
                            data: JSON.parse(JSON.stringify(value, BufferJSON.replacer)),
                            updated_at: new Date().toISOString()
                        });
                    } else {
                        toDelete.push({ type, id });
                    }
                }
            }

            const promises = [];

            if (toUpsert.length > 0) {
                promises.push(
                    supabase
                        .from('baileys_keys')
                        .upsert(toUpsert, { onConflict: 'session_id,key_type,key_id' })
                );
            }

            for (const item of toDelete) {
                promises.push(
                    supabase
                        .from('baileys_keys')
                        .delete()
                        .eq('session_id', sessionId)
                        .eq('key_type', item.type)
                        .eq('key_id', item.id)
                );
            }
            
            const results = await Promise.all(promises);
            for (const res of results) {
                if (res.error) {
                    console.error('[Supabase Auth] Error writing/deleting keys:', res.error);
                }
            }
        }
    };

    return {
        state: {
            creds,
            keys
        },
        saveCreds
    };
}

/**
 * Initialize WhatsApp Baileys Connection
 */
async function connectToWhatsApp() {
    if (MOCK_CONNECTION) {
        console.log('[WhatsApp] Running in MOCK_CONNECTION mode. WhatsApp connection simulated.');
        isConnected = true;
        isConnecting = false;
        qrCode = null;
        return;
    }
    isConnecting = true;
    try {
        // Cleanup existing socket if any to prevent duplicate instances
        if (sock) {
            console.log('[WhatsApp] Cleaning up existing socket before reconnecting...');
            try {
                sock.ev.removeAllListeners();
                sock.end();
            } catch (err) {
                console.error('[WhatsApp] Error ending previous socket:', err);
            }
            sock = null;
        }

        console.log(`[WhatsApp] Connecting session: ${SESSION_ID}...`);
        const { state, saveCreds } = await useSupabaseAuthState(supabase, SESSION_ID);

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false, // We print it manually to have full control
            logger: pino({ level: 'info' }),
            browser: ['Windows', 'Chrome', '122.0.0.0']
        });

        // Sync credentials whenever update is fired
        sock.ev.on('creds.update', saveCreds);

        // Connection update listener
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                qrCode = qr;
                isConnecting = false;
                console.log('\n--- ESCANEA ESTE CÓDIGO QR CON WHATSAPP BUSINESS ---');
                qrcode.generate(qr, { small: true });
                console.log('-----------------------------------------------------\n');
            }

            if (connection === 'close') {
                isConnected = false;
                qrCode = null;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                
                // If it is a conflict (session replaced), do not auto-reconnect to avoid infinite loop
                const isConflict = statusCode === 440 || lastDisconnect?.error?.message?.includes('conflict');
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !isConflict;
                
                console.warn(`[WhatsApp] Connection closed. Status Code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

                if (shouldReconnect) {
                    isConnecting = true;
                    setTimeout(connectToWhatsApp, 5000);
                } else if (isConflict) {
                    qrCode = null;
                    if (STANDDOWN_ON_CONFLICT) {
                        isConnecting = false;
                        console.warn('[WhatsApp] Session conflict. Standing down (STANDDOWN_ON_CONFLICT=true).');
                    } else {
                        console.warn('[WhatsApp] Session conflict. Clearing socket and reconnecting for a fresh QR...');
                        isConnecting = true;
                        if (sock) {
                            try { sock.end(); } catch (_) { /* ignore */ }
                            sock = null;
                        }
                        setTimeout(connectToWhatsApp, 5000);
                    }
                } else {
                    isConnecting = true;
                    console.error('[WhatsApp] Logged out. Deleting credentials in Supabase to start fresh.');
                    await supabase.from('baileys_creds').delete().eq('session_id', SESSION_ID);
                    await supabase.from('baileys_keys').delete().eq('session_id', SESSION_ID);
                    setTimeout(connectToWhatsApp, 5000);
                }
            } else if (connection === 'open') {
                isConnected = true;
                isConnecting = false;
                qrCode = null;
                console.log(`[WhatsApp] Connection established successfully! Logged in as: ${sock.user.name || sock.user.id}`);
            }
        });

    } catch (err) {
        console.error('[WhatsApp] Critical error during initialization:', err);
        isConnecting = false;
        setTimeout(connectToWhatsApp, 10000); // retry after 10s
    }
}

// ----------------------------------------------------
// Keep-Alive Ping (Runs every 6 hours)
// ----------------------------------------------------
setInterval(async () => {
    try {
        if (isConnected && sock && sock.user) {
            // Get own JID (format is: phone_number@s.whatsapp.net)
            const ownNumber = sock.user.id.split(':')[0];
            const ownJid = `${ownNumber}@s.whatsapp.net`;
            
            console.log(`[Keep-Alive] Sending self-ping to ${ownJid}`);
            await sock.sendMessage(ownJid, { 
                text: `🤖 *Ping de Mantenimiento Keep-Alive*\n\nStatus: Activo\nFecha: ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}` 
            });
        } else {
            console.warn('[Keep-Alive] Skipped. WhatsApp client is not connected.');
        }
    } catch (err) {
        console.error('[Keep-Alive] Error sending self-ping:', err);
    }
}, 6 * 60 * 60 * 1000); // 6 hours

// ----------------------------------------------------
// Express Endpoint Webhook
// ----------------------------------------------------

// Health Check Endpoint
app.get('/status', (req, res) => {
    res.status(200).json({
        success: true,
        connected: isConnected,
        connecting: isConnecting,
        session_id: SESSION_ID,
        phone_user: isConnected
            ? (MOCK_CONNECTION ? '549342555555:12@s.whatsapp.net' : (sock?.user?.id || null))
            : null,
        qr: qrCode,
        stalled: !isConnected && !isConnecting && !qrCode
    });
});

// Endpoint to list all WhatsApp groups the bot is part of
app.get('/groups', async (req, res) => {
    if (MOCK_CONNECTION) {
        return res.status(200).json({
            success: true,
            groups: [
                { id: '120363000000000001@g.us', name: 'Grupo de Prueba 1 (MOCK)' },
                { id: '120363000000000002@g.us', name: 'Obras Públicas (MOCK)' },
                { id: '120363000000000003@g.us', name: 'Alumbrado Municipal (MOCK)' },
            ]
        });
    }

    if (!isConnected || !sock) {
        return res.status(503).json({
            success: false,
            message: 'El bot de WhatsApp no está conectado.'
        });
    }

    try {
        const groupsMap = await sock.groupFetchAllParticipating();
        const groups = Object.values(groupsMap).map(g => ({
            id: g.id,
            name: g.subject
        }));
        return res.status(200).json({ success: true, groups });
    } catch (err) {
        console.error('[Groups] Error fetching groups:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al obtener los grupos de WhatsApp.',
            error: err.message
        });
    }
});

async function logShipment(record) {
    const optionalFields = ['file_name', 'usuario_carga'];
    let payload = { ...record };

    let { error } = await supabase.from('shipments').insert(payload);
    for (const field of optionalFields) {
        if (error && Object.prototype.hasOwnProperty.call(payload, field)) {
            const nextPayload = { ...payload };
            delete nextPayload[field];
            payload = nextPayload;
            ({ error } = await supabase.from('shipments').insert(payload));
        }
    }

    if (error) {
        console.error('[Webhook] Error logging shipment to database:', error);
    }
}

function shipmentContactPhone({ isGroup, cleanNumber, groupJid, phoneNumber }) {
    if (isGroup) return groupJid || 'grupo';
    if (cleanNumber) return cleanNumber;
    if (phoneNumber) return phoneNumber.replace(/[^0-9]/g, '') || 'desconocido';
    return 'desconocido';
}

app.post('/send-pdf', async (req, res) => {
    const { fileName, phoneNumber, groupJid, caption, contactName, solicitudNro, subtipo, displayName, isGroup, usuarioCarga } = req.body;

    // 1. Validation
    if (!fileName || (!phoneNumber && !groupJid)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Parámetros "fileName" y ("phoneNumber" o "groupJid") son requeridos.' 
        });
    }

    if (!isConnected || (!sock && !MOCK_CONNECTION)) {
        return res.status(503).json({ 
            success: false, 
            message: 'El bot de WhatsApp no está conectado o inicializado.' 
        });
    }

    try {
        let jid;
        let cleanNumber = '';

        if (isGroup && groupJid) {
            // Group message: use the group JID directly (format: XXXXX@g.us)
            jid = groupJid;
        } else {
            // Individual contact: build JID from phone number
            cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
            if (cleanNumber.length < 8) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'El número telefónico provisto es inválido o muy corto.' 
                });
            }
            jid = `${cleanNumber}@s.whatsapp.net`;
        }

        // 2. Anti-ban Random Delay (2 to 5 seconds)
        const delayMs = Math.floor(Math.random() * (5000 - 2000 + 1)) + 2000;
        console.log(`[Webhook] Queueing PDF delivery. Delaying for ${delayMs}ms (Anti-ban)...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));

        // 3. Download the PDF from Supabase Storage
        console.log(`[Webhook] Downloading "${fileName}" from Supabase Storage bucket "pdfs"...`);
        const { data: storageBlob, error: downloadError } = await supabase.storage
            .from('pdfs')
            .download(fileName);

        if (downloadError || !storageBlob) {
            console.error('[Webhook] Supabase storage download error:', downloadError);
            return res.status(500).json({ 
                success: false, 
                message: `Error al descargar el archivo de Supabase: ${downloadError?.message || 'Archivo no encontrado'}` 
            });
        }

        // Convert Blob to Node Buffer
        const arrayBuffer = await storageBlob.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);

        // 4. Send Document using Baileys
        let response;
        if (MOCK_CONNECTION) {
            console.log(`[Webhook] [MOCK] Simulating sending PDF to JID: ${jid}...`);
            await new Promise(resolve => setTimeout(resolve, 1500)); // simulate delay
            response = { key: { id: `MOCK_${Date.now()}` } };
        } else {
            console.log(`[Webhook] Sending PDF to JID: ${jid}...`);
            response = await sock.sendMessage(jid, {
                document: fileBuffer,
                mimetype: 'application/pdf',
                fileName: displayName || fileName,
                caption: caption || 'Adjunto el documento solicitado.'
            });
        }

        console.log(`[Webhook] PDF successfully sent. Message ID: ${response.key.id}`);

        // Log successful shipment to database
        await logShipment({
            contact_name: contactName || (isGroup ? 'Grupo' : 'Desconocido'),
            contact_phone: shipmentContactPhone({ isGroup, cleanNumber, groupJid, phoneNumber }),
            solicitud_nro: solicitudNro || null,
            subtipo: subtipo || null,
            file_name: displayName || fileName || null,
            usuario_carga: usuarioCarga || null,
            status: 'success',
            message_text: caption || 'Adjunto el documento solicitado.',
            is_group: !!isGroup,
            group_jid: isGroup ? groupJid : null
        });

        return res.status(200).json({
            success: true,
            message: 'Archivo enviado exitosamente.',
            messageId: response.key.id
        });

    } catch (err) {
        console.error('[Webhook] Error sending PDF:', err);

        // Log failed shipment to database
        const failCleanNumber = (!isGroup && phoneNumber) ? phoneNumber.replace(/[^0-9]/g, '') : '';
        await logShipment({
            contact_name: contactName || (isGroup ? 'Grupo' : 'Desconocido'),
            contact_phone: shipmentContactPhone({ isGroup, cleanNumber: failCleanNumber, groupJid, phoneNumber }),
            solicitud_nro: solicitudNro || null,
            subtipo: subtipo || null,
            file_name: displayName || fileName || null,
            usuario_carga: usuarioCarga || null,
            status: 'failed',
            message_text: caption || 'Adjunto el documento solicitado.',
            is_group: !!isGroup,
            group_jid: isGroup ? groupJid : null
        });

        return res.status(500).json({
            success: false,
            message: 'Error interno del servidor al procesar y enviar el archivo.',
            error: err.message
        });
    }
});

// Force a fresh WhatsApp connection attempt (keeps credentials unless a QR is needed)
app.post('/reconnect', async (req, res) => {
    console.log(`[WhatsApp] Manual reconnect requested for session: ${SESSION_ID}`);
    if (MOCK_CONNECTION) {
        isConnected = false;
        isConnecting = true;
        setTimeout(() => {
            isConnected = true;
            isConnecting = false;
        }, 2000);
        return res.status(200).json({ success: true, message: 'Reconexión simulada iniciada.' });
    }

    qrCode = null;
    isConnected = false;
    isConnecting = true;
    if (sock) {
        try { sock.ev.removeAllListeners(); sock.end(); } catch (_) { /* ignore */ }
        sock = null;
    }
    setTimeout(connectToWhatsApp, 1000);
    return res.status(200).json({ success: true, message: 'Reconexión iniciada.' });
});

// Endpoint to completely disconnect WhatsApp session and clear credentials
app.post('/disconnect', async (req, res) => {
    console.log(`[WhatsApp] Disconnecting session: ${SESSION_ID} requested by client...`);
    if (MOCK_CONNECTION) {
        isConnected = false;
        isConnecting = true;
        setTimeout(() => {
            isConnected = true;
            isConnecting = false;
        }, 3000);
        return res.status(200).json({
            success: true,
            message: 'Desconectado y reconectado en modo simulación exitosamente.'
        });
    }
    try {
        // 1. Delete credentials and keys from Supabase
        const { error: errCreds } = await supabase
            .from('baileys_creds')
            .delete()
            .eq('session_id', SESSION_ID);
        
        const { error: errKeys } = await supabase
            .from('baileys_keys')
            .delete()
            .eq('session_id', SESSION_ID);

        if (errCreds || errKeys) {
            console.error('[WhatsApp] Error deleting credentials from Supabase:', errCreds || errKeys);
        }

        // 2. Terminate the WhatsApp Socket connection and logout cleanly
        isConnected = false;
        isConnecting = true;
        qrCode = null;
        if (sock) {
            try {
                await sock.logout();
            } catch (logoutErr) {
                console.warn('[WhatsApp] Error logging out socket (might already be closed):', logoutErr);
                try {
                    sock.end();
                } catch (endErr) {
                    console.error('[WhatsApp] Error ending socket:', endErr);
                }
            }
            sock = null;
        }

        // 3. Trigger reconnection to start fresh with a new QR code immediately
        setTimeout(connectToWhatsApp, 3000);

        return res.status(200).json({
            success: true,
            message: 'Desconectado y credenciales borradas exitosamente.'
        });
    } catch (err) {
        console.error('[WhatsApp] Error during disconnect:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al desconectar el bot de WhatsApp.',
            error: err.message
        });
    }
});

// Process Error Handlers to keep the bot alive
process.on('uncaughtException', (err) => {
    console.error('[System Alert] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[System Alert] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Recover from zombie states where the socket died but nothing is reconnecting
setInterval(() => {
    if (MOCK_CONNECTION || isConnected || isConnecting || qrCode) return;
    console.warn('[WhatsApp] Watchdog: disconnected with no QR and not connecting. Triggering reconnect...');
    isConnecting = true;
    connectToWhatsApp();
}, RECONNECT_WATCHDOG_MS);

// Start Express Server & WhatsApp Connection
app.listen(PORT, () => {
    console.log(`[Server] Webhook server running on port: ${PORT}`);
    connectToWhatsApp();
});
