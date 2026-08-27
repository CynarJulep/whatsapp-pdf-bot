/**
 * Dashboard local gratis — métricas de PAI + licencias.
 * http://127.0.0.1:9100
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.DASHBOARD_PORT || 9100);
const PAI_URL = (process.env.PAI_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const LICENCIAS_URL = (process.env.LICENCIAS_URL || 'http://127.0.0.1:3002').replace(/\/$/, '');
const STATE_DIR = path.join(__dirname, '..', 'state');
const TUNNELS_FILE = path.join(STATE_DIR, 'tunnels.json');
const ALERTS_FILE = path.join(STATE_DIR, 'alerts.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function fetchJson(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
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
  });
}

function fetchText(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, text: body }));
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
  });
}

function readTunnels() {
  try {
    if (!fs.existsSync(TUNNELS_FILE)) return null;
    return JSON.parse(fs.readFileSync(TUNNELS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function readAlerts() {
  try {
    if (!fs.existsSync(ALERTS_FILE)) return null;
    return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function collectSnapshot() {
  const [paiStatus, licStatus, paiMetrics, licMetrics] = await Promise.all([
    fetchJson(`${PAI_URL}/status`),
    fetchJson(`${LICENCIAS_URL}/status`),
    fetchText(`${PAI_URL}/metrics`),
    fetchText(`${LICENCIAS_URL}/metrics`),
  ]);
  return {
    ts: new Date().toISOString(),
    tunnels: readTunnels(),
    maintain: readAlerts(),
    bots: {
      pai: { url: PAI_URL, status: paiStatus },
      licencias: { url: LICENCIAS_URL, status: licStatus },
    },
    metrics_text: {
      pai: paiMetrics.ok ? paiMetrics.text : null,
      licencias: licMetrics.ok ? licMetrics.text : null,
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/api/snapshot') {
    const snap = await collectSnapshot();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(snap));
    return;
  }

  if (url.pathname === '/metrics') {
    const [pai, lic] = await Promise.all([
      fetchText(`${PAI_URL}/metrics`),
      fetchText(`${LICENCIAS_URL}/metrics`),
    ]);
    const merged = [
      pai.ok ? pai.text : '# pai down',
      lic.ok ? lic.text : '# licencias down',
      '',
    ].join('\n');
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(merged);
    return;
  }

  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dashboard] http://127.0.0.1:${PORT}`);
});
