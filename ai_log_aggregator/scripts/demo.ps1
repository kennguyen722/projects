Param(
  [int]$Count = 200,
  [string]$IngestUrl = "http://localhost:3001/ingest",
  [int]$MaxSkewSeconds = 600,
  [switch]$BringUpStack
)
$ErrorActionPreference = "Stop"

function Write-Info($msg){ Write-Host "[demo] $msg" -ForegroundColor Cyan }
function Write-Warn($msg){ Write-Host "[demo] $msg" -ForegroundColor Yellow }
function Write-Err($msg){ Write-Host "[demo] $msg" -ForegroundColor Red }

# Optionally bring up full stack via Compose
if ($BringUpStack) {
  try {
    $composeDir = Join-Path $PSScriptRoot "..\infra"
    if (-not (Test-Path $composeDir)) { throw "Compose directory not found: $composeDir" }
    Write-Info "Bringing up full stack with Docker Compose..."
    Push-Location $composeDir
    docker compose up -d | Out-Null
    Pop-Location
  } catch {
    Write-Warn "Failed to bring up stack automatically: $_"
  }
}

# Wait for ingestion to be reachable
$deadline = (Get-Date).AddSeconds(60)
$reachable = $false
while ((Get-Date) -lt $deadline -and -not $reachable) {
  try {
    # We expect POST, but do a lightweight GET to check network reachability
    Invoke-WebRequest -Method Get -Uri $IngestUrl -TimeoutSec 2 | Out-Null
    $reachable = $true
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
if (-not $reachable) { Write-Warn "Ingestion may not be reachable yet; proceeding with POST attempts..." }

# If a sample dataset exists, use it; else generate synthetic
$samplePath = Join-Path $PSScriptRoot "sample-events.jsonl"
$useSample = Test-Path $samplePath
if ($useSample) {
  Write-Info "Seeding from sample dataset: $samplePath"
} else {
  Write-Info "No sample dataset found; generating $Count synthetic events"
}

# Distributions
$levels = @("debug","info","warn","error")
$sources = @("frontend","api","payments","search","auth")
$messages = @(
  "User signed in","User signed out","Created order","Processed payment","Search query slow",
  "Cache miss","Cache hit","DB timeout","DB connection reset","Rate limit exceeded",
  "Feature flag toggled","Background job started","Background job completed","Webhook delivered","Webhook retry"
)

$sent = 0

function New-Event() {
  $now = Get-Date
  $skew = Get-Random -Minimum 0 -Maximum $MaxSkewSeconds
  $ts = $now.AddSeconds(-$skew).ToString("o")
  # Weighted level: info>warn>error>debug
  $roll = Get-Random -Minimum 0 -Maximum 100
  $lvl = if ($roll -lt 5) { "error" } elseif ($roll -lt 20) { "warn" } elseif ($roll -lt 80) { "info" } else { "debug" }
  $src = $sources | Get-Random
  $msg = $messages | Get-Random
  $ctx = @{ requestId = [guid]::NewGuid().ToString(); region = ("us-east","us-west","eu-central" | Get-Random) }
  return @{ source=$src; level=$lvl; message=$msg; timestamp=$ts; context=$ctx } | ConvertTo-Json -Depth 5
}

try {
  if ($useSample) {
    Get-Content -Path $samplePath | ForEach-Object {
      $json = $_
      Invoke-RestMethod -Method Post -Uri $IngestUrl -ContentType 'application/json' -Body $json | Out-Null
      $sent++
      if ($sent % 20 -eq 0) { Write-Info "Seeded $sent events..." }
    }
  } else {
    1..$Count | ForEach-Object {
      $payload = New-Event
      Invoke-RestMethod -Method Post -Uri $IngestUrl -ContentType 'application/json' -Body $payload | Out-Null
      $sent++
      if ($sent % 20 -eq 0) { Write-Info "Seeded $sent events..." }
    }
  }
  Write-Info "Done. Seeded $sent events. Opening dashboard..."
  Start-Process "http://localhost:5173" | Out-Null
} catch {
  Write-Err "Seeding failed: $_"
  exit 1
}
