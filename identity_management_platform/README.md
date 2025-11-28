# Identity Management Platform

Cloud-native identity platform implementing OAuth2, RS256-signed JWT + refresh tokens (Redis), SCIM 2.0 provisioning, gRPC microservices behind Envoy, and Redis caching.

For a detailed, code-level walkthrough of each service, see:
- docs/SERVICE_DEEP_DIVE.md

## Architecture
Services:
- Gateway (Envoy): Unified entrypoint, routes REST (SCIM) & gRPC, JWT auth.
- Auth Service (Java Spring Boot): OAuth2 Authorization/Token endpoint, issues signed JWT access + refresh tokens (refresh stored in Redis).
- User Service (Java Spring Boot + gRPC): Manages user entities, exposes gRPC API consumed by SCIM service.
- SCIM Service (Node.js Express): Implements SCIM 2.0 REST endpoints translating to user-service gRPC calls.
- Redis: Stores refresh tokens, session metadata, user cache.

Communication:
- External clients -> Envoy -> (SCIM HTTP /token) -> auth-service or scim-service.
- scim-service -> user-service via gRPC.
- JWT verification at gateway + downstream resource services.

## Tech Stack
- Java 17, Spring Boot 3, Spring Security & Authorization Server
- Node.js 20 (Express)
- gRPC (Java & Node clients)
- Envoy Proxy
- Redis 7
- Docker / Compose

## Token Flow
1. Client authenticates at `/oauth/token` with client credentials or password grant (demo) to get access + refresh.
2. Access token short-lived (e.g., 5m); refresh token stored in Redis with user and scope metadata.
3. Refresh flow `/oauth/refresh` exchanges valid refresh for new pair.
4. SCIM endpoints require `scim.read` / `scim.write` scopes; gateway enforces via JWT claims.

## SCIM Support (Subset)
Implemented endpoints:
- `GET /scim/v2/Users` (list, pagination)
- `POST /scim/v2/Users` (create)
- `GET /scim/v2/Users/{id}` (retrieve)
- `PUT /scim/v2/Users/{id}` (replace)
- `PATCH /scim/v2/Users/{id}` (partial update subset operations)
- `DELETE /scim/v2/Users/{id}` (delete)

## Directories
```
identity_management_platform/
  auth-service/
  user-service/
  scim-service/
  gateway/
  docker-compose.yml
  envoy.yaml
  proto/
```

## Configuration
Environment variables (Docker compose sets defaults):
- `REDIS_HOST` (auth-service): Redis hostname (default `redis`)
- `GRPC_USER_HOST` (scim-service): gRPC user-service host (default `user-service`)
- `GRPC_USER_PORT` (scim-service): gRPC port (default `8083`)
- `JWKS_URL` (optional, scim-service): Override JWK endpoint (default `http://auth-service:8081/oauth/jwks`)

Auth-service generates an ephemeral RSA key pair each startup; public key exposed via `/oauth/jwks` (kid `primary`). Restarting auth-service invalidates existing access tokens (key rotation).

## Quick Start
### Prerequisites
- Docker & Docker Compose (for container run)
- Java 17 SDK, Maven 3.9+, Node.js 18+
- PowerShell (Windows)

### Local scripts (no Docker)
From `identity_management_platform/scripts`:
```powershell
./local-up.ps1     # stop, build, start all services locally
./local-test.ps1   # obtain a token and call SCIM /Users
# when done
./local-down.ps1   # stop all local services
```

### Manual build (optional)
```powershell
cd identity_management_platform
mvn -q -f auth-service/pom.xml package -DskipTests
mvn -q -f user-service/pom.xml package -DskipTests
npm install --prefix scim-service
```

### Run via Docker Compose
```powershell
docker compose up --build
```
Services exposed:
- Envoy Gateway: http://localhost:8080
- Auth Service (direct dev): http://localhost:8081
- SCIM Service (direct dev): http://localhost:8082

### Quick PowerShell (Windows) — Token + List
```powershell
# Get access token via gateway
$body = @{ grant_type='password'; username='demo'; password='demo' }
$token = (Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/oauth/token' -ContentType 'application/x-www-form-urlencoded' -Body $body).access_token

# List users via gateway
Invoke-RestMethod -Method Get -Uri 'http://localhost:8080/scim/v2/Users' -Headers @{ Authorization = "Bearer $token" } | ConvertTo-Json -Depth 3
```

### Obtain Token (Password Grant Demo)

Windows PowerShell:
```powershell
# Use curl.exe to avoid PowerShell's curl alias (Invoke-WebRequest)
curl.exe -X POST "http://localhost:8080/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u demo-client:demo-secret \
  -d "grant_type=password&username=demo&password=demo"
```

Linux/macOS (bash/zsh):
```bash
curl -X POST "http://localhost:8080/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u demo-client:demo-secret \
  -d "grant_type=password&username=demo&password=demo"
```

Direct-to-service (dev) alternative if gateway is not running:
```powershell
curl.exe -X POST "http://localhost:8081/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u demo-client:demo-secret \
  -d "grant_type=password&username=demo&password=demo"
```
Response includes `access_token` (RS256 signed) and `refresh_token` stored in Redis. Access token lifetime: 5 minutes; refresh: 1 hour (rotated on use).

### SCIM Create User (Requires scopes `scim.read scim.write`)
```powershell
$TOKEN="<access_token>"
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"userName":"alice","name":{"givenName":"Alice","familyName":"Doe"},"emails":[{"value":"alice@example.com"}]}' http://localhost:8080/scim/v2/Users
```

Windows PowerShell (end-to-end with write scope):
```powershell
# Request a token that includes scim.write (required for POST/PUT/PATCH/DELETE)
$token = (Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/oauth/token' -ContentType 'application/x-www-form-urlencoded' -Body 'grant_type=password&username=demo&password=demo&scope=scim.read scim.write').access_token

# Create a user
$body = '{"userName":"alice","name":{"givenName":"Alice","familyName":"Doe"}}'
Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/scim/v2/Users' -Headers @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' } -Body $body | ConvertTo-Json -Depth 4
```

### SCIM via Gateway Examples

Windows PowerShell:
```powershell
# 1) Get token
$token = (Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/oauth/token' -ContentType 'application/x-www-form-urlencoded' -Body 'grant_type=password&username=demo&password=demo').access_token

# 2) List users
Invoke-RestMethod -Method Get -Uri 'http://localhost:8080/scim/v2/Users' -Headers @{ Authorization = "Bearer $token" } | ConvertTo-Json -Depth 4

# 3) Create user
$body = '{"userName":"alice","name":{"givenName":"Alice","familyName":"Doe"},"emails":[{"value":"alice@example.com"}]}'
Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/scim/v2/Users' -Headers @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' } -Body $body | ConvertTo-Json -Depth 4

# 4) Update user (replace)
$id = '<userIdFromCreate>'
$update = '{"userName":"alice","name":{"givenName":"Alice","familyName":"Nguyen"},"emails":[{"value":"alice@example.com"}],"active":true}'
Invoke-RestMethod -Method Put -Uri "http://localhost:8080/scim/v2/Users/$id" -Headers @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' } -Body $update | ConvertTo-Json -Depth 4

# 5) Delete user
Invoke-RestMethod -Method Delete -Uri "http://localhost:8080/scim/v2/Users/$id" -Headers @{ Authorization = "Bearer $token" } -SkipHttpErrorCheck
```

Linux/macOS (bash):
```bash
# 1) Get token
TOKEN=$(curl -s -X POST "http://localhost:8080/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&username=demo&password=demo" | jq -r .access_token)

# 2) List users
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/scim/v2/Users | jq

# 3) Create user
curl -s -X POST http://localhost:8080/scim/v2/Users \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"userName":"alice","name":{"givenName":"Alice","familyName":"Doe"},"emails":[{"value":"alice@example.com"}]}' | jq

# 4) Update user
ID=<userIdFromCreate>
curl -s -X PUT http://localhost:8080/scim/v2/Users/$ID \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"userName":"alice","name":{"givenName":"Alice","familyName":"Nguyen"},"emails":[{"value":"alice@example.com"}],"active":true}' | jq

# 5) Delete user
curl -s -X DELETE http://localhost:8080/scim/v2/Users/$ID -H "Authorization: Bearer $TOKEN" -i
```

### Unauthorized (401) Examples (Missing Token)

Windows PowerShell:
```powershell
# GET without Authorization header → 401
curl.exe -i "http://localhost:8080/scim/v2/Users"

# POST without Authorization header → 401
curl.exe -i -X POST "http://localhost:8080/scim/v2/Users" ^
  -H "Content-Type: application/json" ^
  -d '{"userName":"unauth","name":{"givenName":"No","familyName":"Auth"}}'
```

### Insufficient Scope (403) Examples (Missing `scim.write`)

Note: These examples assume the token endpoint honors the requested `scope` parameter.

Windows PowerShell:
```powershell
# Issue a token with only scim.read
$readOnlyToken = (Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/oauth/token' -ContentType 'application/x-www-form-urlencoded' -Body 'grant_type=password&username=demo&password=demo&scope=scim.read').access_token

# GET succeeds (has scim.read)
Invoke-RestMethod -Method Get -Uri 'http://localhost:8080/scim/v2/Users' -Headers @{ Authorization = "Bearer $readOnlyToken" } | ConvertTo-Json -Depth 3

# POST fails with 403 (missing scim.write)
try {
  Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/scim/v2/Users' -Headers @{ Authorization = "Bearer $readOnlyToken"; 'Content-Type' = 'application/json' } -Body '{"userName":"limited","name":{"givenName":"Read","familyName":"Only"}}'
} catch { Write-Host "Denied as expected:" $_.Exception.Response.StatusCode }
```

PowerShell one-liner (compact):
```powershell
$ro=(curl.exe -s -X POST "http://localhost:8080/oauth/token" -H "Content-Type: application/x-www-form-urlencoded" -d "grant_type=password&username=demo&password=demo&scope=scim.read" | ConvertFrom-Json).access_token; curl.exe -i -X POST "http://localhost:8080/scim/v2/Users" -H "Authorization: Bearer $ro" -H "Content-Type: application/json" -d '{"userName":"limited","name":{"givenName":"Read","familyName":"Only"}}'
```

bash one-liner (compact):
```bash
RO=$(curl -s -X POST "http://localhost:8080/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&username=demo&password=demo&scope=scim.read" | jq -r .access_token); \
curl -i -X POST "http://localhost:8080/scim/v2/Users" \
  -H "Authorization: Bearer $RO" -H "Content-Type: application/json" \
  -d '{"userName":"limited","name":{"givenName":"Read","familyName":"Only"}}'
```

Linux/macOS (bash):
```bash
# Issue a token with only scim.read
READ_ONLY_TOKEN=$(curl -s -X POST "http://localhost:8080/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&username=demo&password=demo&scope=scim.read" | jq -r .access_token)

# GET succeeds (has scim.read)
curl -i -H "Authorization: Bearer $READ_ONLY_TOKEN" "http://localhost:8080/scim/v2/Users"

# POST fails with 403 (missing scim.write)
curl -i -X POST "http://localhost:8080/scim/v2/Users" \
  -H "Authorization: Bearer $READ_ONLY_TOKEN" -H "Content-Type: application/json" \
  -d '{"userName":"limited","name":{"givenName":"Read","familyName":"Only"}}'
```
Linux/macOS (bash):
```bash
# GET without Authorization header → 401
curl -i "http://localhost:8080/scim/v2/Users"

# POST without Authorization header → 401
curl -i -X POST "http://localhost:8080/scim/v2/Users" \
  -H "Content-Type: application/json" \
  -d '{"userName":"unauth","name":{"givenName":"No","familyName":"Auth"}}'
```

### Refresh Token (Rotation)
```powershell
curl -X POST http://localhost:8080/oauth/refresh -d "refresh_token=<refresh_token>" -u demo-client:demo-secret
```

## Local Development (Without Docker)
Start Redis:
```powershell
redis-server
```
Run auth-service (build & run):
```powershell
mvn -f auth-service/pom.xml spring-boot:run
```
Run user-service:
```powershell
mvn -f user-service/pom.xml spring-boot:run
```
Run scim-service (install deps & start):
```powershell
npm run dev --prefix scim-service
```
Run Envoy:
```powershell
envoy -c ./envoy.yaml --log-level info
```

## Security Notes
- Password grant used ONLY for demo; replace with Authorization Code + PKCE.
- JWTs signed with ephemeral in-memory RSA key; use stable key management (e.g., AWS KMS / Hashicorp Vault) for production.
- JWK endpoint `/oauth/jwks` allows consumers to verify signatures (scim-service already does).
- Refresh token rotation prevents replay; consider adding token binding / device identifiers.
- Add rate limiting & anomaly detection at gateway for brute force mitigation.
- Gateway enforces JWT + scopes (Envoy jwt_authn + RBAC):
  - `GET /scim/*` requires `scim.read`
  - `POST|PUT|PATCH|DELETE /scim/*` requires `scim.write`
  - `/oauth/*` remains open for token issuance/refresh

## Extensibility
- Add role claims (`roles`) & enforce in services.
- Implement SCIM Groups + PATCH operations with full RFC 7644 compliance.
- Introduce OpenID Connect discovery + /.well-known endpoints.
- Add Prometheus metrics & structured audit logging (user create/update/delete).
- Integrate Envoy ext_authz filter for centralized JWT & scope enforcement.

## Troubleshooting
- 401 invalid signature: Ensure auth-service restarted (key rotation resets public key) and scim-service fetched latest JWK (restart scim-service).
- 401 token_expired: Request new access via refresh flow.
- 403 insufficient_scope: Token lacks required scope; reissue with correct scopes.
- `docker compose up build` fails: Use `docker compose up --build` (note the leading dashes).
- PowerShell token body missing: Either define `$body = @{ grant_type='password'; username='demo'; password='demo' }` and pass `-Body $body`, or pass a string body directly: `-Body 'grant_type=password&username=demo&password=demo'`.
- 403 on SCIM create with read-only token: Include `scope=scim.write` (or `scope=scim.read scim.write`) when requesting the token.
- RBAC: access denied on /oauth/token via gateway: Ensure Envoy RBAC explicitly allows unauthenticated access to `/oauth/*` and restart gateway (`docker compose restart gateway`).
- Jwt issuer is not configured on /scim/*: Ensure tokens include `"iss":"auth-service"` and Envoy's jwt_authn provider expects the same issuer; rebuild/restart auth-service if recently changed.
- Redis connection errors: Check container health (`docker compose ps`).
- gRPC errors (user not found): Ensure correct user ID; consistent after creation response.
- Envoy route mismatch: Confirm `envoy.yaml` has prefixes `/scim/`, `/oauth/`.
- 401 from Envoy on `/scim/*`: Missing/invalid/expired JWT or missing scopes.
  - Verify Authorization header is sent:
    ```powershell
    curl.exe -i "http://localhost:8080/scim/v2/Users"   # should return 401 when missing token
    $token = (Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/oauth/token' -ContentType 'application/x-www-form-urlencoded' -Body 'grant_type=password&username=demo&password=demo').access_token
    Invoke-RestMethod -Method Get -Uri 'http://localhost:8080/scim/v2/Users' -Headers @{ Authorization = "Bearer $token" } | ConvertTo-Json -Depth 3
    ```
  - Check JWKS availability and gateway logs:
    ```powershell
    curl.exe -s "http://localhost:8081/oauth/jwks"
    docker logs identity_management_platform-gateway-1 --tail 100
    ```
  - Ensure scopes include `scim.read` for GET and `scim.write` for POST/PUT/PATCH/DELETE (reissue token if needed).

### Quick restarts (Docker)
```powershell
cd identity_management_platform
# Reload gateway config (e.g., RBAC/JWT changes)
docker compose restart gateway
# Rebuild and restart auth-service (e.g., JWT claim changes)
docker compose build auth-service
docker compose up -d auth-service
```

## Verification Checklist
- [ ] `docker compose up` starts all containers without errors.
- [ ] Obtain token returns 200 and header shows `"alg":"RS256"`.
- [ ] JWK endpoint returns modulus `n` and exponent `e`.
- [ ] SCIM create returns 201 with `schemas` array.
- [ ] List users shows created user.
- [ ] Refresh token rotates tokens (old refresh invalid).

## License
Internal educational example; adapt for production security & compliance requirements.
