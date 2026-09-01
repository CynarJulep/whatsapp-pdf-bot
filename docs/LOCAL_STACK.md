# Stack local = PROD (PC siempre encendida)

**Prod actual = Docker Compose en esta PC.** Netlify (`https://ac-pai-wp.netlify.app`) es el sitio + proxy. Los bots **no** corren en Render.

> No levantes `whatsapp-pdf-bot-backend` / `whatsapp-licencias-bot` en Render al mismo tiempo: mismas `session_id` (`pai`, `licencias`) → WhatsApp **440 conflict** (se “apaga y prende”). El keep-alive de GitHub a onrender está deshabilitado. Suspendé esos servicios en el dashboard si siguen vivos.

## Qué incluye (Docker — prod)

| Servicio | Puerto | Session | Rol |
|----------|--------|---------|-----|
| `pai` | 3001 | `pai` | Bot PAI + SAC + Playwright |
| `licencias` | 3002 | `licencias` | Bot licencias |
| `dashboard` | 9100 | — | Métricas en vivo |
| `tunnels` | — | profile `tunnels` | Cloudflare Quick Tunnels + registry Supabase |

Auth Baileys en **Supabase**. Al reiniciar Docker suele reconectar **sin QR nuevo**. Si aparece QR en `/status`, escanearlo desde WhatsApp → dispositivos vinculados.

```powershell
npm run docker:up         # compose + tunnels
npm run docker:ps
npm run docker:logs
npm run docker:down
npm run docker:always-on # auto-login + ventana + Docker + lock + sin sleep
npm run docker:autostart  # alias → always-on (legacy: -LegacySilentOnly)
npm run docker:cutover    # apaga PM2 y levanta Docker prod
```

- Dashboard: http://127.0.0.1:9100  
- PAI: http://127.0.0.1:3001/status  
- Licencias: http://127.0.0.1:3002/status  
- Sitio: https://ac-pai-wp.netlify.app  

Skill: `.agents/skills/docker-local-stack/`.

`Dockerfile.local` trae Playwright Chromium. Compose: `shm_size: 256mb`, `SAC_LOW_MEMORY=true`, volumen `./.sac-session`.

## Always-on (PC de escritorio compartida)

Objetivo: tras reinicio, este usuario entra solo → ventana “abriendo procesos” → Docker + compose → **lock**. La sesión sigue viva (contenedores corren) pero nadie ve el escritorio. Para usar la PC: desbloqueás con la clave. Para el día a día de otra persona: **Cambiar de usuario** (no cerrar sesión de este).

```powershell
# Una vez, como Admin, logueado en el usuario Docker:
npm run docker:always-on
# Pide la clave de Windows (queda en Winlogon — usuario dedicado).
```

También configura energía: **sin sleep/hibernación** con AC; monitor puede apagarse a los 15 min. En BIOS (opcional tras corte de luz): *Restore AC Power Loss = Power On*.

Probar sin reiniciar ni lock:

```powershell
powershell -NoProfile -File "$env:LOCALAPPDATA\WhatsAppLocalStack\boot-always-on.ps1" -SkipLock
```

Desinstalar: `.\scripts\local-stack\install-docker-always-on.ps1 -Uninstall`

## Auto-mantenimiento (que siga andando)

### Lo que ya es automático
| Caso | Qué hace |
|------|----------|
| Corte de red / WA reinicia socket | Reconnect con backoff |
| Protocolo WA viejo (405, etc.) | Invalida cache y pide versión nueva (`fetchLatestBaileysVersion`) |
| Mientras está conectado | Refresh proactivo de versión cada ~45 min |
| Proceso zombie (sin QR ni connect) | Watchdog cada 30s → reconnect |
| Contenedor caído | `restart: unless-stopped` |
| PC reinicia | Auto-login + tarea AlwaysOn + Docker + lock |
| Bot “stalled” | Servicio `maintain` llama `/reconnect` |
| Tunnel nuevo | `tunnels` republica registry → Netlify se actualiza solo |

### Lo que NO se puede 100% solo
Si WhatsApp **desvincula el dispositivo** (update del celular, “cerrar sesión en todos”, conflicto 440 mal manejado, etc.), hace falta **escanear QR una vez**. El bot borra creds viejas, genera QR y el dashboard marca **NEEDS QR**.

Mirar: http://127.0.0.1:9100

### Checklist “siempre up”
1. `npm run docker:always-on` (Admin, una vez)
2. Docker Desktop → **Start when you log in** (el installer también lo marca)
3. No cerrar sesión de este usuario; bloquear o *Cambiar de usuario*
4. De vez en cuando: `docker compose --profile tunnels up -d --build` si actualizás Baileys

### Si se rompe
```powershell
npm run docker:ps
npm run docker:logs
docker compose --profile tunnels restart tunnels
# último recurso:
npm run docker:cutover
```

## URL estática (sin pagar dominio)

La URL pública **no cambia**: `https://ac-pai-wp.netlify.app`

Los quick tunnels rotan al reiniciar. El servicio `tunnels` publica las URLs en:

`https://hltyozdvcqfmvqmyrlva.supabase.co/storage/v1/object/public/runtime/backend-endpoints.json`

Netlify lee ese JSON (cache ~15s).

## Sin escritorio abierto (PC compartida)

Chromium SAC siempre headless. Arranque: tarea `WhatsApp-Docker-AlwaysOn` (ventana de estado → lock). No hace falta dejar el usuario “a la vista”.

## SAC (buscar reclamos / preview PDF)

`SAC_PROCESS_JOBS=true` y Playwright en la imagen. Si falla Chromium: `docker compose logs pai`.

## Rollback a PM2

```powershell
docker compose --profile tunnels down
npm run local:start
npm run local:autostart
```

## Setup (una vez)

```powershell
cd C:\Renzo\WHATSAPP
# .env con secrets (Supabase, SAC, SMTP)
npm run docker:up
npm run docker:always-on
```

## Notas

- Keep-alive HTTP a Render **no** debe existir: despierta un segundo bot y pelea la sesión.
- La scheduled function de Netlify pega `/ping` al tunnel del registry (Docker).
- GitHub Actions `Keep-alive Render` está disabled y ya no pega onrender.
- Si algún día hace falta Render de backup: **primero** `docker compose --profile tunnels down`, después levantar Render. Nunca los dos.
