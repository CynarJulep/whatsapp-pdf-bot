/**
 * Keep-alive del backend en Render (plan free).
 * Sin HTTP periódico, Render hiberna ~15 min y el bot “se apaga”.
 * Esta función corre cada 10 minutos en deploys publicados de Netlify.
 */
const BACKENDS = [
  process.env.RENDER_BACKEND_URL || 'https://whatsapp-pdf-bot-backend.onrender.com',
  process.env.RENDER_LICENCIAS_URL || 'https://whatsapp-licencias-bot.onrender.com',
]
  .map((url) => String(url || '').replace(/\/$/, ''))
  .filter(Boolean);

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

  const unique = [...new Set(BACKENDS)];
  const results = [];
  for (const base of unique) {
    results.push(await pingBackend(base));
  }

  const allOk = results.every((r) => r.ok);
  console.log('[keep-alive-render]', JSON.stringify({ nextRun, results }));

  return new Response(JSON.stringify({ ok: allOk, nextRun, results }), {
    status: allOk ? 200 : 502,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const config = {
  schedule: '*/10 * * * *',
};
