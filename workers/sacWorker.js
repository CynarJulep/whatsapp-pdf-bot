require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { runSacSingleClaimFetch } = require('../services/sacAutomation');

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SAC_USER',
  'SAC_PASSWORD'
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`[SAC Worker] Faltan variables: ${missing.join(', ')}`);
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const pollMs = Math.max(2000, Number(process.env.SAC_WORKER_POLL_MS || 5000));
const sessionId = process.env.SAC_SESSION_STATE_ID || 'default';
let stopping = false;

function sanitizeStorageSegment(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

async function loadSessionState() {
  const { data, error } = await supabase
    .from('sac_session_state')
    .select('state')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la sesión SAC: ${error.message}`);
  return data?.state || null;
}

async function saveSessionState(state) {
  const { error } = await supabase
    .from('sac_session_state')
    .upsert({ id: sessionId, state, updated_at: new Date().toISOString() });
  if (error) throw new Error(`No se pudo guardar la sesión SAC: ${error.message}`);
}

async function claimNextJob() {
  const { data: queued, error: findError } = await supabase
    .from('sac_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (findError) throw new Error(`No se pudo consultar la cola: ${findError.message}`);
  if (!queued) return null;

  const { data: claimed, error: claimError } = await supabase
    .from('sac_jobs')
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
      finished_at: null,
      error_message: null
    })
    .eq('id', queued.id)
    .eq('status', 'queued')
    .select('*')
    .maybeSingle();

  if (claimError) throw new Error(`No se pudo tomar el job: ${claimError.message}`);
  return claimed || null;
}

async function finishJob(job, patch) {
  const { error } = await supabase.from('sac_jobs').update(patch).eq('id', job.id);
  if (error) throw new Error(`No se pudo actualizar el job ${job.id}: ${error.message}`);
}

async function processJob(job) {
  console.log(`[SAC Worker] Procesando ${job.numero_reclamo}/${job.anio} (${job.id})`);
  try {
    const { pdfBuffer, suggestedFileName } = await runSacSingleClaimFetch({
      numeroReclamo: job.numero_reclamo,
      anio: job.anio,
      usuario: process.env.SAC_USER,
      contrasena: process.env.SAC_PASSWORD,
      loadSessionState,
      saveSessionState
    });

    const safeNumber = sanitizeStorageSegment(job.numero_reclamo);
    const safeName = sanitizeStorageSegment(
      suggestedFileName || `${safeNumber}_${job.anio}.pdf`
    );
    const storagePath = `sac/${job.anio}/${Date.now()}_${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from('pdfs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false
      });
    if (uploadError) throw new Error(`No se pudo subir el PDF: ${uploadError.message}`);

    await finishJob(job, {
      status: 'ready',
      storage_path: storagePath,
      file_name: safeName,
      public_url: null,
      finished_at: new Date().toISOString(),
      error_message: null
    });
    console.log(`[SAC Worker] Listo ${job.numero_reclamo}/${job.anio}: ${storagePath}`);
  } catch (error) {
    const message = error?.message || 'Error desconocido en worker SAC';
    await finishJob(job, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_message: message
    });
    console.error(`[SAC Worker] Falló ${job.id}: ${message}`);
  }
}

async function recoverInterruptedJobs() {
  const { error } = await supabase
    .from('sac_jobs')
    .update({
      status: 'queued',
      started_at: null,
      error_message: 'Reencolado tras reinicio del worker local.'
    })
    .eq('status', 'running');
  if (error) throw new Error(`No se pudieron recuperar jobs interrumpidos: ${error.message}`);
}

async function main() {
  console.log(`[SAC Worker] Iniciado. Poll cada ${pollMs}ms. Cerrá con Ctrl+C.`);
  await recoverInterruptedJobs();

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
