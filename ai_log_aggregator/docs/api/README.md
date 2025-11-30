# API Reference

This document details the public HTTP endpoints and WebSocket stream. Internal Kafka topics and contracts are also summarized.

## Ingestion API (HTTP)

Endpoint
- `POST /ingest` (service: ingestion-service)

Headers
- `Content-Type: application/json`

Request body
```json
{
	"source": "demo-app",
	"level": "debug|info|warn|error",
	"message": "...",
	"timestamp": "2025-11-30T20:10:00.000Z", // optional
	"context": { "any": "json" }
}
```

Responses
- 202 Accepted: `{ "status": "queued" }`
- 400 Bad Request: `{ "error": <zod validation errors> }`
- 500 Internal Server Error: `{ "error": "kafka_produce_failed" }`

Example (PowerShell)
```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3001/ingest -ContentType 'application/json' -Body (
	@{ source='demo-app'; level='info'; message='User signed in' } | ConvertTo-Json
)
```

## Storage API (HTTP)

Endpoint
- `GET /recent` (service: storage-service)

Query parameters
- `limit` (default 100, max 1000)
- `offset` (default 0)
- `levels` (comma-separated: debug,info,warn,error)
- `source` (string)
- `sinceMinutes` (integer > 0)

Response
- Body: JSON array of rows `[{ id, source, level, message, timestamp, insight }]`
- Header: `X-Total-Count` equals the total rows matching filters (for paging)

Examples
```powershell
# first page
Invoke-RestMethod -Method Get -Uri "http://localhost:4000/recent?limit=100&offset=0"

# errors from demo-app in last 15 minutes
Invoke-RestMethod -Method Get -Uri "http://localhost:4000/recent?levels=error&source=demo-app&sinceMinutes=15"
```

## WebSocket Stream

Endpoint
- `ws://localhost:8080` (service: websocket-gateway)

Protocol
- Server broadcasts JSON messages: `{ topic, payload }`
- `topic` is typically `logs.insights`
- `payload` contains `{ source, level, message, timestamp, insight }`

Example message
```json
{
	"topic": "logs.insights",
	"payload": {
		"source": "demo-app",
		"level": "warn",
		"message": "Slow query",
		"timestamp": "2025-11-30T20:13:00.000Z",
		"insight": { "summary": "Possible index issue", "confidence": 0.6 }
	}
}
```

## Kafka Topics (Internal)

- `logs.raw`: raw ingest payloads
- `logs.normalized`: normalized schema
- `logs.insights`: enriched with AI analysis `{ insight: { summary, confidence } }`

Consumer groups
- Each service has its own group (e.g., `ws-gateway-group`, `storage-service-group`).
- Scale consumers horizontally under the same group to parallelize.

