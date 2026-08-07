const BACKEND_URL = (
  process.env.RENDER_BACKEND_URL ||
  process.env.RAILWAY_URL ||
  'https://whatsapp-pdf-bot-backend.onrender.com'
).replace(/\/$/, '');

const SAC_AUTOMATION_TOKEN = process.env.SAC_AUTOMATION_TOKEN || '';

/** Simple in-memory rate limit per IP (resets on cold start). */
const hits = new Map();
const RATE_LIMIT = Number(process.env.SAC_PROXY_RATE_LIMIT || 30);
const RATE_WINDOW_MS = Number(process.env.SAC_PROXY_RATE_WINDOW_MS || 60_000);

function clientIp(req, context) {
  return (
    context?.ip ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function allowRequest(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Resolve backend path `/sac/...` from either:
 * - Direct function path config: /api/sac/...
 * - Redirect rewrite: /.netlify/functions/sac-proxy/sac/...
 */
function resolveSacPath(pathname) {
  const apiMatch = pathname.match(/^\/api(\/sac(?:\/.*)?)$/);
  if (apiMatch) return apiMatch[1];

  const fnMatch = pathname.match(/\/\.netlify\/functions\/sac-proxy(\/sac(?:\/.*)?)$/);
  if (fnMatch) return fnMatch[1];

  // Fallback: trailing splat after function name
  const splatMatch = pathname.match(/\/\.netlify\/functions\/sac-proxy\/?(.*)$/);
  if (splatMatch) {
    const rest = (splatMatch[1] || '').replace(/^\/+/, '');
    if (!rest || rest === 'sac') return '/sac';
    return rest.startsWith('sac/') || rest.startsWith('sac?')
      ? `/${rest}`
      : `/sac/${rest}`;
  }

  return null;
}

/**
 * Proxy seguro /api/sac/* → backend Render /sac/*
 * Inyecta x-sac-automation-token desde env (nunca expuesto al browser).
 */
export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const ip = clientIp(req, context);
  if (!allowRequest(ip)) {
    return json(429, {
      success: false,
      message: 'Demasiadas solicitudes. Esperá un momento e intentá de nuevo.',
    });
  }

  const url = new URL(req.url);
  const targetPath = resolveSacPath(url.pathname);
  if (!targetPath) {
    return json(404, { success: false, message: 'Ruta SAC no encontrada.' });
  }

  const target = `${BACKEND_URL}${targetPath}${url.search}`;

  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  if (SAC_AUTOMATION_TOKEN) {
    headers.set('x-sac-automation-token', SAC_AUTOMATION_TOKEN);
  }

  const init = {
    method: req.method,
    headers,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text();
  }

  try {
    const upstream = await fetch(target, init);
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error de proxy SAC';
    return json(502, {
      success: false,
      message: 'No se pudo contactar al backend SAC.',
      error: message,
    });
  }
};

export const config = {
  path: ['/api/sac', '/api/sac/*'],
  method: ['GET', 'POST', 'OPTIONS'],
};
