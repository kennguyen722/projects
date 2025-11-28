. "$PSScriptRoot\env.ps1"
$ErrorActionPreference = 'SilentlyContinue'

# Stop Java services by jar name
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'auth-service-0.1.0.jar|user-service-0.1.0.jar' } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }

# Stop node (all) to ensure SCIM restarts with fresh env
Get-Process node -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.Id -Force } catch {} }

Start-Sleep -Milliseconds 300
Write-Host 'Services stopped.' -ForegroundColor Yellow
