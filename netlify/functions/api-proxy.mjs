import { resolveBackendUrl } from './lib/resolve-backend.mjs';

/**
 * Proxy genérico /api/* → backend (tunnel local vía registry Supabase, o env).
 * /api/sac queda en sac-proxy.mjs (force=true en netlify.toml).
 */
export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-api-key, x-sac-automation-token',
      },
    });
  }

  const incoming = new URL(req.url);
  let targetPath = incoming.pathname;

  const apiMatch = targetPath.match(/^\/api(\/.*)?$/);
  if (apiMatch) {
    targetPath = apiMatch[1] || '/';
  } else {
    const fnMatch = targetPath.match(/\/\.netlify\/functions\/api-proxy(?:\/(.*))?$/);
    if (fnMatch) {
      const rest = (fnMatch[1] || '').replace(/^\/+/, '');
      targetPath = rest ? `/${rest}` : '/';
    }
  }

  if (targetPath.startsWith('/sac')) {
    return new Response(JSON.stringify({
      success: false,
      message: 'Usá /api/sac (sac-proxy).',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const BACKEND_URL = await resolveBackendUrl('pai');
  const dest = `${BACKEND_URL}${targetPath}${incoming.search}`;
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('connection');

  try {
    const upstream = await fetch(dest, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(),
      redirect: 'manual',
    });

    const outHeaders = new Headers(upstream.headers);
    outHeaders.set('Cache-Control', 'no-store');
    outHeaders.set('X-Backend-Upstream', BACKEND_URL);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: outHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      message: 'Backend unreachable',
      backend: BACKEND_URL,
      error: err.message,
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
};
