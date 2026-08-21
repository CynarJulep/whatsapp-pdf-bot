/**
 * Resuelve la URL del backend PAI en runtime.
 * Orden: cache → Supabase Storage registry → env → fallback Render.
 * Así ac-pai-wp.netlify.app queda estático aunque el tunnel rote.
 */
const REGISTRY_PATH = process.env.BACKEND_REGISTRY_OBJECT || 'backend-endpoints.json';
const CACHE_MS = Number(process.env.BACKEND_REGISTRY_CACHE_MS || 15_000);

let cache = { at: 0, pai: null, licencias: null };

function envFallback() {
  return (
    process.env.BACKEND_URL ||
    process.env.RENDER_BACKEND_URL ||
    process.env.RAILWAY_URL ||
    'https://whatsapp-pdf-bot-backend.onrender.com'
  ).replace(/\/$/, '');
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
      const pai = (data.pai || '').replace(/\/$/, '');
      const licencias = (data.licencias || '').replace(/\/$/, '');
      if (pai || licencias) {
        cache = { at: now, pai: pai || null, licencias: licencias || null };
        const picked = kind === 'licencias' ? (licencias || pai) : (pai || licencias);
        if (picked) return picked;
      }
    }
  } catch {
    // ignore — usamos env
  }

  return envFallback();
}

export { registryPublicUrl, REGISTRY_PATH };
