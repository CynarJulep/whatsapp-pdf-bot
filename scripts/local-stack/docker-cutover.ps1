# Cutover / arranque prod: PM2 off → Docker con sessions reales + tunnels.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))

New-Item -ItemType Directory -Force -Path '.sac-session' | Out-Null

Write-Host '[docker:cutover] Deteniendo PM2...'
npx pm2 stop all 2>$null
npx pm2 delete all 2>$null

$env:PAI_HOST_PORT = '3001'
$env:LICENCIAS_HOST_PORT = '3002'
$env:DASHBOARD_HOST_PORT = '9100'
$env:DOCKER_PAI_SESSION = 'pai'
$env:DOCKER_LICENCIAS_SESSION = 'licencias'
$env:COMPOSE_PROFILES = 'tunnels'

Write-Host '[docker:cutover] Recreando stack Docker (prod + tunnels)...'
docker compose down --remove-orphans 2>$null
docker compose --profile tunnels up -d

Write-Host '[docker:cutover] Esperando health...'
Start-Sleep -Seconds 15
docker compose --profile tunnels ps

Write-Host '[docker:cutover] Listo. Verificá:'
Write-Host '  http://127.0.0.1:3001/status'
Write-Host '  http://127.0.0.1:3002/status'
Write-Host '  http://127.0.0.1:9100'
Write-Host '  https://ac-pai-wp.netlify.app/api/ping'
Write-Host 'Rollback: docker compose --profile tunnels down ; npm run local:start'
