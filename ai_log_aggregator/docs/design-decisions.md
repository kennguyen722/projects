# Design Decisions and Trade-offs

This document records notable choices and trade-offs made while building the AI Log Aggregator. It aims to give future contributors the context required to evolve the system confidently.

## Messaging and Delivery Semantics
- Kafka as backbone: We use Kafka for decoupling producers/consumers, buffering, and scalable fan-out. This lets ingestion proceed even when downstreams are slow.
- At-least-once consumption: Consumers may reprocess on retries. We keep storage append-only and avoid side effects in consumers that must be exactly-once. If deduplication is needed, add a stable message key or UPSERT strategy with unique constraints.
- Partitions vs parallelism: Throughput scales with partitions per topic. Start with a small number (e.g., 3–6) and increase based on workload and consumer capacity.

## Ingestion Producer Lifecycle
- Simplicity-first producer usage: The ingestion-service currently connects, produces, and disconnects per request for clarity and minimal moving parts.
- Trade-off: Per-request connect/disconnect adds latency and CPU. Under heavier loads, pool a single producer and reuse the connection (connect at process start, handle backpressure and retries). We kept the simple approach to reduce complexity for local dev and demos.

## Topic Stratification
- `logs.raw` → `logs.normalized` → `logs.insights`: Clear separation of concerns. Each stage has a single responsibility and can be tested independently.
- Trade-off: Additional topics mean more moving pieces and slightly more storage, but the clarity, testability, and extensibility outweigh the cost.

## AI Analysis Behavior
- Optional dependency: If `OPENAI_API_KEY` is not set or the API fails, we emit a fallback `analysis_failed` insight. This ensures the pipeline continues to function.
- Trade-off: Results can be less informative without AI. This avoids hard coupling the pipeline to an external API.

## Storage Schema and API
- Append-only table: `logs(id, source, level, message, timestamp, insight JSONB)`. Easy to ingest and query. Historical data can be trimmed with retention policies or partitioning.
- Trade-off: No relational normalization of sources/levels. For analytics at scale, consider time-series partitioning, indexes on `(timestamp, level, source)`, and retention windows.
- HTTP `/recent` with filters: Lightweight API for the dashboard with `X-Total-Count` for paging. Trade-off: This is not a full query engine; it’s intentionally focused on the dashboard’s needs.

## Real-time Delivery Protocol
- WebSockets from a `websocket-gateway` subscriber: Minimal custom protocol `{ topic, payload }`, simple to integrate with charts.
- Trade-off: Did not choose SSE or gRPC streaming. WebSockets provide broad browser support with bi-directional capability if needed later.

## Frontend Trade-offs
- Vite + React + Recharts: Fast dev experience, expressive charts.
- Client-side filtering + server paging: Keeps interactions snappy with a cache while still allowing scalable backends via `/recent`.
- Trade-off: Recharts is not the most lightweight; for extremely high-frequency updates, consider canvas/WebGL-based charting.

## Schema Registry
- Added Schema Registry container for future growth but not currently used by services. Trade-off: We kept JSON payloads to maximize approachability for contributors.

## Security Posture (Dev-first)
- No auth on ingestion/storage in the demo stack; CORS permissive for local dev.
- Trade-off: Great for velocity, not for production. Production guidance includes API authN/Z, rate-limiting, PII scrubbing, TLS termination, and network policies.

## Operations and Observability
- Logging to stdout for Docker capture; no metrics/tracing by default.
- Trade-off: Lower complexity for demos. Recommended to add Prometheus metrics and OpenTelemetry when moving beyond local dev.

## Alternative Considerations
- SSE vs WebSockets: SSE is simpler for one-way streams but less flexible than WS. We chose WS for future two-way controls (e.g., live filter changes).
- Single topic vs multiple: A single topic with type tags is simpler but muddier. Multi-topic emphasizes pipeline stages and aligns with team boundaries.
- Centralized alerting engine: Possible, but we kept `alert-service` minimal to encourage extension by implementers.
