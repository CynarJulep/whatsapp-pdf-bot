/**
 * Cloudflare Quick Tunnels (gratis, sin dominio).
 * Publica PAI (:3001) y Licencias (:3002) y guarda URLs en local-stack/state/tunnels.json
 * Opcional: actualiza env de Netlify si hay NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const STATE_DIR = path.join(__dirname, '..', 'state');
const TUNNELS_FILE = path.join(STATE_DIR, 'tunnels.json');
const BIN_DIR = path.join(__dirname, '..', 'bin');

const PAI_PORT = Number(process.env.PAI_PORT || 3001);
const LICENCIAS_PORT = Number(process.env.LICENCIAS_PORT || 3002);

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });
}

function resolveCloudflared() {
  if (process.env.CLOUDFLARED_PATH && fs.existsSync(process.env.CLOUDFLARED_PATH)) {
    return process.env.CLOUDFLARED_PATH;
  }
  const local = path.join(BIN_DIR, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (fs.existsSync(local)) return local;
  return 'cloudflared';
}

function writeTunnels( partial ) {
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
  void maybeSyncNetlify(next);
}

async function maybeSyncNetlify(tunnels) {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  const siteId = process.env.NETLIFY_SITE_ID;
  if (!token || !siteId || !tunnels.pai) {
    return;
  }
  try {
    const res = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        env: {
          BACKEND_URL: tunnels.pai,
          RENDER_BACKEND_URL: tunnels.pai,
          RENDER_LICENCIAS_URL: tunnels.licencias || '',
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn('[tunnels] Netlify sync failed:', res.status, text.slice(0, 300));
      return;
    }
    console.log('[tunnels] Netlify env actualizado (BACKEND_URL → tunnel PAI)');
  } catch (err) {
    console.warn('[tunnels] Netlify sync error:', err.message);
  }
}

function startTunnel(name, port) {
  const bin = resolveCloudflared();
  const args = ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'];
  console.log(`[tunnels] starting ${name}: ${bin} ${args.join(' ')}`);

  const child = spawn(bin, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
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
    // PM2 reinicia el proceso completo; si un hijo solo muere, matamos el padre
    process.exit(code || 1);
  });

  return child;
}

ensureDirs();
const bin = resolveCloudflared();
try {
  const probe = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  probe.on('error', () => {
    console.error('[tunnels] cloudflared no encontrado. Corré: npm run local:setup');
    process.exit(1);
  });
} catch {
  console.error('[tunnels] cloudflared no encontrado. Corré: npm run local:setup');
  process.exit(1);
}

startTunnel('pai', PAI_PORT);
startTunnel('licencias', LICENCIAS_PORT);

console.log('[tunnels] corriendo (quick tunnels Cloudflare, $0)');
