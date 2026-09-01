/**
 * Health del tunnel local (cada 10 min).
 * Lee el registry Supabase → Cloudflare → Docker en esta PC.
 * No despierta Render: si el registry apunta a onrender, resolve-backend lo descarta.
 */
import { resolveBackendUrl } from './lib/resolve-backend.mjs';

async function pingBackend(baseUrl) {
  const url = `${baseUrl}/ping`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(25_000),
    });
    const body = await res.text();
    return {
      url,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      body: body.slice(0, 200),
    };
  } catch (err) {
    return {
      url,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: err?.message || String(err),
    };
  }
}

export default async (req) => {
  let nextRun = null;
  try {
    const payload = await req.json();
    nextRun = payload?.next_run || null;
  } catch {
    /* invoke manual sin body */
  }

  const pai = await resolveBackendUrl('pai');
  const licencias = await resolveBackendUrl('licencias');
  const unique = [...new Set([pai, licencias].filter(Boolean))];
  // unique no incluye onrender: resolve-backend las descarta a propósito.

  const results = [];
  for (const base of unique) {
    results.push(await pingBackend(base));
  }

  const allOk = results.length > 0 && results.every((r) => r.ok);
  console.log('[keep-alive]', JSON.stringify({ nextRun, results }));

  return new Response(JSON.stringify({ ok: allOk, nextRun, results }), {
    status: allOk ? 200 : 502,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const config = {
  schedule: '*/10 * * * *',
};
