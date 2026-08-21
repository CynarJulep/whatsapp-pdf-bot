#Requires -Version 5.1
param(
  [string]$ProjectDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$RenderApiKey = $env:RENDER_API_KEY
)

$ErrorActionPreference = 'Stop'
Set-Location $ProjectDir

Write-Host "==> Proyecto: $ProjectDir"

Write-Host '==> npm install'
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

Write-Host '==> pm2 (local)'
npm install pm2 --save-dev
if ($LASTEXITCODE -ne 0) { throw 'pm2 install failed' }

Write-Host '==> Playwright Chromium'
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { Write-Warning 'Playwright chromium failed; SAC may not work until installed.' }

$binDir = Join-Path $ProjectDir 'local-stack\bin'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$cf = Join-Path $binDir 'cloudflared.exe'
if (-not (Test-Path $cf)) {
  Write-Host '==> Downloading cloudflared (free)'
  $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  Invoke-WebRequest -Uri $url -OutFile $cf -UseBasicParsing
}
& $cf --version

$envFile = Join-Path $ProjectDir '.env'
$example = Join-Path $ProjectDir '.env.example'
if (-not (Test-Path $envFile)) {
  if ($RenderApiKey) {
    Write-Host '==> Importing env from Render'
    $headers = @{ Authorization = "Bearer $RenderApiKey"; Accept = 'application/json' }
    $svcId = 'srv-d8cs73eq1p3s73ak3fp0'
    $vars = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$svcId/env-vars" -Headers $headers
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($item in $vars) {
      $k = $item.envVar.key
      $v = $item.envVar.value
      if ($null -eq $v) { continue }
      if ($k -in @('PORT', 'RENDER', 'RENDER_EXTERNAL_URL', 'RENDER_SERVICE_ID')) { continue }
      $escaped = [string]$v
      $lines.Add("$k=$escaped") | Out-Null
    }
    if ($lines.Count -eq 0) { throw 'Render returned no env vars (check API key)' }
    $lines.Add('SESSION_ID=pai') | Out-Null
    # Local stack runs on this PC: process SAC jobs in-process (not external worker).
    $filtered = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
      if ($line -match '^SAC_PROCESS_JOBS=') { continue }
      $filtered.Add($line) | Out-Null
    }
    $filtered.Add('SAC_PROCESS_JOBS=true') | Out-Null
    Set-Content -Path $envFile -Value $filtered -Encoding utf8
    Write-Host ("Created .env from Render ({0} lines). Do not commit it." -f $filtered.Count)
  } elseif (Test-Path $example) {
    Copy-Item $example $envFile
    Write-Host 'Created .env from .env.example - fill SUPABASE_* and the rest.'
  } else {
    throw 'Missing .env and .env.example'
  }
} else {
  Write-Host '==> .env already exists (ok)'
}

New-Item -ItemType Directory -Force -Path (Join-Path $ProjectDir 'local-stack\state') | Out-Null

Write-Host ''
Write-Host 'Done. Next:'
Write-Host '  npm run local:start'
Write-Host '  npm run local:autostart'
Write-Host '  Open http://127.0.0.1:9100'
