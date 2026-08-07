param(
    [string]$ProjectDir = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$taskName = 'WhatsApp SAC Worker'
$serviceDir = 'C:\ProgramData\WhatsAppSacWorker'
$browserDir = Join-Path $serviceDir 'ms-playwright'
$envFile = Join-Path $serviceDir 'worker.env'
$runnerFile = Join-Path $serviceDir 'run-worker.ps1'
$logFile = Join-Path $serviceDir 'worker.log'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ejecutá este instalador como Administrador.'
}

function Read-DotEnvValue([string]$Path, [string]$Name) {
    if (-not (Test-Path $Path)) { return $null }
    $line = Get-Content $Path | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } | Select-Object -Last 1
    if (-not $line) { return $null }
    return (($line -split '=', 2)[1]).Trim().Trim('"').Trim("'")
}

$localEnv = Join-Path $ProjectDir '.env'
$tokenFile = Join-Path $ProjectDir '.cursor\.sac_token_tmp'
$sacUser = Read-DotEnvValue $localEnv 'SAC_USER'
$sacPassword = Read-DotEnvValue $localEnv 'SAC_PASSWORD'
$backendUrl = Read-DotEnvValue $localEnv 'SAC_BACKEND_URL'
if (-not $backendUrl) { $backendUrl = 'https://whatsapp-pdf-bot-backend.onrender.com' }
$token = if (Test-Path $tokenFile) { (Get-Content $tokenFile -Raw).Trim() } else { $null }

if (-not $sacUser -or -not $sacPassword -or -not $token) {
    throw 'Faltan SAC_USER, SAC_PASSWORD o .cursor/.sac_token_tmp.'
}

New-Item -ItemType Directory -Force -Path $serviceDir, $browserDir | Out-Null

@(
    "SAC_BACKEND_URL=$backendUrl"
    "SAC_AUTOMATION_TOKEN=$token"
    "SAC_USER=$sacUser"
    "SAC_PASSWORD=$sacPassword"
    'SAC_HEADLESS=true'
) | Set-Content -Path $envFile -Encoding ascii

$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$npxPath = (Get-Command npx.cmd -ErrorAction Stop).Source
$workerPath = Join-Path $ProjectDir 'workers\sacWorker.js'

$runner = @"
`$ErrorActionPreference = 'Continue'
`$env:SAC_WORKER_ENV_FILE = '$envFile'
`$env:PLAYWRIGHT_BROWSERS_PATH = '$browserDir'
Set-Location '$ProjectDir'
"[`$(Get-Date -Format o)] Iniciando SAC Worker" | Out-File -FilePath '$logFile' -Encoding utf8
& '$nodePath' '$workerPath' *>> '$logFile'
exit `$LASTEXITCODE
"@
$runner | Set-Content -Path $runnerFile -Encoding utf8

# Chromium compartido: no depende del perfil del coordinador.
$env:PLAYWRIGHT_BROWSERS_PATH = $browserDir
& $npxPath playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar Chromium compartido.' }

# Solo SYSTEM y administradores pueden leer credenciales y logs.
& icacls.exe $serviceDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron proteger los archivos del worker.' }

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runnerFile`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principalTask = New-ScheduledTaskPrincipal `
    -UserId 'SYSTEM' `
    -LogonType ServiceAccount `
    -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principalTask `
    -Settings $settings `
    -Description 'Procesa reclamos SAC desde Supabase/Render sin depender de una sesión de usuario.' `
    -Force | Out-Null

# Un servidor no puede procesar durante S3. La pantalla puede apagarse igualmente.
& powercfg.exe /change standby-timeout-ac 0
& powercfg.exe /change hibernate-timeout-ac 0

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 5
$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName

Write-Output "Tarea: $($task.TaskName)"
Write-Output "Estado: $($task.State)"
Write-Output "Último resultado: $($info.LastTaskResult)"
Write-Output "Log: $logFile"
