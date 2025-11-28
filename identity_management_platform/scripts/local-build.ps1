. "$PSScriptRoot\env.ps1"
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent

& $Global:Mvn -q -f (Join-Path $root 'user-service\pom.xml') clean package -DskipTests
& $Global:Mvn -q -f (Join-Path $root 'auth-service\pom.xml') clean package -DskipTests

Push-Location (Join-Path $root 'scim-service')
try {
  if (-not (Test-Path 'node_modules')) { npm install } else { Write-Host 'scim-service deps already installed' }
} finally {
  Pop-Location
}

Write-Host 'Build completed.' -ForegroundColor Green
