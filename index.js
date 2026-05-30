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
                    // Reconnect automatically immediately or with a small delay
                    setTimeout(connectToWhatsApp, 5000);
                } else if (isConflict) {
                    console.warn('[WhatsApp] Session replaced by another active instance (Render/Prod). Standing down locally to prevent conflict loops.');
                } else {
                    console.error('[WhatsApp] Logged out. Deleting credentials in Supabase to start fresh.');
                    await supabase.from('baileys_creds').delete().eq('session_id', SESSION_ID);
                    await supabase.from('baileys_keys').delete().eq('session_id', SESSION_ID);
                    setTimeout(connectToWhatsApp, 5000);
                }
            } else if (connection === 'open') {
                isConnected = true;
                qrCode = null;
                console.log(`[WhatsApp] Connection established successfully! Logged in as: ${sock.user.name || sock.user.id}`);
            }
        });

    } catch (err) {
        console.error('[WhatsApp] Critical error during initialization:', err);
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
        session_id: SESSION_ID,
        phone_user: sock?.user ? sock.user.id : null,
        qr: qrCode
    });
});

app.post('/send-pdf', async (req, res) => {
    const { fileName, phoneNumber, caption } = req.body;

    // 1. Validation
    if (!fileName || !phoneNumber) {
        return res.status(400).json({ 
            success: false, 
            message: 'Parámetros "fileName" y "phoneNumber" son requeridos.' 
        });
    }

    if (!isConnected || !sock) {
        return res.status(503).json({ 
            success: false, 
            message: 'El bot de WhatsApp no está conectado o inicializado.' 
        });
    }

    try {
        // Clean phone number (keep only digits)
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        if (cleanNumber.length < 8) {
            return res.status(400).json({ 
                success: false, 
                message: 'El número telefónico provisto es inválido o muy corto.' 
            });
        }
        
        const jid = `${cleanNumber}@s.whatsapp.net`;

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
        console.log(`[Webhook] Sending PDF to JID: ${jid}...`);
        const response = await sock.sendMessage(jid, {
            document: fileBuffer,
            mimetype: 'application/pdf',
            fileName: fileName,
            caption: caption || 'Adjunto el documento solicitado.'
        });

        console.log(`[Webhook] PDF successfully sent. Message ID: ${response.key.id}`);
        return res.status(200).json({
            success: true,
            message: 'Archivo enviado exitosamente.',
            messageId: response.key.id
        });

    } catch (err) {
        console.error('[Webhook] Error sending PDF:', err);
        return res.status(500).json({
            success: false,
            message: 'Error interno del servidor al procesar y enviar el archivo.',
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

// Start Express Server & WhatsApp Connection
app.listen(PORT, () => {
    console.log(`[Server] Webhook server running on port: ${PORT}`);
    connectToWhatsApp();
});
