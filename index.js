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
    initAuthCreds,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');

// Initialize Express App
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SESSION_ID = process.env.SESSION_ID || 'pai';
const MOCK_CONNECTION = process.env.MOCK_CONNECTION === 'true';
const BOT_API_KEY = process.env.BOT_API_KEY || '';
const STANDDOWN_ON_CONFLICT = process.env.STANDDOWN_ON_CONFLICT === 'true';
const RECONNECT_WATCHDOG_MS = Number(process.env.RECONNECT_WATCHDOG_MS || 30000);

/**
 * Baileys devuelve messageId antes del ACK real de WhatsApp.
 * El error 463 (cuenta restringida / falta tctoken) llega async en messages.update.
 * Esperamos un momento para no reportar "enviado" falso.
 */
function waitForOutboundMessageResult(activeSock, messageId, timeoutMs = 10000) {
    return new Promise((resolve) => {
        if (!activeSock || !messageId) {
            resolve({ ok: true, reason: 'skipped' });
            return;
        }

        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                activeSock.ev.off('messages.update', onUpdate);
            } catch (_) {
                /* ignore */
            }
            resolve(result);
        };

        const timer = setTimeout(() => {
            // Sin ERROR en la ventana → asumimos aceptación del servidor
            finish({ ok: true, reason: 'timeout-no-error' });
        }, timeoutMs);

        const onUpdate = (updates) => {
            if (!Array.isArray(updates)) return;
            for (const u of updates) {
                if (u?.key?.id !== messageId) continue;
                const status = u?.update?.status;
                const stubs = Array.isArray(u?.update?.messageStubParameters)
                    ? u.update.messageStubParameters.map(String)
                    : [];
                const stubText = stubs.join(' ');
                const isError =
                    status === 0 ||
                    status === 'ERROR' ||
                    stubs.includes('463') ||
                    /463|restricted|tctoken/i.test(stubText);

                if (isError) {
                    const code =
                        stubs.includes('463') || /463/.test(stubText)
                            ? 'ACCOUNT_RESTRICTED'
                            : 'DELIVERY_ERROR';
                    finish({ ok: false, code, stubs, status });
                    return;
                }

                // SERVER_ACK / DELIVERY_ACK / READ / PLAYED
                if (status === 2 || status === 3 || status === 4 || status === 5) {
                    finish({ ok: true, reason: 'acked', status });
                    return;
                }
            }
        };

        activeSock.ev.on('messages.update', onUpdate);
    });
}

/** If BOT_API_KEY is set, require matching x-api-key header. If unset, allow (local/dev). */
function requireApiKey(req, res, next) {
    if (!BOT_API_KEY) return next();
    const key = req.headers['x-api-key'];
    if (!key || key !== BOT_API_KEY) {
        return res.status(401).json({
            success: false,
            message: 'API key inválida o ausente (header x-api-key).'
        });
    }
    return next();
}
// Cache WA Web version to avoid hammering the version endpoint during reconnect storms.
// Default 1h (was 6h): shorter cache recovers faster when WhatsApp rolls protocol versions.
const WA_VERSION_CACHE_MS = Math.max(5 * 60 * 1000, Number(process.env.WA_VERSION_CACHE_MS || 60 * 60 * 1000));
// Proactive version refresh while connected (default every 45 min).
const WA_VERSION_PROACTIVE_REFRESH_MS = Math.max(
    10 * 60 * 1000,
    Number(process.env.WA_VERSION_PROACTIVE_REFRESH_MS || 45 * 60 * 1000)
);
const SAC_USER = process.env.SAC_USER || '';
const SAC_PASSWORD = process.env.SAC_PASSWORD || '';
const SAC_AUTOMATION_TOKEN = process.env.SAC_AUTOMATION_TOKEN || '';
const SAC_FEATURE_ENABLED = process.env.SAC_FEATURE_ENABLED === 'true';
const SAC_PROCESS_JOBS = process.env.SAC_PROCESS_JOBS !== 'false';
const SAC_MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.SAC_MAX_CONCURRENT_JOBS || 1));
const SAC_JOB_STALE_MS = Math.max(60000, Number(process.env.SAC_JOB_STALE_MS || 8 * 60 * 1000));
const SAC_SIGNED_URL_TTL_SEC = Math.max(60, Number(process.env.SAC_SIGNED_URL_TTL_SEC || 15 * 60));
const SAC_SESSION_STATE_ID = process.env.SAC_SESSION_STATE_ID || 'default';
let runSacSingleClaimFetch = null;
let waVersionProactiveTimer = null;
let coldStartVersionForced = false;

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
let consecutiveFailures = 0;
let lastDisconnectCode = null;
let lastDisconnectAt = null;
let connectingStartedAt = null;
let cachedWaVersion = null;
let cachedWaVersionAt = 0;
let cachedWaVersionIsLatest = false;
const sacJobsCache = new Map();
const sacJobQueue = [];
let activeSacJobs = 0;

/**
 * Resolve current WhatsApp Web protocol version.
 * Uses a short/medium cache for normal reconnects, and force-refreshes after 405
 * (client_too_old) so pairing recovers without manual intervention.
 */
async function resolveWaWebVersion({ force = false } = {}) {
    const cacheAgeMs = Date.now() - cachedWaVersionAt;
    const cacheFresh = cachedWaVersion && cacheAgeMs < WA_VERSION_CACHE_MS;
    if (!force && cacheFresh) {
        return {
            version: cachedWaVersion,
            isLatest: cachedWaVersionIsLatest,
            fromCache: true,
            cacheAgeMs
        };
    }

    try {
        const { version, isLatest } = await fetchLatestBaileysVersion();
        cachedWaVersion = version;
        cachedWaVersionIsLatest = !!isLatest;
        cachedWaVersionAt = Date.now();
        return {
            version,
            isLatest: !!isLatest,
            fromCache: false,
            cacheAgeMs: 0
        };
    } catch (err) {
        console.warn('[WhatsApp] Failed to fetch latest WA version:', err.message || err);
        if (cachedWaVersion) {
            return {
                version: cachedWaVersion,
                isLatest: cachedWaVersionIsLatest,
                fromCache: true,
                cacheAgeMs,
                fetchError: true
            };
        }
        throw err;
    }
}

function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
}

function getReconnectDelayMs(statusCode) {
    // After a successful QR/pairing scan, WA closes with restartRequired (515).
    // Reconnect immediately so the phone finishes linking; a long delay causes
    // "No se pudo vincular el dispositivo. Vuelve a intentarlo más tarde".
    if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
        return 300;
    }
    // 405 = client_too_old / rejected handshake. Back off hard to avoid storming WA.
    if (statusCode === 405) {
        return Math.min(120000, 15000 * Math.max(1, consecutiveFailures));
    }
    // 408 = QR refs exhausted / request timeout — brief pause then fresh QR
    if (statusCode === 408) {
        return 2000;
    }
    return Math.min(60000, 5000 * Math.max(1, consecutiveFailures));
}

/** Status codes that usually mean the WA Web version / handshake is stale. */
function isStaleProtocolCode(statusCode) {
    return statusCode === 405 || statusCode === 410 || statusCode === 428;
}

function startProactiveWaVersionRefresh() {
    if (waVersionProactiveTimer) return;
    waVersionProactiveTimer = setInterval(() => {
        resolveWaWebVersion({ force: true })
            .then(({ version, isLatest }) => {
                console.log(
                    `[WhatsApp] Proactive WA version refresh → ${version.join('.')}` +
                    `${isLatest ? ' (latest)' : ''}`
                );
            })
            .catch((err) => {
                console.warn('[WhatsApp] Proactive WA version refresh failed:', err.message || err);
            });
    }, WA_VERSION_PROACTIVE_REFRESH_MS);
    if (typeof waVersionProactiveTimer.unref === 'function') {
        waVersionProactiveTimer.unref();
    }
}

function scheduleReconnect(delayMs, reason) {
    if (reconnectTimer) {
        console.log(`[WhatsApp] Reconnect already scheduled. Keeping existing timer (${reason}).`);
        return;
    }
    console.log(`[WhatsApp] Scheduling reconnect in ${delayMs}ms (${reason}).`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectToWhatsApp();
    }, delayMs);
}

function getSacAutomationRunner() {
    if (!runSacSingleClaimFetch) {
        ({ runSacSingleClaimFetch } = require('./services/sacAutomation'));
    }
    return runSacSingleClaimFetch;
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
        consecutiveFailures = 0;
        lastDisconnectCode = null;
        clearReconnectTimer();
        return;
    }
    clearReconnectTimer();
    isConnecting = true;
    connectingStartedAt = Date.now();
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
        // Always fetch a fresh WA version on cold start and after protocol / handshake failures.
        const forceVersionRefresh =
            !coldStartVersionForced ||
            isStaleProtocolCode(lastDisconnectCode) ||
            consecutiveFailures > 0;
        if (!coldStartVersionForced) coldStartVersionForced = true;
        const { version, isLatest, fromCache } = await resolveWaWebVersion({ force: forceVersionRefresh });
        console.log(
            `[WhatsApp] Using WA Web version ${version.join('.')}` +
            `${isLatest ? ' (latest)' : ''}${fromCache ? ' [cache]' : ' [fresh]'}`
        );
        startProactiveWaVersionRefresh();

        sock = makeWASocket({
            auth: state,
            version,
            printQRInTerminal: false, // We print it manually to have full control
            logger: pino({ level: 'info' }),
            browser: Browsers.macOS('Chrome'),
            syncFullHistory: false,
            markOnlineOnConnect: false
        });

        // Sync credentials whenever update is fired (await so pairing 515 doesn't race)
        sock.ev.on('creds.update', async () => {
            try {
                await saveCreds();
            } catch (err) {
                console.error('[WhatsApp] Error saving creds:', err);
            }
        });
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
                consecutiveFailures = 0;
                lastDisconnectCode = null;
                console.log('\n--- ESCANEA ESTE CÓDIGO QR CON WHATSAPP BUSINESS ---');
                qrcode.generate(qr, { small: true });
                console.log('-----------------------------------------------------\n');
            }

            if (update.isNewLogin) {
                console.log('[WhatsApp] isNewLogin=true — pairing accepted by WhatsApp, waiting for 515 restart…');
            }

            if (connection === 'close') {
                isConnected = false;
                qrCode = null;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                lastDisconnectCode = statusCode ?? null;
                lastDisconnectAt = new Date().toISOString();
                const isRestartRequired =
                    statusCode === DisconnectReason.restartRequired || statusCode === 515;
                // 515 is expected right after scanning QR — do not treat as a failure.
                if (!isRestartRequired) {
                    consecutiveFailures += 1;
                }
                
                // If it is a conflict (session replaced), do not auto-reconnect to avoid infinite loop
                const isConflict = statusCode === 440 || lastDisconnect?.error?.message?.includes('conflict');
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !isConflict;
                const delayMs = getReconnectDelayMs(statusCode);
                
                console.warn(`[WhatsApp] Connection #${socketId} closed. Status Code: ${statusCode}. Failures: ${consecutiveFailures}. Reconnecting: ${shouldReconnect}${isRestartRequired ? ' (pairing restart)' : ''}`);

                if (isStaleProtocolCode(statusCode)) {
                    // Invalidate version cache so the next attempt picks a fresher WA build.
                    cachedWaVersionAt = 0;
                    console.warn(`[WhatsApp] Stale protocol signal (${statusCode}). WA version cache invalidated.`);
                }

                if (shouldReconnect) {
                    isConnecting = true;
                    // Flush auth to Supabase before reconnecting after pairing (515).
                    if (isRestartRequired) {
                        try {
                            await saveCreds();
                            console.log('[WhatsApp] Creds flushed before pairing reconnect.');
                        } catch (flushErr) {
                            console.error('[WhatsApp] Failed to flush creds before reconnect:', flushErr);
                        }
                    }
                    scheduleReconnect(delayMs, `close-${socketId}-code-${statusCode}`);
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
                        scheduleReconnect(delayMs, `conflict-${socketId}`);
                    }
                } else {
                    isConnecting = true;
                    console.error('[WhatsApp] Logged out. Deleting credentials in Supabase to start fresh.');
                    await supabase.from('baileys_creds').delete().eq('session_id', SESSION_ID);
                    await supabase.from('baileys_keys').delete().eq('session_id', SESSION_ID);
                    if (sock === socketRef) {
                        sock = null;
                    }
                    scheduleReconnect(delayMs, `loggedout-${socketId}`);
                }
            } else if (connection === 'open') {
                isConnected = true;
                isConnecting = false;
                qrCode = null;
                consecutiveFailures = 0;
                lastDisconnectCode = null;
                connectingStartedAt = null;
                clearReconnectTimer();
                console.log(`[WhatsApp] Connection established successfully! Logged in as: ${sock.user.name || sock.user.id}`);
            }
        });

    } catch (err) {
        console.error('[WhatsApp] Critical error during initialization:', err);
        consecutiveFailures += 1;
        lastDisconnectCode = 'init_error';
        lastDisconnectAt = new Date().toISOString();
        isConnecting = true;
        scheduleReconnect(getReconnectDelayMs(null), 'critical-init');
    }
}

// ----------------------------------------------------
// Keep-Alive
// - Presence cada ~12 min: mantiene el socket Baileys activo
// - Self-message cada 6 h: igual que el bot PDF (señal fuerte a WA)
// - /ping: endpoint liviano para cron externo (Netlify / UptimeRobot)
//   → evita hibernación de Render (suele dormir ~15 min sin HTTP)
// ----------------------------------------------------
const PRESENCE_KEEPALIVE_MS = Number(process.env.PRESENCE_KEEPALIVE_MS || 12 * 60 * 1000);
const SELF_PING_MS = Number(process.env.SELF_PING_MS || 6 * 60 * 60 * 1000);

setInterval(async () => {
    try {
        if (isConnected && sock) {
            await sock.sendPresenceUpdate('available');
            console.log('[Keep-Alive] Presence refresh (available)');
        }
    } catch (err) {
        console.error('[Keep-Alive] Error refreshing presence:', err);
    }
}, PRESENCE_KEEPALIVE_MS);

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
}, SELF_PING_MS);

// ----------------------------------------------------
// Express Endpoint Webhook
// ----------------------------------------------------

// Ping liviano para keep-alive externo (cron / UptimeRobot / Netlify scheduled / GitHub Actions)
app.get('/ping', (req, res) => {
    res.status(200).json({
        ok: true,
        pong: true,
        connected: isConnected,
        connecting: isConnecting,
        session_id: SESSION_ID,
        ts: new Date().toISOString(),
    });
});

// Health Check Endpoint
app.get('/status', (req, res) => {
    const connectingForMs = isConnecting && connectingStartedAt
        ? Date.now() - connectingStartedAt
        : 0;
    const pairingBlocked = !isConnected && !qrCode && lastDisconnectCode === 405;
    res.status(200).json({
        success: true,
        connected: isConnected,
        connecting: isConnecting,
        session_id: SESSION_ID,
        mock_connection: MOCK_CONNECTION,
        sac_enabled: SAC_FEATURE_ENABLED,
        phone_user: isConnected
            ? (MOCK_CONNECTION ? '549342555555:12@s.whatsapp.net' : (sock?.user?.id || null))
            : null,
        qr: qrCode,
        stalled: !isConnected && !isConnecting && !qrCode,
        last_disconnect_code: lastDisconnectCode,
        last_disconnect_at: lastDisconnectAt,
        consecutive_failures: consecutiveFailures,
        connecting_for_ms: connectingForMs,
        pairing_blocked: pairingBlocked,
        wa_version: cachedWaVersion ? cachedWaVersion.join('.') : null,
        wa_version_cached_at: cachedWaVersionAt || null,
        baileys_package: (() => {
            try {
                return require('@whiskeysockets/baileys/package.json').version;
            } catch (_) {
                return null;
            }
        })(),
        uptime_s: Math.floor(process.uptime()),
        memory_rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    });
});

/** Prometheus text exposition (scrape local dashboard / Prometheus). */
app.get('/metrics', (req, res) => {
    const mem = process.memoryUsage();
    const lines = [
        '# HELP wa_bot_up 1 if process is serving HTTP',
        '# TYPE wa_bot_up gauge',
        `wa_bot_up{session_id="${SESSION_ID}"} 1`,
        '# HELP wa_bot_connected 1 if WhatsApp socket is connected',
        '# TYPE wa_bot_connected gauge',
        `wa_bot_connected{session_id="${SESSION_ID}"} ${isConnected ? 1 : 0}`,
        '# HELP wa_bot_connecting 1 if WhatsApp is connecting',
        '# TYPE wa_bot_connecting gauge',
        `wa_bot_connecting{session_id="${SESSION_ID}"} ${isConnecting ? 1 : 0}`,
        '# HELP wa_bot_has_qr 1 if a QR is pending',
        '# TYPE wa_bot_has_qr gauge',
        `wa_bot_has_qr{session_id="${SESSION_ID}"} ${qrCode ? 1 : 0}`,
        '# HELP wa_bot_consecutive_failures reconnect failure streak',
        '# TYPE wa_bot_consecutive_failures gauge',
        `wa_bot_consecutive_failures{session_id="${SESSION_ID}"} ${consecutiveFailures}`,
        '# HELP wa_bot_uptime_seconds process uptime',
        '# TYPE wa_bot_uptime_seconds counter',
        `wa_bot_uptime_seconds{session_id="${SESSION_ID}"} ${Math.floor(process.uptime())}`,
        '# HELP wa_bot_memory_rss_bytes resident set size',
        '# TYPE wa_bot_memory_rss_bytes gauge',
        `wa_bot_memory_rss_bytes{session_id="${SESSION_ID}"} ${mem.rss}`,
        '# HELP wa_bot_memory_heap_used_bytes heap used',
        '# TYPE wa_bot_memory_heap_used_bytes gauge',
        `wa_bot_memory_heap_used_bytes{session_id="${SESSION_ID}"} ${mem.heapUsed}`,
        '',
    ];
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(lines.join('\n'));
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
    const optionalFields = ['file_name', 'usuario_carga', 'protocol_override'];
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

function currentClaimYear() {
    return new Date().getFullYear();
}

function isSacAuthAllowed(req) {
    // Fail closed in production when the feature is on but no token was configured.
    if (!SAC_AUTOMATION_TOKEN) {
        if (SAC_FEATURE_ENABLED && process.env.NODE_ENV === 'production') {
            return false;
        }
        return true;
    }
    const token = req.headers['x-sac-automation-token'];
    return typeof token === 'string' && token === SAC_AUTOMATION_TOKEN;
}

function slimSacJob(job, extras = {}) {
    if (!job) return null;
    return {
        id: job.id,
        numeroReclamo: job.numero_reclamo,
        anio: job.anio,
        status: job.status,
        errorMessage: job.error_message || null,
        storagePath: job.storage_path || null,
        fileName: job.file_name || null,
        // Prefer signed URL; keep publicUrl only as legacy fallback for old rows.
        signedUrl: extras.signedUrl || null,
        publicUrl: extras.signedUrl ? null : (job.public_url || null),
        createdAt: job.created_at || null,
        startedAt: job.started_at || null,
        finishedAt: job.finished_at || null
    };
}

async function createSignedUrlForPath(storagePath) {
    if (!storagePath) return null;
    const { data, error } = await supabase.storage
        .from('pdfs')
        .createSignedUrl(storagePath, SAC_SIGNED_URL_TTL_SEC);
    if (error) {
        console.warn('[SAC] No se pudo firmar URL del PDF:', error.message);
        return null;
    }
    return data?.signedUrl || null;
}

async function loadSacSessionState() {
    const { data, error } = await supabase
        .from('sac_session_state')
        .select('state')
        .eq('id', SAC_SESSION_STATE_ID)
        .maybeSingle();
    if (error) {
        // Table may not exist yet — non-fatal.
        console.warn('[SAC] No se pudo leer sac_session_state:', error.message);
        return null;
    }
    return data?.state || null;
}

async function saveSacSessionState(state) {
    if (!state || typeof state !== 'object') return;
    const { error } = await supabase
        .from('sac_session_state')
        .upsert({
            id: SAC_SESSION_STATE_ID,
            state,
            updated_at: new Date().toISOString()
        });
    if (error) {
        console.warn('[SAC] No se pudo guardar sac_session_state:', error.message);
    }
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

async function markSacJobAsStale(job, reason) {
    if (!job) return;
    const message = reason
        || `Job SAC vencido por timeout (${Math.round(SAC_JOB_STALE_MS / 60000)} min).`;
    const patch = {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: message
    };
    await updateSacJob(job.id, patch);
    sacJobsCache.set(job.id, { ...job, ...patch });
    console.warn(`[SAC] Job ${job.id} marcado como failed. ${message}`);
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
    if (!SAC_PROCESS_JOBS) {
        console.log(`[SAC] Job ${jobId} queda en Supabase para el worker externo.`);
        return;
    }
    if (sacJobQueue.includes(jobId)) return;
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
    if (current.status === 'ready' || current.status === 'failed') return;

    const startedAt = new Date().toISOString();
    await updateSacJob(jobId, { status: 'running', started_at: startedAt, error_message: null });
    console.log(`[SAC] Job ${jobId} running (${current.numero_reclamo}/${current.anio})`);

    try {
        if (!SAC_FEATURE_ENABLED) {
            throw new Error('La búsqueda SAC está deshabilitada temporalmente.');
        }

        const runFetch = getSacAutomationRunner();
        const { pdfBuffer, suggestedFileName } = await runFetch({
            numeroReclamo: current.numero_reclamo,
            anio: current.anio,
            usuario: SAC_USER,
            contrasena: SAC_PASSWORD,
            loadSessionState: loadSacSessionState,
            saveSessionState: saveSacSessionState
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

        await updateSacJob(jobId, {
            status: 'ready',
            finished_at: new Date().toISOString(),
            storage_path: storagePath,
            file_name: suggestedFileName || `${safeNumber}_${current.anio}.pdf`,
            // Avoid long-lived public URLs for reclamos; signed URL is minted on read.
            public_url: null
        });
        console.log(`[SAC] Job ${jobId} ready → ${storagePath}`);
    } catch (error) {
        console.error(`[SAC] Job ${jobId} failed:`, error?.message || error);
        await updateSacJob(jobId, {
            status: 'failed',
            finished_at: new Date().toISOString(),
            error_message: error?.message || 'Error desconocido al descargar reclamo SAC'
        });
    }
}

/**
 * After process restart: mark interrupted "running" jobs as failed and re-enqueue
 * anything still "queued" so the worker recovers from DB instead of memory-only queue.
 */
async function recoverSacJobsOnStartup() {
    if (!SAC_FEATURE_ENABLED || !SAC_PROCESS_JOBS) return;

    try {
        const { data: running, error: runningError } = await supabase
            .from('sac_jobs')
            .select('*')
            .eq('status', 'running')
            .order('created_at', { ascending: true });

        if (runningError) {
            console.warn('[SAC] No se pudieron recuperar jobs running:', runningError.message);
        } else {
            for (const job of running || []) {
                sacJobsCache.set(job.id, job);
                await markSacJobAsStale(
                    job,
                    'Job interrumpido por reinicio del servidor. Volvé a buscar el reclamo.'
                );
            }
        }

        const { data: queued, error: queuedError } = await supabase
            .from('sac_jobs')
            .select('*')
            .eq('status', 'queued')
            .order('created_at', { ascending: true });

        if (queuedError) {
            console.warn('[SAC] No se pudieron recuperar jobs queued:', queuedError.message);
            return;
        }

        for (const job of queued || []) {
            const normalized = await normalizeRunningSacJob(job);
            if (!normalized) continue;
            sacJobsCache.set(normalized.id, normalized);
            enqueueSacJob(normalized.id);
        }

        if ((queued || []).length > 0) {
            console.log(`[SAC] Recuperados ${(queued || []).length} job(s) en cola tras reinicio.`);
        }
    } catch (err) {
        console.warn('[SAC] recoverSacJobsOnStartup falló:', err.message || err);
    }
}

app.use('/sac', (req, res, next) => {
    if (SAC_FEATURE_ENABLED) return next();
    return res.status(410).json({
        success: false,
        message: 'La búsqueda automática de reclamos SAC está deshabilitada temporalmente.'
    });
});

app.post('/sac/worker/recover', async (req, res) => {
    if (!isSacAuthAllowed(req)) {
        return res.status(401).json({ success: false, message: 'Worker SAC no autorizado.' });
    }
    const { error } = await supabase
        .from('sac_jobs')
        .update({
            status: 'queued',
            started_at: null,
            error_message: 'Reencolado tras reinicio del worker local.'
        })
        .eq('status', 'running');
    if (error) return res.status(500).json({ success: false, message: error.message });
    return res.json({ success: true });
});

app.post('/sac/worker/claim', async (req, res) => {
    if (!isSacAuthAllowed(req)) {
        return res.status(401).json({ success: false, message: 'Worker SAC no autorizado.' });
    }
    const { data: queued, error: findError } = await supabase
        .from('sac_jobs')
        .select('*')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
    if (findError) return res.status(500).json({ success: false, message: findError.message });
    if (!queued) return res.json({ success: true, job: null });

    const startedAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabase
        .from('sac_jobs')
        .update({ status: 'running', started_at: startedAt, finished_at: null, error_message: null })
        .eq('id', queued.id)
        .eq('status', 'queued')
        .select('*')
        .maybeSingle();
    if (claimError) return res.status(500).json({ success: false, message: claimError.message });
    if (claimed) sacJobsCache.set(claimed.id, claimed);
    return res.json({ success: true, job: claimed || null });
});

app.get('/sac/worker/session', async (req, res) => {
    if (!isSacAuthAllowed(req)) {
        return res.status(401).json({ success: false, message: 'Worker SAC no autorizado.' });
    }
    return res.json({ success: true, state: await loadSacSessionState() });
});

app.put('/sac/worker/session', async (req, res) => {
    if (!isSacAuthAllowed(req)) {
        return res.status(401).json({ success: false, message: 'Worker SAC no autorizado.' });
    }
    await saveSacSessionState(req.body?.state);
    return res.json({ success: true });
});

app.post(
    '/sac/worker/jobs/:jobId/complete',
    express.raw({ type: 'application/pdf', limit: '25mb' }),
    async (req, res) => {
        if (!isSacAuthAllowed(req)) {
            return res.status(401).json({ success: false, message: 'Worker SAC no autorizado.' });
        }
        if (!Buffer.isBuffer(req.body) || req.body.length < 5) {
            return res.status(400).json({ success: false, message: 'PDF vacío o inválido.' });
        }

        const job = await getSacJobById(req.params.jobId);
        if (!job || job.status !== 'running') {
            return res.status(409).json({ success: false, message: 'El job no está en ejecución.' });
        }

        let requestedName = '';
        try {
            requestedName = decodeURIComponent(req.get('x-sac-file-name') || '');
        } catch (_) {
            requestedName = '';
        }
        const safeNumber = sanitizeStorageSegment(job.numero_reclamo);
        const safeName = sanitizeStorageSegment(requestedName || `${safeNumber}_${job.anio}.pdf`);
        const storagePath = `sac/${job.anio}/${Date.now()}_${safeName}`;
        const { error: uploadError } = await supabase.storage
            .from('pdfs')
            .upload(storagePath, req.body, { contentType: 'application/pdf', upsert: false });
        if (uploadError) {
            return res.status(500).json({ success: false, message: uploadError.message });
        }

        const patch = {
            status: 'ready',
            storage_path: storagePath,
            file_name: safeName,
            public_url: null,
            finished_at: new Date().toISOString(),
            error_message: null
        };
        await updateSacJob(job.id, patch);
        return res.json({ success: true, job: slimSacJob({ ...job, ...patch }) });
    }
);

app.post('/sac/worker/jobs/:jobId/fail', async (req, res) => {
    if (!isSacAuthAllowed(req)) {
        return res.status(401).json({ success: false, message: 'Worker SAC no autorizado.' });
    }
    const patch = {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: String(req.body?.message || 'Error desconocido en worker SAC').slice(0, 2000)
    };
    await updateSacJob(req.params.jobId, patch);
    return res.json({ success: true });
});

app.post('/sac/fetch-single-claim', async (req, res) => {
    if (!isSacAuthAllowed(req)) {
        return res.status(401).json({
            success: false,
            message: 'No autorizado para ejecutar automatización SAC.'
        });
    }

    const numeroReclamo = sanitizeClaimValue(req.body?.numeroReclamo);
    const rawAnio = req.body?.anio;
    const anio = Number(rawAnio == null || rawAnio === '' ? currentClaimYear() : rawAnio);

    if (!numeroReclamo) {
        return res.status(400).json({
            success: false,
            message: 'El campo "numeroReclamo" es obligatorio.'
        });
    }

    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
        return res.status(400).json({
            success: false,
            message: 'El campo "anio" debe ser un número válido (2000-2100).'
        });
    }

    if (SAC_PROCESS_JOBS && (!SAC_USER || !SAC_PASSWORD)) {
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

        let signedUrl = null;
        if (job.status === 'ready' && job.storage_path) {
            signedUrl = await createSignedUrlForPath(job.storage_path);
        }

        return res.status(200).json({
            success: true,
            job: slimSacJob(job, { signedUrl })
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'No se pudo consultar el job SAC.',
            error: error.message
        });
    }
});

app.post('/send-text', requireApiKey, async (req, res) => {
    const { phoneNumber, text, contactName } = req.body;

    if (!phoneNumber || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({
            success: false,
            message: 'Parámetros "phoneNumber" y "text" son requeridos.'
        });
    }

    const trimmedText = text.trim();
    if (trimmedText.length > 4000) {
        return res.status(400).json({
            success: false,
            message: 'El texto no puede superar 4000 caracteres.'
        });
    }

    if (!isConnected || (!sock && !MOCK_CONNECTION)) {
        return res.status(503).json({
            success: false,
            message: 'El bot de WhatsApp no está conectado o inicializado.'
        });
    }

    let cleanNumber = String(phoneNumber).replace(/[^0-9]/g, '');
    if (cleanNumber.length < 8) {
        return res.status(400).json({
            success: false,
            message: 'El número telefónico provisto es inválido o muy corto.'
        });
    }

    // Defensa AR: quitar "15" local y forzar 549… si vino mal tipado (ej. 342155…)
    if (cleanNumber.startsWith('00')) cleanNumber = cleanNumber.slice(2);
    if (cleanNumber.startsWith('0')) cleanNumber = cleanNumber.slice(1);
    if (cleanNumber.startsWith('549')) {
        // ok
    } else if (cleanNumber.startsWith('54') && cleanNumber[2] !== '9') {
        cleanNumber = '549' + cleanNumber.slice(2);
    } else if (!cleanNumber.startsWith('54')) {
        let national = cleanNumber;
        if (national.startsWith('9') && national.length >= 11) national = national.slice(1);
        const m3 = national.match(/^(\d{3})15(\d{6,8})$/);
        const m4 = national.match(/^(\d{4})15(\d{6,8})$/);
        const m11 = national.startsWith('1115') ? ['', '11', national.slice(4)] : null;
        if (m11) national = m11[1] + m11[2];
        else if (m3) national = m3[1] + m3[2];
        else if (m4) national = m4[1] + m4[2];
        cleanNumber = '549' + national;
    }

    const jid = `${cleanNumber}@s.whatsapp.net`;

    try {
        const delayMs = Math.floor(Math.random() * (5000 - 2000 + 1)) + 2000;
        console.log(`[Webhook] Queueing text delivery. Delaying for ${delayMs}ms (Anti-ban)...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));

        let response;
        let sendJid = jid;
        if (MOCK_CONNECTION) {
            console.log(`[Webhook] [MOCK] Simulating text to JID: ${jid}...`);
            await new Promise(resolve => setTimeout(resolve, 500));
            response = { key: { id: `MOCK_${Date.now()}` } };
        } else {
            try {
                const waCheck = await sock.onWhatsApp(cleanNumber);
                const exists = Array.isArray(waCheck) && waCheck[0]?.exists;
                if (!exists) {
                    console.warn(`[Webhook] Número sin WhatsApp o inválido: ${cleanNumber}`);
                    await logShipment({
                        contact_name: contactName || 'Desconocido',
                        contact_phone: cleanNumber,
                        solicitud_nro: null,
                        subtipo: 'licencia_texto',
                        file_name: null,
                        usuario_carga: null,
                        status: 'failed',
                        message_text: trimmedText,
                        is_group: false,
                        group_jid: null
                    });
                    return res.status(400).json({
                        success: false,
                        code: 'NUMBER_NOT_ON_WHATSAPP',
                        message: `El número ${cleanNumber} no tiene WhatsApp o es inválido. Revisá el teléfono del vecino.`,
                        phoneNumber: cleanNumber
                    });
                }
                if (waCheck[0]?.jid) {
                    sendJid = waCheck[0].jid;
                    console.log(`[Webhook] onWhatsApp OK → ${sendJid}`);
                }
            } catch (checkErr) {
                console.warn('[Webhook] onWhatsApp check failed, continuing with send:', checkErr?.message || checkErr);
            }
            console.log(`[Webhook] Sending text to JID: ${sendJid}...`);
            response = await sock.sendMessage(sendJid, { text: trimmedText });
        }

        const messageId = response?.key?.id;
        if (!messageId) {
            console.error('[Webhook] sendMessage returned without message id', response);
            await logShipment({
                contact_name: contactName || 'Desconocido',
                contact_phone: cleanNumber,
                solicitud_nro: null,
                subtipo: 'licencia_texto',
                file_name: null,
                usuario_carga: null,
                status: 'failed',
                message_text: trimmedText,
                is_group: false,
                group_jid: null
            });
            return res.status(502).json({
                success: false,
                code: 'NO_MESSAGE_ID',
                message: 'WhatsApp no confirmó el envío. Reintentá en unos segundos.',
                phoneNumber: cleanNumber
            });
        }

        if (!MOCK_CONNECTION) {
            const delivery = await waitForOutboundMessageResult(sock, messageId, 10000);
            if (!delivery.ok) {
                console.error(
                    `[Webhook] Delivery rejected for ${messageId}:`,
                    delivery.code,
                    delivery.stubs || ''
                );
                await logShipment({
                    contact_name: contactName || 'Desconocido',
                    contact_phone: cleanNumber,
                    solicitud_nro: null,
                    subtipo: 'licencia_texto',
                    file_name: null,
                    usuario_carga: null,
                    status: 'failed',
                    message_text: trimmedText,
                    is_group: false,
                    group_jid: null
                });
                const restricted = delivery.code === 'ACCOUNT_RESTRICTED';
                return res.status(restricted ? 403 : 502).json({
                    success: false,
                    code: delivery.code || 'DELIVERY_ERROR',
                    message: restricted
                        ? 'WhatsApp bloqueó la entrega a este número por ahora (restricción temporal de la cuenta). Probá más tarde o usá WhatsApp personal.'
                        : 'WhatsApp rechazó la entrega del mensaje. Reintentá más tarde.',
                    phoneNumber: cleanNumber,
                    messageId
                });
            }
            console.log(
                `[Webhook] Delivery check OK for ${messageId} (${delivery.reason || 'ok'})`
            );
        }

        console.log(`[Webhook] Text successfully sent. Message ID: ${messageId}`);

        await logShipment({
            contact_name: contactName || 'Desconocido',
            contact_phone: cleanNumber,
            solicitud_nro: null,
            subtipo: 'licencia_texto',
            file_name: null,
            usuario_carga: null,
            status: 'success',
            message_text: trimmedText,
            is_group: false,
            group_jid: null
        });

        return res.status(200).json({
            success: true,
            message: MOCK_CONNECTION
                ? 'Simulación: el texto NO se envió por WhatsApp (MOCK_CONNECTION=true).'
                : 'Mensaje enviado exitosamente.',
            messageId,
            phoneNumber: cleanNumber,
            mock: MOCK_CONNECTION
        });
    } catch (err) {
        console.error('[Webhook] Error sending text:', err);
        const errMsg = String(err?.message || err || '');
        const connectionLost = /connection closed|timed out|not connected/i.test(errMsg);

        await logShipment({
            contact_name: contactName || 'Desconocido',
            contact_phone: cleanNumber,
            solicitud_nro: null,
            subtipo: 'licencia_texto',
            file_name: null,
            usuario_carga: null,
            status: 'failed',
            message_text: trimmedText,
            is_group: false,
            group_jid: null
        });

        return res.status(connectionLost ? 503 : 500).json({
            success: false,
            code: connectionLost ? 'CONNECTION_LOST' : 'SEND_FAILED',
            message: connectionLost
                ? 'Se cortó la conexión de WhatsApp al enviar. Reconectá y reintentá.'
                : 'No se pudo enviar el mensaje. Reintentá o probá con otro número.',
            error: errMsg,
            phoneNumber: cleanNumber
        });
    }
});

app.post('/send-pdf', requireApiKey, async (req, res) => {
    const { fileName, phoneNumber, groupJid, caption, contactName, solicitudNro, subtipo, displayName, isGroup, usuarioCarga, protocolOverride } = req.body;
    const protocolOverrideFlag = Boolean(protocolOverride);

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
            protocol_override: protocolOverrideFlag,
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
            protocol_override: protocolOverrideFlag,
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

// Force a fresh WhatsApp connection attempt (keeps credentials unless a QR is needed).
// Soft: ends the socket WITHOUT logout — safe to refresh QR while pairing.
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
    consecutiveFailures = 0;
    lastDisconnectCode = null;
    clearReconnectTimer();
    if (sock) {
        // NEVER logout here — logout signals WA to remove the companion and can rate-limit
        // new pairings from this IP when spammed during QR linking.
        try { sock.ev.removeAllListeners(); sock.end(); } catch (_) { /* ignore */ }
        sock = null;
    }
    setTimeout(connectToWhatsApp, 1000);
    return res.status(200).json({ success: true, message: 'Reconexión iniciada.' });
});

/**
 * Pairing-code login (alternative to QR).
 * Body: { phoneNumber: "549341xxxxxxx" }  E.164 digits, no "+"
 * Call while the socket is waiting for QR / connecting.
 */
app.post('/pair-code', requireApiKey, async (req, res) => {
    if (MOCK_CONNECTION) {
        return res.status(200).json({ success: true, code: 'ABCD1234', message: 'Código simulado.' });
    }
    if (isConnected) {
        return res.status(400).json({
            success: false,
            message: 'Ya hay una sesión conectada. Desconectá primero si querés re-vincular.'
        });
    }
    if (!sock) {
        return res.status(503).json({
            success: false,
            message: 'El socket aún no está listo. Esperá el QR / reconnect y reintentá en unos segundos.'
        });
    }
    const raw = String(req.body?.phoneNumber || '').replace(/[^0-9]/g, '');
    if (raw.length < 10) {
        return res.status(400).json({
            success: false,
            message: 'phoneNumber inválido. Usá E.164 sin +: ej. 5493415551234'
        });
    }
    try {
        console.log(`[WhatsApp] requestPairingCode for ${raw} (session ${SESSION_ID})`);
        const code = await sock.requestPairingCode(raw);
        return res.status(200).json({
            success: true,
            code,
            message: 'Ingresá este código en WhatsApp → Dispositivos vinculados → Vincular con número de teléfono.'
        });
    } catch (err) {
        console.error('[WhatsApp] requestPairingCode failed:', err);
        return res.status(500).json({
            success: false,
            message: err?.message || 'No se pudo generar el código de vinculación.'
        });
    }
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

        // 2. Terminate socket. Only call logout() if we were actually paired —
        // logout on an unpaired socket + rapid retries rate-limits new linking on WA.
        const wasPaired = isConnected;
        isConnected = false;
        isConnecting = true;
        qrCode = null;
        consecutiveFailures = 0;
        lastDisconnectCode = null;
        clearReconnectTimer();
        if (sock) {
            try {
                if (wasPaired) {
                    await sock.logout();
                } else {
                    console.log('[WhatsApp] Soft end (not paired) — skipping logout to avoid WA rate-limit.');
                    sock.ev.removeAllListeners();
                    sock.end();
                }
            } catch (logoutErr) {
                console.warn('[WhatsApp] Error closing socket:', logoutErr);
                try {
                    sock.end();
                } catch (endErr) {
                    console.error('[WhatsApp] Error ending socket:', endErr);
                }
            }
            sock = null;
        }

        // 3. Trigger reconnection to start fresh with a new QR code
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
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Webhook server running on 0.0.0.0:${PORT}`);
    if (!SAC_FEATURE_ENABLED) {
        console.log('[SAC] Feature flag desactivada. Endpoints /sac en modo deshabilitado.');
    } else if (!SAC_AUTOMATION_TOKEN && process.env.NODE_ENV === 'production') {
        console.warn('[SAC] FEATURE ON sin SAC_AUTOMATION_TOKEN en producción — endpoints rechazan peticiones.');
    } else {
        console.log(`[SAC] Feature habilitada (${SAC_PROCESS_JOBS ? 'worker cloud' : 'worker externo'}).`);
        if (SAC_PROCESS_JOBS) {
            void recoverSacJobsOnStartup();
        }
    }
    connectToWhatsApp();
});
