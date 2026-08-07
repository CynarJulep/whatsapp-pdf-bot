# Búsqueda automática de reclamos SAC

## Objetivo

El operador escribe **número + año** en la UI. El backend descarga el PDF del portal SAC con Playwright, lo guarda en Supabase Storage y la página lo muestra en el preview existente para enviarlo por WhatsApp (igual que un PDF cargado a mano).

## Arquitectura (cloud-first)

```
Operador → Netlify (UI + sac-proxy) → Render (index.js + Playwright)
                                         ↓
                                   sac_jobs (Supabase)
                                         ↓
                                   Storage pdfs/
                                         ↓
                                   Preview → /send-pdf → WhatsApp
```

- Frontend: formulario en `frontend/src/App.jsx` (`SacClaimSearch`).
- Proxy: `netlify/functions/sac-proxy.mjs` inyecta `SAC_AUTOMATION_TOKEN`.
- Backend: `POST /sac/fetch-single-claim`, `GET /sac/jobs/:id` en `index.js`.
- Automatización: `services/sacAutomation.js` (Playwright Chromium).
- Sesión SAC: disco local + tabla `sac_session_state` (sobrevive reinicios).

## Variables de entorno

### Render (backend)

| Variable | Valor |
|----------|--------|
| `SAC_FEATURE_ENABLED` | `true` |
| `SAC_USER` | usuario portal SAC |
| `SAC_PASSWORD` | contraseña portal SAC |
| `SAC_AUTOMATION_TOKEN` | secret largo aleatorio (obligatorio en producción) |
| `SAC_MAX_CONCURRENT_JOBS` | `1` (recomendado) |
| `SAC_HEADLESS` | `true` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | ya existentes |

### Netlify (frontend + function)

| Variable | Valor |
|----------|--------|
| `SAC_AUTOMATION_TOKEN` | **el mismo** secret que en Render |
| `RENDER_BACKEND_URL` | `https://whatsapp-pdf-bot-backend.onrender.com` (opcional) |

No pongas el token en el JavaScript del browser.

## Migraciones SQL (Supabase)

Ejecutar en orden si aún no están:

1. `migration_sac_jobs.sql` (o el bloque en `schema.sql`)
2. `migration_sac_session_state.sql`

## Docker / Playwright

El `Dockerfile` usa `node:20-bookworm-slim` e instala Chromium + deps. En local:

```powershell
npm install
npm run playwright:install
$env:SAC_FEATURE_ENABLED="true"
$env:SAC_USER="..."
$env:SAC_PASSWORD="..."
# token opcional en local
npm run backend
```

## Prueba controlada (spike)

1. Activar feature + credenciales en Render y redesplegar.
2. Desde una máquina con acceso:

```powershell
curl -X POST https://whatsapp-pdf-bot-backend.onrender.com/sac/fetch-single-claim `
  -H "Content-Type: application/json" `
  -H "x-sac-automation-token: TU_TOKEN" `
  -d "{\"numeroReclamo\":\"12345\",\"anio\":2026}"
```

3. Poll:

```powershell
curl https://whatsapp-pdf-bot-backend.onrender.com/sac/jobs/JOB_ID `
  -H "x-sac-automation-token: TU_TOKEN"
```

4. Verificar `status: ready`, `storagePath` y `signedUrl`.
5. En la UI: el formulario aparece solo si `/status` reporta `sac_enabled: true`.

Criterio de éxito: varias descargas consecutivas correctas antes de uso general.

## Flujo UI

1. **Buscar en SAC** → polling → PDF como `File` + `storagePath`.
2. Mismo preview / extracción / destinatarios.
3. Envío: si vino de SAC, **no re-sube** el PDF; usa `storagePath` en `/send-pdf`.
4. Carga manual sigue disponible debajo.

## Fallback: PC del trabajo (worker saliente)

Si Render/datacenter no puede loguear al SAC (bloqueo IP / headless):

1. En Render configurar `SAC_FEATURE_ENABLED=true` y `SAC_PROCESS_JOBS=false`. Render mantiene la API y deja los jobs `queued` en Supabase.
2. En la PC Windows de oficina:

```powershell
npm install
npm run playwright:install
$env:SAC_BACKEND_URL="https://whatsapp-pdf-bot-backend.onrender.com"
$env:SAC_AUTOMATION_TOKEN="el mismo token configurado en Render"
# Solo hacen falta si la sesión guardada expiró:
$env:SAC_USER="..."
$env:SAC_PASSWORD="..."
$env:SAC_HEADLESS="false"
npm run sac:worker
```

3. Si Cloudflare muestra una verificación, resolverla una vez en la ventana de Chromium. La sesión queda persistida en `sac_session_state`.
4. No abrir puertos públicos; la PC solo sale hacia Supabase y SAC.
5. Ejecutar `npm run sac:worker` desde Task Scheduler al iniciar sesión para recuperarlo tras un reinicio.

### Instalación permanente en Windows

El instalador crea la tarea `WhatsApp SAC Worker` bajo la cuenta `SYSTEM`, instala
Chromium en `C:\ProgramData\WhatsAppSacWorker`, protege las credenciales con ACL
y deshabilita suspensión/hibernación cuando la PC está enchufada:

```powershell
Start-Process powershell -Verb RunAs -Wait -ArgumentList `
  '-NoProfile -ExecutionPolicy Bypass -File "C:\Renzo\WHATSAPP\scripts\install-sac-worker.ps1"'
```

La pantalla puede apagarse y cualquier usuario puede iniciar/cerrar sesión sin
interrumpir el worker. El log operativo queda en
`C:\ProgramData\WhatsAppSacWorker\worker.log`.

El repo Python `sac-pdf-reclamos` queda como referencia de selectores, no como segundo backend de producción.

## Seguridad

- Token SAC solo en Render + Netlify Function.
- URLs de PDF firmadas (TTL ~15 min), no públicas permanentes en jobs nuevos.
- Rate limit básico en el proxy Netlify.
- La Function **oculta** el secret; no reemplaza login de operadores. Para uso real conviene restringir el sitio (auth Netlify / allowlist) antes de operar con reclamos sensibles.

## Métricas útiles a mirar en logs

- Duración por job (`[SAC] Reclamo … listo en Xms`)
- Fallos por etapa (login / formulario / PDF / upload)
- Jobs marcados stale o interrumpidos por reinicio
