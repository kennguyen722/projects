. "$PSScriptRoot\env.ps1"
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent

# Stop anything stale, then build
& (Join-Path $PSScriptRoot 'local-down.ps1') | Out-Null
& (Join-Path $PSScriptRoot 'local-build.ps1') | Out-Null

# Start user-service (gRPC 8083)
Start-Process -FilePath $Global:Java -ArgumentList @('-jar',(Join-Path $root 'user-service\target\user-service-0.1.0.jar')) `
  -RedirectStandardOutput (Join-Path $root 'user-service\user-service.out.log') `
  -RedirectStandardError (Join-Path $root 'user-service\user-service.err.log') -WindowStyle Hidden

# Start auth-service (HTTP 8081)
Start-Process -FilePath $Global:Java -ArgumentList @('-jar',(Join-Path $root 'auth-service\target\auth-service-0.1.0.jar'),'--server.port=8081') `
  -RedirectStandardOutput (Join-Path $root 'auth-service\auth-service.out.log') `
  -RedirectStandardError (Join-Path $root 'auth-service\auth-service.err.log') -WindowStyle Hidden

# Start scim-service (HTTP 8082)
$scim = (Join-Path $root 'scim-service')
Push-Location $scim
try {
  $Env:GRPC_USER_HOST = 'localhost'
  $Env:GRPC_USER_PORT = '8083'
  $Env:JWKS_URL = 'http://localhost:8081/oauth/jwks'
  $Env:DISABLE_SIGNATURE_VERIFY = 'true'
  Start-Process -FilePath node -ArgumentList 'src/index.js' `
    -RedirectStandardOutput (Join-Path $scim 'scim-service.out.log') `
    -RedirectStandardError (Join-Path $scim 'scim-service.err.log') -WindowStyle Hidden
} finally { Pop-Location }

# Simple port probes
Start-Sleep -Seconds 1
Write-Host 'Ports:' -ForegroundColor Cyan
('8081','8082','8083') | ForEach-Object {
  $ok = (Test-NetConnection -ComputerName localhost -Port $_ -WarningAction SilentlyContinue).TcpTestSucceeded
  if ($ok) { Write-Host ("  $_ => UP") } else { Write-Host ("  $_ => DOWN") }
}

Write-Host 'Local services started.' -ForegroundColor Green
