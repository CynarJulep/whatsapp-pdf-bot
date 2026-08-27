#Requires -Version 5.1
<#
.SYNOPSIS
  Compat: redirige al always-on (auto-login + Docker + lock + energia).
  Preferí: npm run docker:always-on
#>
param(
  [string]$ProjectDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [switch]$Uninstall,
  [switch]$LegacySilentOnly
)

$ErrorActionPreference = 'Stop'

if ($LegacySilentOnly) {
  # Antiguo: solo VBS en Startup, sin auto-login ni lock
  $bootDir = Join-Path $env:LOCALAPPDATA 'WhatsAppLocalStack'
  New-Item -ItemType Directory -Force -Path $bootDir | Out-Null
  $runner = Join-Path $bootDir 'boot-docker.ps1'
  $log = Join-Path $bootDir 'boot-docker.log'
  $vbs = Join-Path $bootDir 'boot-docker-silent.vbs'

  @"
`$ErrorActionPreference = 'Continue'
Set-Location '$ProjectDir'
`$log = '$log'
function Log(`$m) { "[`$(Get-Date -Format o)] `$m" | Out-File `$log -Append -Encoding utf8 }
Log 'docker boot start'
Start-Sleep -Seconds 25
`$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not `$docker) { Log 'docker missing'; exit 1 }
for (`$i = 0; `$i -lt 60; `$i++) {
  docker info 1>`$null 2>`$null
  if (`$LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 5
}
docker info 1>`$null 2>`$null
if (`$LASTEXITCODE -ne 0) { Log 'docker engine not ready'; exit 1 }
Log 'docker engine ok'
`$env:COMPOSE_PROFILES = 'tunnels'
& docker compose --profile tunnels up -d *>> `$log
Log "compose exit=`$LASTEXITCODE"
Log 'docker boot done'
"@ | Set-Content -Path $runner -Encoding utf8

  @"
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$runner""", 0, False
"@ | Set-Content -Path $vbs -Encoding ascii

  $startupDir = [Environment]::GetFolderPath('Startup')
  foreach ($name in @('WhatsApp-Local-Stack.cmd', 'WhatsApp-Local-Stack.vbs')) {
    $p = Join-Path $startupDir $name
    if (Test-Path $p) { Remove-Item $p -Force }
  }
  Copy-Item $vbs (Join-Path $startupDir 'WhatsApp-Docker-Stack.vbs') -Force
  Write-Host "Legacy silent autostart OK (sin auto-login/lock)."
  exit 0
}

Write-Host 'docker:autostart ahora usa always-on (auto-login + ventana + lock + energia).' -ForegroundColor Cyan
Write-Host 'Para el modo silencioso viejo: -LegacySilentOnly' -ForegroundColor DarkGray
Write-Host ''

$installer = Join-Path $PSScriptRoot 'install-docker-always-on.ps1'
$psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $installer, '-ProjectDir', $ProjectDir)
if ($Uninstall) { $psArgs += '-Uninstall' }
& powershell.exe @psArgs
exit $LASTEXITCODE
