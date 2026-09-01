# Búsqueda automática de reclamos SAC

## Objetivo

El operador escribe **número + año** en la UI. El backend descarga el PDF del portal SAC con Playwright, lo guarda en Supabase Storage y la página lo muestra en el preview existente para enviarlo por WhatsApp (igual que un PDF cargado a mano).

## Arquitectura (Docker local = prod)

```
Operador → Netlify (UI + sac-proxy) → tunnel Cloudflare → contenedor pai
                                                              ↓
                                                        Playwright / SAC
                                                              ↓
                                                        sac_jobs (Supabase)
                                                              ↓
                                                        Storage pdfs/
                                                              ↓
                                                        Preview → /send-pdf → WhatsApp
```

- Frontend: formulario en `frontend/src/App.jsx` (`SacClaimSearch`).
- Proxy: `netlify/functions/sac-proxy.mjs` inyecta `SAC_AUTOMATION_TOKEN`.
- Backend: `POST /sac/fetch-single-claim`, `GET /sac/jobs/:id` en `index.js` (contenedor `pai`).
- Automatización: `services/sacAutomation.js` (Playwright Chromium en Docker).
- Sesión SAC: volumen `./.sac-session` + tabla `sac_session_state`.

No uses Render para SAC ni para el bot: misma `session_id` que Docker → WhatsApp 440.

## Variables de entorno

### Docker `pai` (`.env` / compose)

| Variable | Valor |
|----------|--------|
| `SAC_FEATURE_ENABLED` | `true` |
| `SAC_PROCESS_JOBS` | `true` |
| `SAC_USER` | usuario portal SAC |
| `SAC_PASSWORD` | contraseña portal SAC |
| `SAC_AUTOMATION_TOKEN` | secret largo aleatorio (obligatorio en producción) |
| `SAC_MAX_CONCURRENT_JOBS` | `1` (recomendado) |
| `SAC_HEADLESS` | `true` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | ya existentes |

### Netlify (frontend + function)

| Variable | Valor |
|----------|--------|
| `SAC_AUTOMATION_TOKEN` | **el mismo** secret que en el contenedor `pai` |

El destino del bot sale del registry de tunnels, no de `RENDER_BACKEND_URL`.

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

1. Docker `pai` con SAC enabled (`npm run docker:up`).
2. Desde esta PC:

```powershell
curl -X POST http://127.0.0.1:3001/sac/fetch-single-claim `
  -H "Content-Type: application/json" `
  -H "x-sac-automation-token: TU_TOKEN" `
  -d "{\"numeroReclamo\":\"12345\",\"anio\":2026}"
```

3. Poll:

```powershell
curl http://127.0.0.1:3001/sac/jobs/JOB_ID `
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

## Fallback: worker SAC aparte (headless bloqueado)

Si Chromium headless en Docker no pasa Cloudflare:

1. En compose de `pai`: `SAC_PROCESS_JOBS=false`. El API sigue en Docker y deja jobs `queued`.
2. En esta misma PC:

```powershell
npm install
npm run playwright:install
$env:SAC_BACKEND_URL="http://127.0.0.1:3001"
$env:SAC_AUTOMATION_TOKEN="el mismo token del contenedor pai"
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

- Token SAC solo en Docker `.env` + Netlify Function.
- URLs de PDF firmadas (TTL ~15 min), no públicas permanentes en jobs nuevos.
- Rate limit básico en el proxy Netlify.
- La Function **oculta** el secret; no reemplaza login de operadores. Para uso real conviene restringir el sitio (auth Netlify / allowlist) antes de operar con reclamos sensibles.

## Métricas útiles a mirar en logs

- Duración por job (`[SAC] Reclamo … listo en Xms`)
- Fallos por etapa (login / formulario / PDF / upload)
- Jobs marcados stale o interrumpidos por reinicio
