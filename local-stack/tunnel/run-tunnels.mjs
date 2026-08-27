/**
 * Cloudflare Quick Tunnels (gratis).
 * Publica PAI + Licencias y registra URLs en:
 *  1) local-stack/state/tunnels.json
 *  2) Supabase Storage público (runtime/backend-endpoints.json)
 *
 * Netlify lee el registry en cada request → ac-pai-wp.netlify.app queda estático.
 *
 * Targets:
 *  - Host/PM2: PAI_PORT / LICENCIAS_PORT → http://127.0.0.1:PORT
 *  - Docker Compose: PAI_TUNNEL_TARGET / LICENCIAS_TUNNEL_TARGET → http://pai:7860
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const STATE_DIR = path.join(__dirname, '..', 'state');
const TUNNELS_FILE = path.join(STATE_DIR, 'tunnels.json');
const BIN_DIR = path.join(__dirname, '..', 'bin');
const REGISTRY_BUCKET = process.env.BACKEND_REGISTRY_BUCKET || 'runtime';
const REGISTRY_OBJECT = process.env.BACKEND_REGISTRY_OBJECT || 'backend-endpoints.json';

const PAI_PORT = Number(process.env.PAI_PORT || 3001);
const LICENCIAS_PORT = Number(process.env.LICENCIAS_PORT || 3002);
const PAI_TARGET = process.env.PAI_TUNNEL_TARGET || `http://127.0.0.1:${PAI_PORT}`;
const LICENCIAS_TARGET = process.env.LICENCIAS_TUNNEL_TARGET || `http://127.0.0.1:${LICENCIAS_PORT}`;

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const CLOUDFLARED_LINUX_URL =
  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });
}

function localBinPath() {
  return path.join(BIN_DIR, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}

function resolveCloudflared() {
  if (process.env.CLOUDFLARED_PATH && fs.existsSync(process.env.CLOUDFLARED_PATH)) {
    return process.env.CLOUDFLARED_PATH;
  }
  const local = localBinPath();
  if (fs.existsSync(local)) return local;
  return 'cloudflared';
}

async function ensureCloudflared() {
  const existing = resolveCloudflared();
  if (existing !== 'cloudflared' || process.env.CLOUDFLARED_AUTO_INSTALL !== '1') {
    return existing;
  }
  if (process.platform === 'win32') {
    console.error('[tunnels] CLOUDFLARED_AUTO_INSTALL no aplica en Windows; usá npm run local:setup');
    process.exit(1);
  }
  ensureDirs();
  const dest = localBinPath();
  console.log('[tunnels] descargando cloudflared →', dest);
  const res = await fetch(CLOUDFLARED_LINUX_URL);
  if (!res.ok) {
    console.error('[tunnels] download failed:', res.status, res.statusText);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf, { mode: 0o755 });
  return dest;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // Node 20: supabase-js exige transport WS explícito (en 22+ hay WebSocket nativo)
  return createClient(url, key, {
    realtime: { transport: WebSocket },
  });
}

async function publishRegistry(tunnels) {
  const supabase = getSupabase();
  if (!supabase) {
    console.warn('[tunnels] Sin SUPABASE_* — no se publica registry (Netlify seguirá con env fijo)');
    return;
  }

  const payload = {
    pai: tunnels.pai || null,
    licencias: tunnels.licencias || null,
    updatedAt: tunnels.updatedAt || new Date().toISOString(),
  };
  const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');

  const { error } = await supabase.storage
    .from(REGISTRY_BUCKET)
    .upload(REGISTRY_OBJECT, body, {
      contentType: 'application/json',
      upsert: true,
      cacheControl: '15',
    });

  if (error) {
    console.warn('[tunnels] registry upload failed:', error.message);
    return;
  }

  const publicUrl = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${REGISTRY_BUCKET}/${REGISTRY_OBJECT}`;
  console.log('[tunnels] registry OK →', publicUrl);
}

function writeTunnels(partial) {
  ensureDirs();
  let current = {};
  try {
    if (fs.existsSync(TUNNELS_FILE)) current = JSON.parse(fs.readFileSync(TUNNELS_FILE, 'utf8'));
  } catch { /* ignore */ }
  const next = {
    ...current,
    ...partial,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(TUNNELS_FILE, JSON.stringify(next, null, 2));
  console.log('[tunnels] state →', TUNNELS_FILE);
  console.log('[tunnels]', JSON.stringify({ pai: next.pai, licencias: next.licencias }, null, 2));
  void publishRegistry(next);
}

function startTunnel(name, targetUrl) {
  const bin = resolveCloudflared();
  const args = ['tunnel', '--url', targetUrl, '--no-autoupdate'];
  console.log(`[tunnels] starting ${name}: ${bin} ${args.join(' ')}`);

  const child = spawn(bin, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
    detached: false,
  });

  const onChunk = (buf) => {
    const text = buf.toString();
    process.stdout.write(`[${name}] ${text}`);
    const match = text.match(URL_RE);
    if (match) {
      writeTunnels({ [name]: match[0] });
    }
  };

  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);

  child.on('exit', (code, signal) => {
    console.warn(`[tunnels] ${name} exited code=${code} signal=${signal}`);
    process.exit(code || 1);
  });

  return child;
}

ensureDirs();

const boot = async () => {
  const bin = await ensureCloudflared();
  await new Promise((resolve, reject) => {
    const probe = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    probe.on('error', () => {
      console.error('[tunnels] cloudflared no encontrado. Corré: npm run local:setup (host) o CLOUDFLARED_AUTO_INSTALL=1 (Linux/Docker)');
      reject(new Error('cloudflared missing'));
    });
    probe.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`cloudflared --version exit ${code}`))));
  }).catch(() => process.exit(1));

  startTunnel('pai', PAI_TARGET);
  startTunnel('licencias', LICENCIAS_TARGET);
  console.log('[tunnels] corriendo — registry Supabase = URL estable para Netlify');
  console.log('[tunnels] targets:', { pai: PAI_TARGET, licencias: LICENCIAS_TARGET });
};

void boot();
