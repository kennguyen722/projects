. "$PSScriptRoot\env.ps1"
$ErrorActionPreference = 'Stop'

# Obtain token
$body = 'grant_type=password&username=demo&password=demo'
$token = Invoke-RestMethod -Method Post -Uri 'http://localhost:8081/oauth/token' -Body $body -ContentType 'application/x-www-form-urlencoded'
Write-Host "Access token length: $($token.access_token.Length)" -ForegroundColor Cyan

# SCIM list users
$users = Invoke-RestMethod -Uri 'http://localhost:8082/scim/v2/Users' -Headers @{ Authorization = "Bearer $($token.access_token)" }
$users | ConvertTo-Json -Depth 5
