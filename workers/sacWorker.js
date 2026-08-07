require('dotenv').config();

const { runSacSingleClaimFetch } = require('../services/sacAutomation');

const backendUrl = (
  process.env.SAC_BACKEND_URL || 'https://whatsapp-pdf-bot-backend.onrender.com'
).replace(/\/$/, '');
const token = process.env.SAC_AUTOMATION_TOKEN || '';
const pollMs = Math.max(2000, Number(process.env.SAC_WORKER_POLL_MS || 5000));
let stopping = false;

if (!token) {
  console.error('[SAC Worker] Falta SAC_AUTOMATION_TOKEN.');
  process.exit(1);
}

async function api(path, options = {}) {
  const response = await fetch(`${backendUrl}${path}`, {
    ...options,
    headers: {
      'x-sac-automation-token': token,
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  if (!response.ok()) {
    throw new Error(body?.message || `Backend SAC respondió HTTP ${response.status}`);
  }
  return body;
}

async function loadSessionState() {
  const result = await api('/sac/worker/session');
  return result.state || null;
}

async function saveSessionState(state) {
  await api('/sac/worker/session', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state })
  });
}

async function claimNextJob() {
  const result = await api('/sac/worker/claim', { method: 'POST' });
  return result.job || null;
}

async function completeJob(job, pdfBuffer, suggestedFileName) {
  return api(`/sac/worker/jobs/${encodeURIComponent(job.id)}/complete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/pdf',
      'x-sac-file-name': encodeURIComponent(suggestedFileName || `${job.numero_reclamo}_${job.anio}.pdf`)
    },
    body: pdfBuffer
  });
}

async function failJob(job, message) {
  await api(`/sac/worker/jobs/${encodeURIComponent(job.id)}/fail`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message })
  });
}

async function processJob(job) {
  console.log(`[SAC Worker] Procesando ${job.numero_reclamo}/${job.anio} (${job.id})`);
  try {
    const { pdfBuffer, suggestedFileName } = await runSacSingleClaimFetch({
      numeroReclamo: job.numero_reclamo,
      anio: job.anio,
      usuario: process.env.SAC_USER || '',
      contrasena: process.env.SAC_PASSWORD || '',
      loadSessionState,
      saveSessionState
    });
    const result = await completeJob(job, pdfBuffer, suggestedFileName);
    console.log(`[SAC Worker] Listo ${job.numero_reclamo}/${job.anio}: ${result.job?.storagePath}`);
  } catch (error) {
    const message = error?.message || 'Error desconocido en worker SAC';
    await failJob(job, message).catch((reportError) => {
      console.error(`[SAC Worker] No se pudo reportar el fallo: ${reportError.message}`);
    });
    console.error(`[SAC Worker] Falló ${job.id}: ${message}`);
  }
}

async function main() {
  console.log(`[SAC Worker] Backend ${backendUrl}. Poll cada ${pollMs}ms. Cerrá con Ctrl+C.`);
  await api('/sac/worker/recover', { method: 'POST' });

  while (!stopping) {
    const job = await claimNextJob();
    if (job) {
      await processJob(job);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

main().catch((error) => {
  console.error('[SAC Worker] Error fatal:', error?.message || error);
  process.exit(1);
});
