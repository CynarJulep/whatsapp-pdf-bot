require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
// Polyfill WebSocket for Supabase in Node.js environments
global.WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
const { runSacSingleClaimFetch } = require('./services/sacAutomation');
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
const SAC_USER = process.env.SAC_USER || '';
const SAC_PASSWORD = process.env.SAC_PASSWORD || '';
const SAC_AUTOMATION_TOKEN = process.env.SAC_AUTOMATION_TOKEN || '';
const SAC_MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.SAC_MAX_CONCURRENT_JOBS || 1));
const SAC_JOB_STALE_MS = Math.max(60000, Number(process.env.SAC_JOB_STALE_MS || 8 * 60 * 1000));

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
let reconnectTimer = null;
let socketSequence = 0;
const sacJobsCache = new Map();
const sacJobQueue = [];
let activeSacJobs = 0;

function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
}

function scheduleReconnect(delayMs, reason) {
    if (reconnectTimer) {
        console.log(`[WhatsApp] Reconnect already scheduled. Keeping existing timer (${reason}).`);
        return;
    }
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectToWhatsApp();
    }, delayMs);
}

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
        clearReconnectTimer();
        return;
    }
    clearReconnectTimer();
    isConnecting = true;
    try {
        // Cleanup existing socket if any to prevent duplicate instances
        if (sock) {
            console.log('[WhatsApp] Cleaning up existing socket before reconnecting...');
            const previousSock = sock;
            sock = null;
            try {
                previousSock.ev.removeAllListeners();
                previousSock.end();
            } catch (err) {
                console.error('[WhatsApp] Error ending previous socket:', err);
            }
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
        const socketRef = sock;
        const socketId = ++socketSequence;

        // Connection update listener
        sock.ev.on('connection.update', async (update) => {
            if (sock !== socketRef) {
                // Ignore stale socket events that can otherwise trigger reconnect loops.
                return;
            }
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
                
                console.warn(`[WhatsApp] Connection #${socketId} closed. Status Code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

                if (shouldReconnect) {
                    isConnecting = true;
                    scheduleReconnect(5000, `close-${socketId}`);
                } else if (isConflict) {
                    qrCode = null;
                    if (STANDDOWN_ON_CONFLICT) {
                        isConnecting = false;
                        console.warn('[WhatsApp] Session conflict. Standing down (STANDDOWN_ON_CONFLICT=true).');
                    } else {
                        console.warn('[WhatsApp] Session conflict. Clearing socket and reconnecting for a fresh QR...');
                        isConnecting = true;
                        if (sock === socketRef) {
                            try { socketRef.end(); } catch (_) { /* ignore */ }
                            sock = null;
                        }
                        scheduleReconnect(5000, `conflict-${socketId}`);
                    }
                } else {
                    isConnecting = true;
                    console.error('[WhatsApp] Logged out. Deleting credentials in Supabase to start fresh.');
                    await supabase.from('baileys_creds').delete().eq('session_id', SESSION_ID);
                    await supabase.from('baileys_keys').delete().eq('session_id', SESSION_ID);
                    if (sock === socketRef) {
                        sock = null;
                    }
                    scheduleReconnect(5000, `loggedout-${socketId}`);
                }
            } else if (connection === 'open') {
                isConnected = true;
                isConnecting = false;
                qrCode = null;
                clearReconnectTimer();
                console.log(`[WhatsApp] Connection established successfully! Logged in as: ${sock.user.name || sock.user.id}`);
            }
        });

    } catch (err) {
        console.error('[WhatsApp] Critical error during initialization:', err);
        isConnecting = false;
        scheduleReconnect(10000, 'critical-init'); // retry after 10s
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
        mock_connection: MOCK_CONNECTION,
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

function sanitizeClaimValue(value) {
    return String(value || '').trim().replace(/[^0-9-]/g, '');
}

function sanitizeStorageSegment(value) {
    return String(value || '')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 100);
}

function isSacAuthAllowed(req) {
    if (!SAC_AUTOMATION_TOKEN) return true;
    const token = req.headers['x-sac-automation-token'];
    return typeof token === 'string' && token === SAC_AUTOMATION_TOKEN;
}

function slimSacJob(job) {
    if (!job) return null;
    return {
        id: job.id,
        numeroReclamo: job.numero_reclamo,
        anio: job.anio,
        status: job.status,
        errorMessage: job.error_message || null,
        storagePath: job.storage_path || null,
        fileName: job.file_name || null,
        publicUrl: job.public_url || null,
        createdAt: job.created_at || null,
        startedAt: job.started_at || null,
        finishedAt: job.finished_at || null
    };
}

async function insertSacJob(job) {
    sacJobsCache.set(job.id, job);
    const { error } = await supabase.from('sac_jobs').insert(job);
    if (error) {
        console.warn('[SAC] No se pudo insertar sac_jobs en Supabase. Se mantiene en caché temporal.', error.message);
    }
}

async function updateSacJob(jobId, patch) {
    const current = sacJobsCache.get(jobId);
    if (current) {
        sacJobsCache.set(jobId, { ...current, ...patch });
    }
    const { error } = await supabase.from('sac_jobs').update(patch).eq('id', jobId);
    if (error) {
        console.warn('[SAC] No se pudo actualizar sac_jobs en Supabase. Se mantiene en caché temporal.', error.message);
    }
}

async function getSacJobById(jobId) {
    const cached = sacJobsCache.get(jobId);
    if (cached) return cached;
    const { data } = await supabase.from('sac_jobs').select('*').eq('id', jobId).maybeSingle();
    if (data) {
        sacJobsCache.set(jobId, data);
        return data;
    }
    return null;
}

function getSacJobReferenceTime(job) {
    const started = Date.parse(job?.started_at || '');
    if (!Number.isNaN(started) && started > 0) return started;
    const created = Date.parse(job?.created_at || '');
    if (!Number.isNaN(created) && created > 0) return created;
    return Date.now();
}

async function markSacJobAsStale(job) {
    if (!job) return;
    const message = `Job SAC vencido por timeout (${Math.round(SAC_JOB_STALE_MS / 60000)} min). Se reinicia automáticamente.`;
    const patch = {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: message
    };
    await updateSacJob(job.id, patch);
    sacJobsCache.set(job.id, { ...job, ...patch });
    console.warn(`[SAC] Job ${job.id} marcado como stale. ${message}`);
}

async function normalizeRunningSacJob(job) {
    if (!job) return null;
    if (job.status !== 'queued' && job.status !== 'running') return null;
    const ageMs = Date.now() - getSacJobReferenceTime(job);
    if (ageMs <= SAC_JOB_STALE_MS) {
        return job;
    }
    await markSacJobAsStale(job);
    return null;
}

async function findRunningSacJob(numeroReclamo, anio) {
    for (const job of sacJobsCache.values()) {
        if (
            job.numero_reclamo === numeroReclamo &&
            job.anio === anio &&
            (job.status === 'queued' || job.status === 'running')
        ) {
            const normalized = await normalizeRunningSacJob(job);
            if (normalized) return normalized;
        }
    }
    const { data } = await supabase
        .from('sac_jobs')
        .select('*')
        .eq('numero_reclamo', numeroReclamo)
        .eq('anio', anio)
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (data) {
        sacJobsCache.set(data.id, data);
        const normalized = await normalizeRunningSacJob(data);
        if (normalized) return normalized;
    }
    return null;
}

function enqueueSacJob(jobId) {
    sacJobQueue.push(jobId);
    void processSacQueue();
}

async function processSacQueue() {
    if (activeSacJobs >= SAC_MAX_CONCURRENT_JOBS) return;
    const nextJobId = sacJobQueue.shift();
    if (!nextJobId) return;
    activeSacJobs += 1;

    try {
        await processSacJob(nextJobId);
    } finally {
        activeSacJobs = Math.max(0, activeSacJobs - 1);
        if (sacJobQueue.length > 0) {
            void processSacQueue();
        }
    }
}

async function processSacJob(jobId) {
    const current = await getSacJobById(jobId);
    if (!current) return;

    const startedAt = new Date().toISOString();
    await updateSacJob(jobId, { status: 'running', started_at: startedAt, error_message: null });

    try {
        const { pdfBuffer, suggestedFileName } = await runSacSingleClaimFetch({
            numeroReclamo: current.numero_reclamo,
            anio: current.anio,
            usuario: SAC_USER,
            contrasena: SAC_PASSWORD
        });

        const safeNumber = sanitizeStorageSegment(current.numero_reclamo);
        const safeName = sanitizeStorageSegment(suggestedFileName || `${safeNumber}_${current.anio}.pdf`);
        const storagePath = `sac/${current.anio}/${Date.now()}_${safeName}`;

        const { error: uploadError } = await supabase.storage
            .from('pdfs')
            .upload(storagePath, pdfBuffer, {
                contentType: 'application/pdf',
                upsert: false
            });

        if (uploadError) {
            throw new Error(`No se pudo subir el PDF a Storage: ${uploadError.message}`);
        }

        const { data: publicData } = supabase.storage.from('pdfs').getPublicUrl(storagePath);
        await updateSacJob(jobId, {
            status: 'ready',
            finished_at: new Date().toISOString(),
            storage_path: storagePath,
            file_name: suggestedFileName || `${safeNumber}_${current.anio}.pdf`,
            public_url: publicData?.publicUrl || null
        });
    } catch (error) {
        await updateSacJob(jobId, {
            status: 'failed',
            finished_at: new Date().toISOString(),
            error_message: error?.message || 'Error desconocido al descargar reclamo SAC'
        });
    }
}

app.post('/sac/fetch-single-claim', async (req, res) => {
    if (!isSacAuthAllowed(req)) {
        return res.status(401).json({
            success: false,
            message: 'No autorizado para ejecutar automatización SAC.'
        });
    }

    const numeroReclamo = sanitizeClaimValue(req.body?.numeroReclamo);
    const rawAnio = req.body?.anio;
    const anio = Number(rawAnio || 2026);

    if (!numeroReclamo) {
        return res.status(400).json({
            success: false,
            message: 'El campo "numeroReclamo" es obligatorio.'
        });
    }

    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
        return res.status(400).json({
            success: false,
            message: 'El campo "anio" debe ser un número válido.'
        });
    }

    if (!SAC_USER || !SAC_PASSWORD) {
        return res.status(500).json({
            success: false,
            message: 'Faltan SAC_USER y/o SAC_PASSWORD en variables de entorno del backend.'
        });
    }

    try {
        const existingJob = await findRunningSacJob(numeroReclamo, anio);
        if (existingJob) {
            return res.status(200).json({
                success: true,
                reused: true,
                job: slimSacJob(existingJob)
            });
        }

        const nowIso = new Date().toISOString();
        const job = {
            id: `sac_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            numero_reclamo: numeroReclamo,
            anio,
            status: 'queued',
            error_message: null,
            storage_path: null,
            file_name: null,
            public_url: null,
            created_at: nowIso,
            started_at: null,
            finished_at: null
        };

        await insertSacJob(job);
        enqueueSacJob(job.id);

        return res.status(202).json({
            success: true,
            message: 'Búsqueda de reclamo encolada.',
            job: slimSacJob(job)
        });
    } catch (error) {
        console.error('[SAC] Error al crear job:', error);
        return res.status(500).json({
            success: false,
            message: 'No se pudo iniciar la búsqueda del reclamo SAC.',
            error: error.message
        });
    }
});

app.get('/sac/jobs/:jobId', async (req, res) => {
    if (!isSacAuthAllowed(req)) {
        return res.status(401).json({
            success: false,
            message: 'No autorizado para consultar jobs SAC.'
        });
    }

    try {
        const job = await getSacJobById(req.params.jobId);
        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Job SAC no encontrado.'
            });
        }
        return res.status(200).json({
            success: true,
            job: slimSacJob(job)
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'No se pudo consultar el job SAC.',
            error: error.message
        });
    }
});

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
            message: MOCK_CONNECTION
                ? 'Simulación: el archivo NO se envió por WhatsApp (MOCK_CONNECTION=true).'
                : 'Archivo enviado exitosamente.',
            messageId: response.key.id,
            mock: MOCK_CONNECTION
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
