# Identity Platform — Service Deep Dive

This document explains how each service and component in the identity platform works, with a walkthrough of the key code paths and runtime interactions.

## Overview
- Gateway (Envoy): Single entrypoint at `:8080`, routes traffic to services, validates JWTs, and enforces scopes.
- Auth Service (Spring Boot): Issues RS256-signed JWT access tokens and refresh tokens; publishes JWKS for verification.
- SCIM Service (Node.js): Implements SCIM 2.0 REST API and calls the gRPC user service.
- User Service (Spring Boot + gRPC): In-memory CRUD over users via gRPC.
- Redis: Refresh token storage for the auth service (with in-memory fallback for local dev).

---

## Auth Service (Spring Boot)
Location: `identity_management_platform/auth-service`

### Responsibilities
- Issue short-lived RS256 JWT access tokens and longer-lived refresh tokens.
- Store refresh tokens in Redis; fallback to in-memory store if Redis is unavailable.
- Publish a JWKS endpoint (`/oauth/jwks`) so other services and the gateway can verify signatures.

### Key Classes
- `idm.auth.config.SecurityConfig`
  - Disables CSRF and permits public access to `/oauth/token`, `/oauth/refresh`, `/oauth/jwks`, `/actuator/**`.
  - Enables HTTP Basic (not currently used by `TokenController`, but harmless for local dev).
- `idm.auth.config.JwtKeys`
  - Generates an ephemeral RSA 2048-bit `KeyPair` at startup.
  - Exposes `/oauth/jwks` via an inner `JwksController` that publishes a JSON Web Key Set with:
    - `kty=RSA`, `alg=RS256`, `use=sig`, `kid=primary` and the base64url modulus `n` and exponent `e`.
  - Normalizes leading zero bytes in `n`/`e` to maintain proper unsigned big-integer encoding before base64url.
- `idm.auth.token.TokenController`
  - Mounts under `/oauth/*` and implements two POST endpoints:
    - `/oauth/token` (password grant demo):
      - Validates `grant_type=password` and the demo credentials `demo/demo`.
      - Builds a JWT with header `{ alg: RS256, typ: JWT, kid: "primary" }` and payload including `iss`, `sub`, `scope`, `iat`, and `exp`.
      - Signs with `Signature(SHA256withRSA)` using the private key from `KeyPair`.
      - Creates and stores a refresh token in Redis (TTL: 1h). If Redis fails, falls back to an in-memory map with expiration.
      - Response: `{ access_token, token_type: "Bearer", expires_in: 300, refresh_token, scope }`.
    - `/oauth/refresh`:
      - Consumes a valid refresh token (deletes it) and issues a fresh pair (access + refresh), enabling refresh token rotation.
  - Helper behavior:
    - `storeRefresh` attempts Redis first, then in-memory fallback.
    - `consumeRefresh` tries Redis first, then fallback; returns username or `null`.

### Endpoints
- `POST /oauth/token` → Issue access + refresh token (demo password grant).
- `POST /oauth/refresh` → Exchange refresh for new pair (rotation).
- `GET /oauth/jwks` → Publish JWKS for RS256 verification.

### Notes
- Keys are ephemeral (in-memory). Restarting the auth-service rotates keys and invalidates previously issued access tokens for verifiers that still cache the old JWK.
- Scopes in issued tokens default to `scim.read scim.write`.

---

## User Service (Spring Boot + gRPC)
Location: `identity_management_platform/user-service`

### Responsibilities
- Provide a simple in-memory user store via a gRPC API defined in `proto/user.proto`.

### Protocol Contract (gRPC)
File: `identity_management_platform/proto/user.proto`
- Service `UserService` operations:
  - `CreateUser(CreateUserRequest) → UserResponse`
  - `GetUser(GetUserRequest) → UserResponse`
  - `ListUsers(ListUsersRequest) → ListUsersResponse`
  - `UpdateUser(UpdateUserRequest) → UserResponse`
  - `DeleteUser(DeleteUserRequest) → DeleteUserResponse`
- Message `User` fields: `id`, `userName`, `givenName`, `familyName`, `emails[]`, `active`.

### Application Boot
- `idm.user.UserServiceApplication` (Spring Boot):
  - On start (`CommandLineRunner`), builds a gRPC `Server` on port `8083` and registers `UserServiceImpl`.
  - Adds a JVM shutdown hook to gracefully stop the gRPC server.

### Service Implementation
- `idm.user.UserServiceImpl`:
  - Maintains an in-memory `ConcurrentHashMap<String, User>` as the backing store.
  - `createUser`: Assigns a random UUID, saves, and returns the created user.
  - `getUser`: Returns the user by id or emits an error (mapped to NOT_FOUND at client).
  - `listUsers`: Returns all users with a `total` count (paging fields accepted but not used).
  - `updateUser`: Replaces an existing user by id, or errors if not found.
  - `deleteUser`: Removes by id and returns `deleted: true/false` indicating result.

### Notes
- The service is stateful in-memory for demo purposes; a real implementation would persist to a database and implement paging, filtering, and validation.

---

## SCIM Service (Node.js + Express)
Location: `identity_management_platform/scim-service`

### Responsibilities
- Expose SCIM 2.0 REST endpoints and translate requests to the gRPC user service.
- Verify JWTs (RS256) from the auth-service JWKS and enforce scopes on each route.

### Startup and gRPC Client
- Loads `proto/user.proto` using `@grpc/proto-loader` and `@grpc/grpc-js`.
- Determines gRPC target as `dns:///<GRPC_USER_HOST>:<GRPC_USER_PORT>` for reliable Docker DNS resolution. Default: `user-service:8083`.
- Creates an insecure gRPC client (intra-network, demo).

### JWT Verification and Scopes
- Fetches JWKs from `process.env.JWKS_URL` or default `http://auth-service:8081/oauth/jwks`.
- Imports the RSA public key directly from JWK via `crypto.createPublicKey({ key: jwk, format: 'jwk' })`.
- Middleware `authorize(requiredScope)`:
  - Extracts `Authorization: Bearer <token>`; splits into header, payload, signature.
  - Validates `exp` if present.
  - Verifies `RSA-SHA256` signature against the imported public key.
  - On failure, retries once after refetching JWK (to cover rotation races).
  - Ensures the `scope` claim contains the `requiredScope` (`scim.read` or `scim.write`).
  - Attaches `req.user = payload.sub` on success.
- `DISABLE_SIGNATURE_VERIFY=true` can bypass verification (dev-only switch), but is off by default.

### SCIM Endpoints
- `GET /scim/v2/Users` (requires `scim.read`):
  - Calls `ListUsers` gRPC, maps results to SCIM `Resources` and `totalResults`.
- `POST /scim/v2/Users` (requires `scim.write`):
  - Maps SCIM payload to gRPC `User`, calls `CreateUser`, returns `201` with SCIM user.
- `GET /scim/v2/Users/:id` (requires `scim.read`):
  - Calls `GetUser`, returns SCIM user or `404`.
- `PUT /scim/v2/Users/:id` (requires `scim.write`):
  - Builds updated gRPC `User` and calls `UpdateUser`, returns SCIM user or `404`.
- `DELETE /scim/v2/Users/:id` (requires `scim.write`):
  - Calls `DeleteUser`, returns `204` if deleted else `404`.

### SCIM Mapping
- Helper `toScim(u)` maps gRPC user to SCIM User schema:
  - `userName`, `name.givenName`, `name.familyName`, `emails[]`, `active`, and SCIM `schemas` array.

---

## Gateway (Envoy Proxy)
Location: `identity_management_platform/envoy.yaml`

### Responsibilities
- Single HTTP entrypoint on `:8080`.
- Route requests to underlying services and enforce authentication/authorization at the edge.

### Routing
- `/scim/*` → `scim_service` cluster (SCIM REST API)
- `/oauth/*` → `auth_service` cluster (token, refresh, JWKS)
- `/grpc.user.UserService/*` → `user_service` cluster (gRPC passthrough; generally accessed by SCIM internally)

### HTTP Filters
- `envoy.filters.http.jwt_authn`:
  - Provider `auth_provider` with `remote_jwks` pointing to `http://auth-service:8081/oauth/jwks`.
  - `payload_in_metadata: "jwt"` for downstream filters.
  - Rules:
    - Require JWT for `/scim/*`.
    - Allow missing JWT for `/oauth/*`.
- `envoy.filters.http.rbac`:
  - Enforces scopes based on the JWT metadata populated by `jwt_authn`:
    - `GET /scim/*` requires `scope` containing `scim.read`.
    - `POST|PUT|PATCH|DELETE /scim/*` requires `scope` containing `scim.write`.
- `envoy.filters.http.router`: Standard router.

Issuer requirement:
- The `jwt_authn` provider expects the token issuer to be `auth-service` (set in the token's `iss` claim).
- If you change the issuer in tokens, also update the Envoy provider issuer accordingly.

### Clusters
- `auth_service` (LOGICAL_DNS) → `auth-service:8081`
- `scim_service` (LOGICAL_DNS) → `scim-service:8082`
- `user_service` (LOGICAL_DNS + HTTP/2) → `user-service:8083`

### Notes
- Edge validation reduces the chance unauthorized traffic reaches backend services.
- JWKS fetch is cached by Envoy; consider rotation strategies and TTLs in production.

---

## Docker Compose & Runtime
Location: `identity_management_platform/docker-compose.yml`

- Services:
  - `redis:7-alpine` (exposes 6379 locally).
  - `auth-service` (builds from Dockerfile; env: `SERVER_PORT=8081`, `REDIS_HOST=redis`).
  - `user-service` (builds from Dockerfile; gRPC on 8083).
  - `scim-service` (builds from Dockerfile; env: `GRPC_USER_HOST=user-service`, `GRPC_USER_PORT=8083`, `JWKS_URL=http://auth-service:8081/oauth/jwks`).
  - `gateway` (Envoy v1.30; mounts `envoy.yaml` and exposes `:8080`).
- Network: default network named `idm-net` allowing containers to resolve each other by service name.

---

### Quick Restarts (Docker)
```powershell
cd identity_management_platform
# Pick up Envoy config edits (routes/RBAC/jwt_authn)
docker compose restart gateway
# Pick up auth-service code/config edits (e.g., JWT issuer)
docker compose build auth-service
docker compose up -d auth-service
```

---

## End-to-End Flow
1. Client requests token from gateway: `POST /oauth/token` with demo creds.
2. Gateway routes to auth-service, which issues an RS256 JWT and a refresh token.
3. Client calls `GET /scim/v2/Users` with `Authorization: Bearer <access_token>`.
4. Gateway validates JWT via `jwt_authn` against auth-service JWKS, then checks scope via RBAC.
5. Gateway routes to scim-service; scim-service also verifies signature and scope, then calls gRPC user-service.
6. user-service returns results to scim-service, which maps to SCIM and returns to client via gateway.

### Sequence Diagram

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant G as Gateway (Envoy)
  participant A as Auth Service
  participant R as Redis
  participant S as SCIM Service
  participant U as User Service (gRPC)

  rect rgb(245,245,245)
  Note over C,G: Token issuance
  C->>G: POST /oauth/token (demo creds)
  G->>A: Forward /oauth/token
  A->>R: Store refresh token (TTL)
  R-->>A: OK
  A-->>G: 200 {access_token, refresh_token}
  G-->>C: 200 {access_token, refresh_token}
  end

  rect rgb(245,245,245)
  Note over C,G: SCIM list with JWT
  C->>G: GET /scim/v2/Users (Authorization: Bearer <token>)
  alt Envoy jwt_authn needs JWKS or refresh
    G->>A: GET /oauth/jwks (remote_jwks)
    A-->>G: 200 JWKS
  end
  Note over G: Validate RS256 signature; extract claims to metadata
  Note over G: RBAC checks scope (scim.read for GET)
  G->>S: Forward /scim/v2/Users
  end

  rect rgb(245,245,245)
  Note over S: Defense-in-depth verification
  alt SCIM needs JWKS (startup/rotation retry)
    S->>A: GET /oauth/jwks
    A-->>S: 200 JWKS
  end
  Note over S: Verify RS256 signature; check scope contains scim.read
  S->>U: gRPC ListUsers()
  U-->>S: Users list
  S-->>G: 200 { Resources[], totalResults }
  G-->>C: 200 { Resources[], totalResults }
  end
```

---

## Security Considerations
- Demo-only password grant; production should use Authorization Code + PKCE.
- Ephemeral keys; replace with managed keys (e.g., KMS/HSM/Vault) for stability and rotation.
- Add rate limiting and anomaly detection at the gateway.
- Prefer mTLS between internal services in production.

Common errors and fixes:
- `RBAC: access denied` when calling `/oauth/token` via gateway:
  - Ensure RBAC explicitly allows unauthenticated access to `/oauth/*` and restart the gateway: `docker compose restart gateway`.
- `Jwt issuer is not configured` when calling `/scim/*`:
  - Ensure issued JWTs include `"iss":"auth-service"` and that Envoy’s jwt_authn provider expects the same issuer.

---

## Quick Test Commands (PowerShell)
```powershell
# Start stack
cd identity_management_platform
docker compose up -d --build

# Get token
$body = @{ grant_type='password'; username='demo'; password='demo' }
$token = (Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/oauth/token' -ContentType 'application/x-www-form-urlencoded' -Body $body).access_token

# List users
Invoke-RestMethod -Method Get -Uri 'http://localhost:8080/scim/v2/Users' -Headers @{ Authorization = "Bearer $token" } | ConvertTo-Json -Depth 3
```
