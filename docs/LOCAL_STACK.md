# Stack local gratis (PC siempre encendida)

Espejo de los 2 servicios Render (`pai` + `licencias`) en esta PC, con métricas y tunnels Cloudflare free. Sin Docker.

## Qué incluye

| Proceso PM2 | Puerto | Rol |
|-------------|--------|-----|
| `wa-pai` | 3001 | Bot PAI + SAC |
| `wa-licencias` | 3002 | Bot licencias |
| `wa-dashboard` | 9100 | Métricas en vivo |
| `wa-tunnels` | — | Cloudflare Quick Tunnels ($0) |

Auto-reinicio: PM2. Auto-arranque al loguear: Task Scheduler (`npm run local:autostart`).

## URL estática (sin pagar dominio)

La URL pública **no cambia**: `https://ac-pai-wp.netlify.app`

Los quick tunnels de Cloudflare sí rotan al reiniciar. Al arrancar, `wa-tunnels` publica las URLs actuales en Supabase Storage:

`https://hltyozdvcqfmvqmyrlva.supabase.co/storage/v1/object/public/runtime/backend-endpoints.json`

Netlify (`api-proxy` / `sac-proxy`) lee ese JSON en cada request (cache ~15s). Si el tunnel se reinicia, en segundos el sitio vuelve a apuntar solo — sin tocar Netlify a mano.

## Setup (una vez)

```powershell
cd C:\Renzo\WHATSAPP

# Opción A — traer secrets desde Render
$env:RENDER_API_KEY = "rnd_xxx"
npm run local:setup

# Opción B — sin Render: editar .env a mano (se crea desde .env.example)
npm run local:setup
notepad .env
```

## Arrancar

```powershell
npm run local:start
npm run local:autostart   # opcional: revive al iniciar Windows
```

- Dashboard: http://127.0.0.1:9100  
- PAI: http://127.0.0.1:3001/status  
- Licencias: http://127.0.0.1:3002/status  

Los tunnels públicos aparecen en el dashboard (URLs `*.trycloudflare.com`).

## Netlify → PC

1. En Netlify → Site settings → Environment variables:
   - `BACKEND_URL` = URL pública del tunnel **PAI** (la del dashboard)
   - `RENDER_BACKEND_URL` = igual (compat)
   - `RENDER_LICENCIAS_URL` = tunnel licencias (keep-alive)
2. Redeploy del sitio (para que las functions tomen el env).

Si definís `NETLIFY_AUTH_TOKEN` + `NETLIFY_SITE_ID` en `.env`, el proceso `wa-tunnels` intenta actualizar `BACKEND_URL` solo cuando cambia el tunnel.

`netlify.toml` ya proxya `/api/*` → `api-proxy` (lee `BACKEND_URL`).

## Comandos útiles

```powershell
npm run local:status
npm run local:logs
npm run local:stop
npx pm2 restart all
```

## Notas

- Auth Baileys sigue en **Supabase** (igual que Render): no perdés sesión al mover.
- Quick Tunnels son gratis; la URL puede cambiar si reinicia `wa-tunnels` → mirá el dashboard y actualizá Netlify (o usá el sync automático).
- Keep-alive de GitHub/Netlify ya no es crítico (la PC no se duerme como Render free), pero no estorba.
- Rotá la API key de Render si la pegaste en el chat.
