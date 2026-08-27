#Requires -Version 5.1
<#
.SYNOPSIS
  Always-on para el stack Docker:
  - Auto-login de ESTE usuario tras reinicio
  - Arranque visible (Docker + compose) y lock inmediato
  - Sin suspension/hibernacion con AC (escritorio enchufado)

.NOTES
  Ejecutar UNA vez como Administrador, logueado en el usuario Docker:
    npm run docker:always-on

  La clave de auto-login se guarda en el registro Winlogon (limitacion de Windows).
  Cualquiera con acceso admin a la maquina puede leerla. Usa un usuario dedicado.

  Opcional no interactivo:
    .\install-docker-always-on.ps1 -Password '***'
#>
param(
  [string]$ProjectDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$Password = '',
  [switch]$SkipAutoLogin,
  [switch]$SkipPower,
  [switch]$SkipLockAfterBoot,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'WhatsApp-Docker-AlwaysOn'
$bootDir = Join-Path $env:LOCALAPPDATA 'WhatsAppLocalStack'
$bootScriptDest = Join-Path $bootDir 'boot-always-on.ps1'
$configPath = Join-Path $bootDir 'always-on-config.json'
$bootSrc = Join-Path $PSScriptRoot 'boot-docker-always-on.ps1'

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Info([string]$m) { Write-Host "  $m" -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host "  OK  $m" -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host "  !!  $m" -ForegroundColor Yellow }

if (-not (Test-IsAdmin)) {
  Write-Host ''
  Write-Host 'Este script necesita Administrador (auto-login + energia).' -ForegroundColor Yellow
  Write-Host 'Relanzando con UAC...' -ForegroundColor Yellow
  $argList = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', "`"$PSCommandPath`"",
    '-ProjectDir', "`"$ProjectDir`""
  )
  if ($Password) { $argList += @('-Password', "`"$Password`"") }
  if ($SkipAutoLogin) { $argList += '-SkipAutoLogin' }
  if ($SkipPower) { $argList += '-SkipPower' }
  if ($SkipLockAfterBoot) { $argList += '-SkipLockAfterBoot' }
  if ($Uninstall) { $argList += '-Uninstall' }
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -Wait
  exit $LASTEXITCODE
}

New-Item -ItemType Directory -Force -Path $bootDir | Out-Null

# ---------- Uninstall ----------
if ($Uninstall) {
  Write-Host ''
  Write-Host 'Desinstalando always-on...' -ForegroundColor Yellow
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  $startup = [Environment]::GetFolderPath('Startup')
  foreach ($n in @('WhatsApp-Docker-Stack.vbs', 'WhatsApp-Docker-AlwaysOn.vbs', 'WhatsApp-Local-Stack.vbs', 'WhatsApp-Local-Stack.cmd')) {
    $p = Join-Path $startup $n
    if (Test-Path $p) { Remove-Item $p -Force }
  }
  $winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
  Set-ItemProperty -Path $winlogon -Name 'AutoAdminLogon' -Value '0' -Type String -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $winlogon -Name 'DefaultPassword' -ErrorAction SilentlyContinue
  Write-Ok 'tarea y auto-login desactivados'
  Write-Warn 'La energia (no sleep) NO se revirtio - ajustala a mano si queres'
  exit 0
}

Write-Host ''
Write-Host '========================================================' -ForegroundColor DarkGray
Write-Host ' WhatsApp Docker - always-on (auto-login + lock + energia)' -ForegroundColor White
Write-Host '========================================================' -ForegroundColor DarkGray
Write-Host ''
Write-Info "Usuario: $env:USERDOMAIN\$env:USERNAME"
Write-Info "Proyecto: $ProjectDir"
Write-Host ''

if (-not (Test-Path $bootSrc)) {
  throw "No encuentro boot script: $bootSrc"
}
Copy-Item -Path $bootSrc -Destination $bootScriptDest -Force
Write-Ok "boot script -> $bootScriptDest"

@{
  ProjectDir  = $ProjectDir
  SkipLock    = [bool]$SkipLockAfterBoot
  InstalledAt = (Get-Date -Format o)
  User        = "$env:USERDOMAIN\$env:USERNAME"
} | ConvertTo-Json | Set-Content -Path $configPath -Encoding utf8
Write-Ok "config -> $configPath"

# ---------- Power: PC enchufada nunca duerme ----------
if (-not $SkipPower) {
  Write-Host ''
  Write-Host '[energia] Escritorio enchufado = siempre encendida' -ForegroundColor Cyan
  try {
    powercfg /hibernate off 2>$null | Out-Null
    powercfg /change standby-timeout-ac 0
    powercfg /change hibernate-timeout-ac 0
    powercfg /change monitor-timeout-ac 15
    powercfg /change disk-timeout-ac 0
    powercfg /change standby-timeout-dc 0
    powercfg /change hibernate-timeout-dc 0

    $scheme = (powercfg /getactivescheme) -replace '.*([0-9a-fA-F-]{36}).*', '$1'
    powercfg /SETACVALUEINDEX $scheme SUB_SLEEP STANDBYIDLE 0
    powercfg /SETACVALUEINDEX $scheme SUB_SLEEP HYBRIDSLEEP 0
    powercfg /SETACVALUEINDEX $scheme SUB_SLEEP HIBERNATEIDLE 0
    powercfg /SETDCVALUEINDEX $scheme SUB_SLEEP STANDBYIDLE 0
    powercfg /SETDCVALUEINDEX $scheme SUB_SLEEP HYBRIDSLEEP 0
    powercfg /SETDCVALUEINDEX $scheme SUB_SLEEP HIBERNATEIDLE 0
    powercfg /SETACVALUEINDEX $scheme SUB_PCIEXPRESS ASPM 0
    powercfg /setactive $scheme

    $path = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power'
    if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
    Set-ItemProperty -Path $path -Name 'HiberbootEnabled' -Value 0 -Type DWord

    Write-Ok 'sin sleep/hibernacion con energia; monitor puede apagarse a los 15 min'
    Write-Ok 'Fast Startup desactivado'
  } catch {
    Write-Warn "powercfg parcial: $_"
  }
} else {
  Write-Warn 'SkipPower: no toque energia'
}

# ---------- Auto-login ----------
if (-not $SkipAutoLogin) {
  Write-Host ''
  Write-Host '[auto-login] Tras reinicio entra solo este usuario y luego se bloquea' -ForegroundColor Cyan
  Write-Warn 'La contrasena queda en el registro Winlogon (solo usa usuario dedicado).'
  Write-Host ''

  $plain = $Password
  if (-not $plain) {
    $secure = Read-Host "Clave de Windows para '$env:USERNAME' (no se muestra)" -AsSecureString
    if (-not $secure -or $secure.Length -eq 0) {
      throw 'Clave vacia - abortado. Reejecuta o usa -SkipAutoLogin'
    }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }

  $winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
  Set-ItemProperty -Path $winlogon -Name 'AutoAdminLogon' -Value '1' -Type String
  Set-ItemProperty -Path $winlogon -Name 'DefaultUserName' -Value $env:USERNAME -Type String
  Set-ItemProperty -Path $winlogon -Name 'DefaultPassword' -Value $plain -Type String
  $domain = $env:USERDOMAIN
  if ($domain -and $domain -ne $env:COMPUTERNAME) {
    Set-ItemProperty -Path $winlogon -Name 'DefaultDomainName' -Value $domain -Type String
  } else {
    Set-ItemProperty -Path $winlogon -Name 'DefaultDomainName' -Value $env:COMPUTERNAME -Type String
  }
  # NO ForceAutoLogon: permite Cambiar de usuario / cerrar sesion sin reentrar a la fuerza.
  Remove-ItemProperty -Path $winlogon -Name 'ForceAutoLogon' -ErrorAction SilentlyContinue

  $plain = $null
  $Password = $null
  [GC]::Collect()
  Write-Ok 'AutoAdminLogon activado para este usuario'
} else {
  Write-Warn 'SkipAutoLogin: asegurate de loguearte vos tras cada reinicio'
}

# ---------- Docker Desktop: start on login ----------
$settingsPath = Join-Path $env:APPDATA 'Docker\settings-store.json'
if (Test-Path $settingsPath) {
  try {
    $json = Get-Content $settingsPath -Raw -Encoding utf8 | ConvertFrom-Json
    $json | Add-Member -NotePropertyName AutoStart -NotePropertyValue $true -Force
    $json | ConvertTo-Json -Depth 20 | Set-Content $settingsPath -Encoding utf8
    Write-Ok 'Docker Desktop AutoStart = true'
  } catch {
    Write-Warn "No pude editar settings-store.json: $_"
  }
}

# ---------- Scheduled task at logon ----------
Write-Host ''
Write-Host '[tarea] Logon -> ventana de arranque -> Docker -> lock' -ForegroundColor Cyan

$startup = [Environment]::GetFolderPath('Startup')
foreach ($n in @('WhatsApp-Docker-Stack.vbs', 'WhatsApp-Local-Stack.vbs', 'WhatsApp-Local-Stack.cmd', 'WhatsApp-Docker-AlwaysOn.vbs')) {
  $p = Join-Path $startup $n
  if (Test-Path $p) { Remove-Item $p -Force }
}

$vbs = Join-Path $bootDir 'boot-always-on.vbs'
@"
Set sh = CreateObject("WScript.Shell")
WScript.Sleep 5000
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Normal -File ""$bootScriptDest""", 1, False
"@ | Set-Content -Path $vbs -Encoding ascii
Copy-Item $vbs (Join-Path $startup 'WhatsApp-Docker-AlwaysOn.vbs') -Force
Write-Ok 'Startup VBS instalado (arranque al login)'

try {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  $psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Normal -File `"$bootScriptDest`""
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs -WorkingDirectory $ProjectDir
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'WhatsApp Docker always-on: compose + lock tras login (auto o manual)' `
    -Force | Out-Null
  Write-Ok "Tarea programada extra: $TaskName"
} catch {
  Write-Warn "Tarea programada no se pudo crear (OK: usamos Startup VBS). $_"
}

Write-Host ''
Write-Host '========================================================' -ForegroundColor Green
Write-Host ' Listo. Proximo reinicio:' -ForegroundColor Green
Write-Host '   1) Windows entra solo a este usuario' -ForegroundColor White
Write-Host '   2) Ventana: Abriendo Docker / contenedores...' -ForegroundColor White
Write-Host '   3) Lock automatico - PC cerrada pero Docker sigue' -ForegroundColor White
Write-Host '   4) Para usar el escritorio: desbloquea con tu clave' -ForegroundColor White
Write-Host '========================================================' -ForegroundColor Green
Write-Host ''
Write-Host 'Probar boot sin reiniciar (sin lock):' -ForegroundColor DarkGray
Write-Host "  powershell -NoProfile -File `"$bootScriptDest`" -SkipLock" -ForegroundColor DarkGray
Write-Host ''
Write-Host 'Desinstalar:' -ForegroundColor DarkGray
Write-Host '  .\scripts\local-stack\install-docker-always-on.ps1 -Uninstall' -ForegroundColor DarkGray
Write-Host ''
Write-Warn 'BIOS: Restore AC Power Loss = Power On si queres que vuelva sola tras corte de luz.'
Write-Host ''
