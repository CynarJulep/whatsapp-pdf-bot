/**
 * Mantenedor del stack Docker (prod).
 * - Si un bot queda stalled (sin conectar / sin QR), llama POST /reconnect
 * - Si el tunnel público no responde, deja evidencia en state/alerts.json
 * - Si hay QR pendiente, marca needs_qr (acción humana: escanear en el celular)
 *
 * Lo que NO puede automatizarse: vincular de nuevo el dispositivo en WhatsApp
 * cuando Meta desvincula la sesión (loggedOut) — ahí hace falta escanear QR una vez.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, '..', 'state');
const ALERTS_FILE = path.join(STATE_DIR, 'alerts.json');

const INTERVAL_MS = Math.max(15000, Number(process.env.MAINTAIN_INTERVAL_MS || 45000));
const STALL_GRACE_MS = Math.max(20000, Number(process.env.MAINTAIN_STALL_GRACE_MS || 90000));
const PAI_URL = (process.env.PAI_URL || 'http://pai:7860').replace(/\/$/, '');
const LIC_URL = (process.env.LICENCIAS_URL || 'http://licencias:7860').replace(/\/$/, '');
const REGISTRY_URL =
  process.env.BACKEND_REGISTRY_URL ||
  'https://hltyozdvcqfmvqmyrlva.supabase.co/storage/v1/object/public/runtime/backend-endpoints.json';

const firstSeenStall = new Map();
const lastReconnectAt = new Map();
const RECONNECT_COOLDOWN_MS = 2 * 60 * 1000;

function ensureState() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function writeAlerts(payload) {
  ensureState();
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(payload, null, 2));
}

function fetchJson(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    try {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, { timeout: timeoutMs }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(body) });
          } catch {
            resolve({ ok: false, status: res.statusCode, data: null, raw: body.slice(0, 200) });
          }
        });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'timeout' });
      });
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

function postReconnect(baseUrl) {
  return new Promise((resolve) => {
    try {
      const u = new URL(`${baseUrl}/reconnect`);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname,
          method: 'POST',
          timeout: 8000,
          headers: { 'Content-Type': 'application/json', 'Content-Length': 0 },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, body: body.slice(0, 200) }));
        }
      );
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'timeout' });
      });
      req.end();
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

function classifyBot(name, statusRes) {
  const data = statusRes?.data;
  if (!statusRes?.ok || !data) {
    return { name, level: 'down', message: `HTTP status falló (${statusRes?.error || statusRes?.status})` };
  }
  if (data.connected) {
    firstSeenStall.delete(name);
    return { name, level: 'ok', message: 'conectado', wa_version: data.wa_version, phone: data.phone_user };
  }
  if (data.qr) {
    firstSeenStall.delete(name);
    return {
      name,
      level: 'needs_qr',
      message: 'WhatsApp pide vincular dispositivo — escanear QR desde el celular (Dispositivos vinculados)',
      qr: data.qr,
    };
  }
  if (data.connecting) {
    return { name, level: 'connecting', message: 'reconectando…', wa_version: data.wa_version };
  }
  // stalled
  const now = Date.now();
  if (!firstSeenStall.has(name)) firstSeenStall.set(name, now);
  const stalledFor = now - firstSeenStall.get(name);
  return {
    name,
    level: 'stalled',
    message: `stalled ${Math.round(stalledFor / 1000)}s`,
    stalledFor,
    wa_version: data.wa_version,
  };
}

async function maybeReconnect(name, baseUrl, info) {
  if (info.level !== 'stalled' || info.stalledFor < STALL_GRACE_MS) return null;
  const last = lastReconnectAt.get(name) || 0;
  if (Date.now() - last < RECONNECT_COOLDOWN_MS) {
    return { skipped: true, reason: 'cooldown' };
  }
  console.log(`[maintain] ${name}: stalled → POST /reconnect`);
  lastReconnectAt.set(name, Date.now());
  firstSeenStall.delete(name);
  return postReconnect(baseUrl);
}

async function checkTunnel(url) {
  if (!url) return { ok: false, error: 'missing' };
  const res = await fetchJson(`${url.replace(/\/$/, '')}/status`, 12000);
  return { ok: !!res.ok && !!res.data, status: res.status, error: res.error, connected: res.data?.connected };
}

async function tick() {
  const [paiStatus, licStatus, registry] = await Promise.all([
    fetchJson(`${PAI_URL}/status`),
    fetchJson(`${LIC_URL}/status`),
    fetchJson(REGISTRY_URL, 12000),
  ]);

  const pai = classifyBot('pai', paiStatus);
  const lic = classifyBot('licencias', licStatus);

  const reconnects = {
    pai: await maybeReconnect('pai', PAI_URL, pai),
    licencias: await maybeReconnect('licencias', LIC_URL, lic),
  };

  const tunnels = {
    pai: registry.data?.pai || null,
    licencias: registry.data?.licencias || null,
    updatedAt: registry.data?.updatedAt || null,
    registryOk: !!registry.ok,
  };

  const [paiTun, licTun] = await Promise.all([
    checkTunnel(tunnels.pai),
    checkTunnel(tunnels.licencias),
  ]);

  const alerts = [];
  for (const bot of [pai, lic]) {
    if (bot.level === 'needs_qr') {
      alerts.push({
        severity: 'action_required',
        bot: bot.name,
        title: `Escanear QR — ${bot.name}`,
        detail: bot.message,
      });
    } else if (bot.level === 'down' || bot.level === 'stalled') {
      alerts.push({
        severity: 'warning',
        bot: bot.name,
        title: `${bot.name}: ${bot.level}`,
        detail: bot.message,
      });
    }
  }
  if (!tunnels.registryOk) {
    alerts.push({
      severity: 'warning',
      bot: 'tunnels',
      title: 'Registry Supabase no legible',
      detail: registry.error || `status ${registry.status}`,
    });
  }
  if (tunnels.pai && !paiTun.ok) {
    alerts.push({
      severity: 'warning',
      bot: 'tunnels',
      title: 'Tunnel PAI caído',
      detail: paiTun.error || `HTTP ${paiTun.status} — docker compose restart tunnels`,
    });
  }
  if (tunnels.licencias && !licTun.ok) {
    alerts.push({
      severity: 'warning',
      bot: 'tunnels',
      title: 'Tunnel Licencias caído',
      detail: licTun.error || `HTTP ${licTun.status} — docker compose restart tunnels`,
    });
  }

  const snapshot = {
    ts: new Date().toISOString(),
    bots: { pai, licencias: lic },
    reconnects,
    tunnels: {
      ...tunnels,
      paiReachable: paiTun.ok,
      licenciasReachable: licTun.ok,
    },
    alerts,
    notes: [
      'Actualizaciones de protocolo WA: el bot refresca versión solo (Baileys fetchLatest).',
      'Si WhatsApp desvincula el dispositivo: aparece needs_qr — hay que escanear una vez.',
      'Contenedores: restart unless-stopped + autostart Windows (npm run docker:autostart).',
    ],
  };

  writeAlerts(snapshot);

  const summary = alerts.length
    ? alerts.map((a) => `${a.severity}:${a.title}`).join(' | ')
    : 'all_ok';
  console.log(`[maintain] ${snapshot.ts} ${summary}`);
}

console.log(`[maintain] interval=${INTERVAL_MS}ms pai=${PAI_URL} lic=${LIC_URL}`);
ensureState();
void tick();
setInterval(() => { void tick(); }, INTERVAL_MS);
