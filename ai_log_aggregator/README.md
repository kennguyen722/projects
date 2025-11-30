# AI Log Aggregator

Event-driven log ingestion, normalization, AI analysis, alerting, storage, and real-time visualization.

- Architecture overview: see `docs/architecture.md`
- Tech stack: Node.js (TypeScript), Kafka, PostgreSQL, WebSockets, React + Vite + Tailwind

This README provides everything you need to configure, build, run, test live events, and debug both backend and frontend. For API specifics, see `docs/api/README.md`. For contribution workflow, see `CONTRIBUTING.md`.

## Prerequisites
- Docker Desktop 4.0+ (with Docker Compose v2)
- Node.js 20+ and npm 9+ (for local dev/debug outside containers)
- PowerShell 5.1+ on Windows (commands use PowerShell syntax)

## Quick Start (Docker)
This starts the full stack: Kafka, Zookeeper, Schema Registry (internal), PostgreSQL, all backend services, and the React dashboard.

1) Build and start
```powershell
Push-Location "./infra"
docker compose build
docker compose up -d
docker compose ps
Pop-Location
```

2) Open the dashboard
- URL: `http://localhost:5173`

3) Verify service endpoints
- `npm run demo:sample` – seed only sample events (no synthetic fallback)
- WebSocket Gateway: `ws://localhost:8080`
- Ingestion API: `http://localhost:3001/ingest`
- Storage API: `http://localhost:4000/recent`

Additional quality gates:
- `npm run lint` enforces TypeScript/React code style (0 warnings allowed).
- `npm run typecheck` performs a TypeScript structural check without emitting output.

If either of these fail in CI, the build will surface the error logs for quick remediation.
If you have another app using one of these ports, see Troubleshooting to adjust ports.

## Configuration

Most configuration is set via `infra/docker-compose.yml`. For local development (without Docker), these env vars are read via `dotenv` in each service.

Common environment variables:
- `KAFKA_BROKERS`: Kafka bootstrap servers (default `kafka:9092` in Docker, `localhost:9092` locally)
- `OPENAI_API_KEY`: Optional key for AI analysis. If empty, the AI service safely degrades with `analysis_failed` summaries.

Service-specific variables:
- ingestion-service
	- `PORT` (default 3001)
	- `KAFKA_TOPIC_RAW` (default `logs.raw`)
- normalizer-service
	- `KAFKA_TOPIC_RAW` (default `logs.raw`)
	- `KAFKA_TOPIC_NORMALIZED` (default `logs.normalized`)
- ai-analysis-service
	- `KAFKA_TOPIC_NORMALIZED` (default `logs.normalized`)
	- `KAFKA_TOPIC_INSIGHTS` (default `logs.insights`)
	- `OPENAI_API_KEY` (optional)
- alert-service
	- `KAFKA_TOPIC_INSIGHTS` (default `logs.insights`)
- storage-service
	- `KAFKA_TOPIC_INSIGHTS` (default `logs.insights`)
	- `POSTGRES_URL` (default `postgres://postgres:postgres@postgres:5432/logs` in Docker)
	- `HTTP_PORT` (default 4000)
- websocket-gateway
	- `KAFKA_TOPIC_INSIGHTS` (default `logs.insights`)
	- `WS_PORT` (default 8080)
- react-dashboard
	- Frontend assumes `ws://<host>:8080` and `http://<host>:4000` by default.

Ports (defaults):
- Kafka: `9092`
- Zookeeper: `2181`
- Postgres: `5432`
- Ingestion API: `3001`
- Storage API: `4000`
- WebSocket Gateway: `8080`
- Dashboard (Vite): `5173`

## Services Overview
- ingestion-service: HTTP endpoint to receive client logs and enqueue to Kafka (`logs.raw`).
- normalizer-service: Consumes `logs.raw`, normalizes/enriches, outputs to `logs.normalized`.
- ai-analysis-service: Consumes `logs.normalized`, calls OpenAI (optional), writes results to `logs.insights`.
- alert-service: Consumes `logs.insights` and emits alerts (stdout/webhooks placeholder).
- storage-service: Persists `logs.insights` to Postgres; exposes `/recent` HTTP for historical queries with filters and paging.
- websocket-gateway: Subscribes to `logs.insights` and pushes live events to clients via WebSockets.
- react-dashboard: Visualizes live and historical data with filters, paging, and charts.

## Running Locally (Dev mode, optional)
You can run infrastructure in Docker and services locally for faster iteration.

1) Start infrastructure only (Kafka, ZK, Postgres, Schema Registry):
```powershell
Push-Location "./infra"
docker compose up -d zookeeper kafka schema-registry postgres
Pop-Location
```

2) Start backend services locally (each in its directory):
```powershell
# ingestion-service
Push-Location "./backend/ingestion-service"; npm install; npm run dev; Pop-Location

# normalizer-service
Push-Location "./backend/normalizer-service"; npm install; npm run dev; Pop-Location

# ai-analysis-service (OPENAI_API_KEY optional)
Push-Location "./backend/ai-analysis-service"; npm install; $env:OPENAI_API_KEY=$env:OPENAI_API_KEY; npm run dev; Pop-Location

# alert-service
Push-Location "./backend/alert-service"; npm install; npm run dev; Pop-Location

# storage-service (ensure Postgres is running)
Push-Location "./backend/storage-service"; npm install; npm run dev; Pop-Location

# websocket-gateway
Push-Location "./backend/websocket-gateway"; npm install; npm run dev; Pop-Location
```

3) Start the frontend locally:
```powershell
Push-Location "./frontend/react-dashboard"; npm install; npm run dev; Pop-Location
```
Open `http://localhost:5173` (Edge/Chrome recommended).

Note: When running services locally, they default to `localhost` brokers/DB. If needed, set envs like `KAFKA_BROKERS=localhost:9092` and `POSTGRES_URL=postgres://postgres:postgres@localhost:5432/logs`.

### Compose Profiles (Optional)
You can also start only infra with the `infra` profile:
```powershell
Push-Location "./infra"
docker compose --profile infra up -d
Pop-Location
```
Running `docker compose up -d` without profiles still brings up the entire stack.

## Test Live Events
Use the ingestion API to send test events. The dashboard should update in real-time (WebSocket) and historical queries will include the records from Postgres.

Send a single event:
```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3001/ingest -ContentType 'application/json' -Body (
	@{ source='demo-app'; level='info'; message='User signed in' } | ConvertTo-Json
)
```

Send multiple events quickly:
```powershell
1..5 | ForEach-Object {
	$lvl = @('debug','info','warn','error') | Get-Random
	$msg = "Test event $_ level=$lvl"
	Invoke-RestMethod -Method Post -Uri http://localhost:3001/ingest -ContentType 'application/json' -Body (
		@{ source='loadgen'; level=$lvl; message=$msg } | ConvertTo-Json
	) | Out-Null
}
```

Query recent history with filters and paging:
```powershell
# last 100 rows offset 0
Invoke-RestMethod -Method Get -Uri "http://localhost:4000/recent?limit=100&offset=0"

# only errors from source=demo-app in last 15 minutes
Invoke-RestMethod -Method Get -Uri "http://localhost:4000/recent?levels=error&source=demo-app&sinceMinutes=15"
```

Dashboard filters
- Demo mode
	- A one-command seeding script is included to showcase the charts:
	```powershell
	# Bring up the stack (if not already running) and seed 200 events, then open the dashboard
	Push-Location "./scripts"; ./demo.ps1 -BringUpStack -Count 200; Pop-Location

	# Or seed from a sample dataset (scripts/sample-events.jsonl is used automatically if present)
	Push-Location "./scripts"; ./demo.ps1; Pop-Location
	```
	- Flags: `-Count` controls synthetic event count, `-IngestUrl` overrides the ingestion endpoint.

	- Cross-platform npm demo (Node-based seeder):
	```powershell
	# Default (seed 200 synthetic events or sample file if present)
	npm run demo

	# Bring up the stack first, then seed
	npm run demo:bringup

	# Seed a custom count (example: 500)
	npm run demo:count
	```

- Level/source/time window filters in the top panel
- Paging with Prev/Next and “Go to” page number
- URL persists state (share filters by copying the URL)
- Charts: events over time, error rate, by-level, per-source throughput

## Debugging

### Backend (Node.js services)
Option A: Debug compiled output
```powershell
# Example: ingestion-service
Push-Location "./backend/ingestion-service"
npm install
npm run build
node --inspect=9229 dist/index.js
Pop-Location
```
Then in VS Code, use a Node attach config:
```json
{
	"version": "0.2.0",
	"configurations": [
		{
			"type": "node",
			"request": "attach",
			"name": "Attach to Node (9229)",
			"port": 9229,
			"restart": true
		}
	]
}
```

Option B: Debug TypeScript via dev:inspect scripts (fast iteration)
```powershell
# Each service has a dev:inspect script with a fixed port
Push-Location "./backend/ingestion-service"; npm install; npm run dev:inspect; Pop-Location   # 9221
Push-Location "./backend/normalizer-service"; npm install; npm run dev:inspect; Pop-Location  # 9222
Push-Location "./backend/ai-analysis-service"; npm install; npm run dev:inspect; Pop-Location # 9223
Push-Location "./backend/alert-service"; npm install; npm run dev:inspect; Pop-Location      # 9224
Push-Location "./backend/storage-service"; npm install; npm run dev:inspect; Pop-Location    # 9225
Push-Location "./backend/websocket-gateway"; npm install; npm run dev:inspect; Pop-Location  # 9226
```
Then attach in VS Code using the matching "Attach: ..." target.

Tip: Repeat for any service directory. If you need different ports, change `--inspect` and the launch config port accordingly.

### Frontend (React + Vite)
1) Start Vite dev server:
```powershell
Push-Location "./frontend/react-dashboard"; npm install; npm run dev; Pop-Location
```

2) VS Code debug with Edge/Chrome:
```json
{
	"version": "0.2.0",
	"configurations": [
		{
			"type": "pwa-msedge",
			"request": "launch",
			"name": "Launch Edge (Vite)",
			"url": "http://localhost:5173",
			"webRoot": "${workspaceFolder}/frontend/react-dashboard"
		},
		{
			"type": "pwa-chrome",
			"request": "launch",
			"name": "Launch Chrome (Vite)",
			"url": "http://localhost:5173",
			"webRoot": "${workspaceFolder}/frontend/react-dashboard"
		}
	]
}
```

Source maps are enabled by Vite; set breakpoints in `.tsx` files.

### VS Code Tasks and Compounds
This repo includes preconfigured tasks and launchers under `.vscode/`:
- Tasks (Terminal > Run Task…):
	- `infra: up (profile)`, `infra: down -v (profile)`
	- `stack: up (full)`, `stack: down -v (full)`
	- `dev: ingestion (9221)`, `dev: normalizer (9222)`, `dev: ai-analysis (9223)`, `dev: alert (9224)`, `dev: storage (9225)`, `dev: websocket (9226)`, `dev: dashboard`
- Launch (Run and Debug):
	- Per-service attaches matching the ports above
	- Compounds: `Attach: All Backends` and `Dev: Dashboard + WS + Storage`

Typical dev flow:
1) Run `infra: up (profile)`
2) Run any combination of `dev:*` tasks (they stay attached in terminals)
3) Start `Dev: Dashboard + WS + Storage` compound from Run and Debug

## Troubleshooting
- Port conflicts
	- WebSocket Gateway uses `8080`. If another app uses it, edit `infra/docker-compose.yml` (change `8080:8080` and set `WS_PORT`), then `docker compose up -d`.
	- Dashboard uses `5173`. Adjust similarly if needed.
- No live data on dashboard
	- Ensure WebSocket Gateway is up and reachable at `ws://localhost:8080`.
	- Send test events to `http://localhost:3001/ingest` and watch network console.
- History empty
	- Check Postgres is running and `storage-service` logs. `/recent` should return JSON and an `X-Total-Count` header.
- AI analysis disabled
	- Set `OPENAI_API_KEY` for improved summaries. Without it, the pipeline still functions.

## CI
- GitHub Actions workflow validates builds for all services and the dashboard on push/PR.
	- Workflow: `.github/workflows/ci.yml`
	- Matrix can be extended later to run service tests/integration checks.

## Clean Up
```powershell
Push-Location "./infra"
docker compose down -v
Pop-Location
```

This will stop services and remove volumes (including Kafka/Postgres data).

---

For deeper details, see `docs/architecture.md` and browse each service’s `src/` directory.
