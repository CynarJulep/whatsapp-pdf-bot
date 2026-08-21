#Requires -Version 5.1
<#
.SYNOPSIS
  Autoarranque invisible (sin ventanas de terminal) al iniciar sesion.
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
$vbs = Join-Path $bootDir 'boot-silent.vbs'

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

# VBS window style 0 = sin ventana alguna (ni flash de CMD/PowerShell)
@"
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$runner""", 0, False
"@ | Set-Content -Path $vbs -Encoding ascii

$startupDir = [Environment]::GetFolderPath('Startup')
# Quitar launcher viejo con CMD visible
$oldCmd = Join-Path $startupDir 'WhatsApp-Local-Stack.cmd'
if (Test-Path $oldCmd) { Remove-Item $oldCmd -Force }

$startupVbs = Join-Path $startupDir 'WhatsApp-Local-Stack.vbs'
Copy-Item $vbs $startupVbs -Force

& $pm2 save | Out-Null

Write-Host "Autostart silencioso OK:"
Write-Host "  $startupVbs"
Write-Host "Sin ventanas de terminal al loguear."
