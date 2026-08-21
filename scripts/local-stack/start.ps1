#Requires -Version 5.1
param(
  [string]$ProjectDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)
$ErrorActionPreference = 'Stop'
Set-Location $ProjectDir

$pm2 = Join-Path $ProjectDir 'node_modules\.bin\pm2.cmd'
if (-not (Test-Path $pm2)) {
  throw 'PM2 no está. Corré: npm run local:setup'
}

$envFile = Join-Path $ProjectDir '.env'
if (-not (Test-Path $envFile)) {
  throw 'Falta .env. Corré: npm run local:setup'
}

# Asegurar cloudflared
$cf = Join-Path $ProjectDir 'local-stack\bin\cloudflared.exe'
if (-not (Test-Path $cf)) {
  Write-Host 'cloudflared ausente — corriendo setup…'
  & (Join-Path $PSScriptRoot 'setup.ps1') -ProjectDir $ProjectDir
}

Write-Host '==> PM2 start ecosystem (ventanas ocultas)'
& $pm2 delete ecosystem.config.cjs 2>$null
& $pm2 start ecosystem.config.cjs
& $pm2 save

Write-Host ''
Write-Host 'Dashboard: http://127.0.0.1:9100'
Write-Host 'PAI:       http://127.0.0.1:3001/status'
Write-Host 'Licencias: http://127.0.0.1:3002/status'
Write-Host 'Logs:      npm run local:logs'
