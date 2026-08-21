#Requires -Version 5.1
<#
.SYNOPSIS
  Autoarranque sin admin: atajo en la carpeta Startup del usuario + pm2 save.
#>
param(
  [string]$ProjectDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)

$ErrorActionPreference = 'Stop'
$pm2 = Join-Path $ProjectDir 'node_modules\.bin\pm2.cmd'
if (-not (Test-Path $pm2)) { throw "PM2 missing at $pm2 - run npm run local:setup first" }

$bootDir = Join-Path $env:LOCALAPPDATA 'WhatsAppLocalStack'
New-Item -ItemType Directory -Force -Path $bootDir | Out-Null
$runner = Join-Path $bootDir 'boot.ps1'
$log = Join-Path $bootDir 'boot.log'

@"
`$ErrorActionPreference = 'Continue'
Set-Location '$ProjectDir'
`$pm2 = '$pm2'
`$log = '$log'
function Log(`$m) { "[`$(Get-Date -Format o)] `$m" | Out-File `$log -Append -Encoding utf8 }
Log 'boot start'
Start-Sleep -Seconds 20
if (-not (Test-Path `$pm2)) { Log 'pm2 missing'; exit 1 }
& `$pm2 resurrect *>> `$log
if (`$LASTEXITCODE -ne 0) {
  Log 'resurrect failed - start ecosystem'
  & `$pm2 start '$ProjectDir\ecosystem.config.cjs' *>> `$log
  & `$pm2 save *>> `$log
} else {
  Log 'resurrect ok'
}
Log 'boot done'
"@ | Set-Content -Path $runner -Encoding utf8

$startupDir = [Environment]::GetFolderPath('Startup')
$cmdPath = Join-Path $startupDir 'WhatsApp-Local-Stack.cmd'
@"
@echo off
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$runner"
"@ | Set-Content -Path $cmdPath -Encoding ascii

& $pm2 save | Out-Null

Write-Host "Autostart OK (no admin):"
Write-Host "  $cmdPath"
Write-Host "Runs at user logon via Startup folder."
