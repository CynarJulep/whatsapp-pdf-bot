#Requires -Version 5.1
<#
.SYNOPSIS
  Arranque visible post-login: Docker Desktop + compose + lock de sesión.
  Instalado por install-docker-always-on.ps1 en %LOCALAPPDATA%\WhatsAppLocalStack.
#>
param(
  [string]$ProjectDir = '',
  [switch]$SkipLock
)

$ErrorActionPreference = 'Continue'
$Host.UI.RawUI.WindowTitle = 'WhatsApp Docker - arranque'

$bootDir = Join-Path $env:LOCALAPPDATA 'WhatsAppLocalStack'
$log = Join-Path $bootDir 'boot-always-on.log'
$configPath = Join-Path $bootDir 'always-on-config.json'

# Evitar dos ventanas si tarea + algo mas disparan juntos
try {
  $created = $false
  $mutex = New-Object System.Threading.Mutex($true, 'Global\WhatsAppDockerAlwaysOnBoot', [ref]$created)
  if (-not $created) {
    Add-Content -Path $log -Value "[$(Get-Date -Format o)] another boot instance running; exit" -Encoding utf8 -ErrorAction SilentlyContinue
    exit 0
  }
} catch {}

function Log([string]$m) {
  $line = "[{0}] {1}" -f (Get-Date -Format o), $m
  Add-Content -Path $log -Value $line -Encoding utf8 -ErrorAction SilentlyContinue
}

function Write-Step([string]$msg, [string]$color = 'Cyan') {
  Write-Host ''
  Write-Host "  $msg" -ForegroundColor $color
  Log $msg
}

function Write-Ok([string]$msg) {
  Write-Host "    OK  $msg" -ForegroundColor Green
  Log "OK $msg"
}

function Write-Warn([string]$msg) {
  Write-Host "    !!  $msg" -ForegroundColor Yellow
  Log "WARN $msg"
}

function Write-Fail([string]$msg) {
  Write-Host "    XX  $msg" -ForegroundColor Red
  Log "FAIL $msg"
}

try {
  if (-not (Test-Path $bootDir)) {
    New-Item -ItemType Directory -Force -Path $bootDir | Out-Null
  }

  if (-not $ProjectDir -and (Test-Path $configPath)) {
    $cfg = Get-Content $configPath -Raw -Encoding utf8 | ConvertFrom-Json
    if ($cfg.ProjectDir) { $ProjectDir = [string]$cfg.ProjectDir }
    if ($cfg.SkipLock -eq $true) { $SkipLock = $true }
  }
  if (-not $ProjectDir) {
    $ProjectDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  }

  Clear-Host
  Write-Host ''
  Write-Host '  ========================================================' -ForegroundColor DarkGray
  Write-Host '   WhatsApp Docker - arranque automatico' -ForegroundColor White
  Write-Host '   No cierres esta ventana. Se bloquea sola al terminar.' -ForegroundColor DarkGray
  Write-Host '  ========================================================' -ForegroundColor DarkGray
  Write-Host ''
  Log "boot start project=$ProjectDir skipLock=$SkipLock"

  # --- 1/5 sistema ---
  Write-Step '[1/5] Esperando que el sistema asiente...'
  Start-Sleep -Seconds 12
  Write-Ok 'listo'

  # --- 2/5 Docker Desktop ---
  Write-Step '[2/5] Abriendo Docker Desktop...'
  $dockerExe = Join-Path ${env:ProgramFiles} 'Docker\Docker\Docker Desktop.exe'
  $ddRunning = Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue
  if (-not $ddRunning) {
    if (Test-Path $dockerExe) {
      Start-Process -FilePath $dockerExe | Out-Null
      Write-Ok 'Docker Desktop iniciado'
    } else {
      Write-Fail "No esta instalado: $dockerExe"
    }
  } else {
    Write-Ok 'Docker Desktop ya estaba corriendo'
  }

  # --- 3/5 motor ---
  Write-Step '[3/5] Esperando motor Docker (hasta ~5 min)...'
  $engineOk = $false
  for ($i = 0; $i -lt 60; $i++) {
    docker info 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
      $engineOk = $true
      break
    }
    Write-Host ("    ... intento {0}/60" -f ($i + 1)) -ForegroundColor DarkGray
    Start-Sleep -Seconds 5
  }
  if ($engineOk) {
    Write-Ok 'motor listo'
  } else {
    Write-Fail 'motor no respondio a tiempo - se intenta compose igual'
  }

  # --- 4/5 compose ---
  Write-Step '[4/5] Levantando contenedores (pai, licencias, dashboard, tunnels)...'
  if (-not (Test-Path $ProjectDir)) {
    Write-Fail "Proyecto no encontrado: $ProjectDir"
  } else {
    Set-Location $ProjectDir
    $env:COMPOSE_PROFILES = 'tunnels'
    $composeOk = $false
    for ($r = 1; $r -le 3; $r++) {
      Write-Host ("    compose intento {0}/3..." -f $r) -ForegroundColor DarkGray
      & docker compose --profile tunnels up -d *>> $log 2>&1
      if ($LASTEXITCODE -eq 0) {
        $composeOk = $true
        break
      }
      Start-Sleep -Seconds 8
    }
    if ($composeOk) {
      Write-Ok 'stack arriba'
      try {
        & docker compose --profile tunnels ps --format 'table {{.Name}}\t{{.Status}}' 2>$null |
          ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
      } catch {}
    } else {
      Write-Fail "compose fallo (ver log: $log)"
    }
  }

  # --- 5/5 lock ---
  Write-Step '[5/5] Bloqueando sesion...' 'Magenta'
  if ($SkipLock) {
    Write-Warn 'SkipLock activo - no se bloquea'
    Start-Sleep -Seconds 4
  } else {
    Write-Host '    La PC queda con Docker corriendo.' -ForegroundColor DarkGray
    Write-Host '    Para usarla: desbloquea con tu clave (Win+L / pantalla de bloqueo).' -ForegroundColor DarkGray
    Write-Host '    En 3 segundos...' -ForegroundColor Yellow
    Start-Sleep -Seconds 3
    Log 'locking workstation'
    try {
      rundll32.exe user32.dll,LockWorkStation
      Write-Ok 'sesion bloqueada'
    } catch {
      Write-Fail "no se pudo bloquear: $_"
      Start-Sleep -Seconds 8
    }
  }

  Log 'boot done'
  Start-Sleep -Seconds 2
} catch {
  Log "FATAL $_"
  Write-Host ''
  Write-Host "  ERROR FATAL: $_" -ForegroundColor Red
  Write-Host "  Log: $log" -ForegroundColor DarkGray
  Start-Sleep -Seconds 20
  if (-not $SkipLock) {
    rundll32.exe user32.dll,LockWorkStation
  }
}
