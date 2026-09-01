/**
 * Resuelve la URL del backend en runtime.
 *
 * Prod = Docker en esta PC (pai :3001 / licencias :3002) publicado por
 * Cloudflare Quick Tunnels. Netlify (ac-pai-wp.netlify.app) es solo el
 * front + proxy: no hay bot en Render ni Hugging Face.
 *
 * Orden:
 *   1) cache corta
 *   2) registry público en Supabase (lo actualiza el servicio `tunnels`)
 *   3) env BACKEND_URL / RENDER_BACKEND_URL / RAILWAY_URL — solo si NO es Render
 *
 * Nunca caer a *.onrender.com: Render + Docker usan las mismas session_id
 * (pai / licencias) y WhatsApp los echa en loop (disconnect 440 conflict).
 */
const REGISTRY_PATH = process.env.BACKEND_REGISTRY_OBJECT || 'backend-endpoints.json';
const CACHE_MS = Number(process.env.BACKEND_REGISTRY_CACHE_MS || 15_000);

let cache = { at: 0, pai: null, licencias: null };

/** URLs de bots cloud retirados. Pegarlas despierta Render y pelea la sesión WA. */
export function isRetiredCloudBackend(url) {
  const u = String(url || '').toLowerCase();
  return u.includes('onrender.com') || u.includes('.hf.space');
}

function cleanUrl(raw) {
  const cleaned = String(raw || '').trim().replace(/\/$/, '');
  if (!cleaned || isRetiredCloudBackend(cleaned)) return null;
  return cleaned;
}

function envFallback(kind = 'pai') {
  const paiFirst = [
    process.env.BACKEND_URL,
    process.env.RENDER_BACKEND_URL,
    process.env.RAILWAY_URL,
  ];
  const licenciasFirst = [
    process.env.LICENCIAS_BACKEND_URL,
    process.env.RENDER_LICENCIAS_URL,
    process.env.BACKEND_URL,
  ];
  const list = kind === 'licencias' ? licenciasFirst : paiFirst;
  for (const raw of list) {
    const url = cleanUrl(raw);
    if (url) return url;
  }
  return null;
}

function registryPublicUrl() {
  const base = (process.env.SUPABASE_URL || 'https://hltyozdvcqfmvqmyrlva.supabase.co').replace(/\/$/, '');
  const bucket = process.env.BACKEND_REGISTRY_BUCKET || 'runtime';
  return `${base}/storage/v1/object/public/${bucket}/${REGISTRY_PATH}`;
}

export async function resolveBackendUrl(kind = 'pai') {
  const now = Date.now();
  if (cache.at && now - cache.at < CACHE_MS && cache[kind]) {
    return cache[kind];
  }

  try {
    const res = await fetch(registryPublicUrl(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      const pai = cleanUrl(data.pai);
      const licencias = cleanUrl(data.licencias);
      if (pai || licencias) {
        cache = { at: now, pai: pai || null, licencias: licencias || null };
        const picked = kind === 'licencias' ? (licencias || pai) : (pai || licencias);
        if (picked) return picked;
      }
    }
  } catch {
    // registry caído — probamos env (nunca Render)
  }

  return envFallback(kind);
}

export { registryPublicUrl, REGISTRY_PATH };
