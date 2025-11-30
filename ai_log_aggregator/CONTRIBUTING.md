# Contributing Guide

Thank you for contributing to AI Log Aggregator! This guide explains the development workflow, coding conventions, testing, debugging, and how to open good pull requests.

## Project Layout
- Monorepo: `backend/` services, `frontend/react-dashboard`, `infra/` for Docker Compose and k8s stubs, `docs/` for docs.
- Language: TypeScript for Node services; React + Vite for the UI.

## Prerequisites
- Node.js 20+, npm 9+
- Docker Desktop (for infra)
- PowerShell (Windows) or a POSIX shell

## Development Workflow
1) Start infra (Kafka, ZK, Schema Registry, Postgres):
```powershell
Push-Location "./infra"; docker compose --profile infra up -d; Pop-Location
```
2) Run services in dev mode with inspector ports (choose what you need):
```powershell
# Each service has a fixed dev:inspect port
Push-Location "./backend/ingestion-service"; npm install; npm run dev:inspect; Pop-Location   # 9221
Push-Location "./backend/normalizer-service"; npm install; npm run dev:inspect; Pop-Location  # 9222
Push-Location "./backend/ai-analysis-service"; npm install; npm run dev:inspect; Pop-Location # 9223
Push-Location "./backend/alert-service"; npm install; npm run dev:inspect; Pop-Location      # 9224
Push-Location "./backend/storage-service"; npm install; npm run dev:inspect; Pop-Location    # 9225
Push-Location "./backend/websocket-gateway"; npm install; npm run dev:inspect; Pop-Location  # 9226
```
3) Start the dashboard:
```powershell
Push-Location "./frontend/react-dashboard"; npm install; npm run dev; Pop-Location
```
4) Attach debugger(s) in VS Code:
- Use the included `.vscode/launch.json` single attaches or compounds

## Coding Conventions
- TypeScript strictness as defined in each `tsconfig.json`
- Prefer small, focused modules and pure functions in business logic
- Avoid one-letter variables; use descriptive names
- Error handling: catch and return typed errors on HTTP; log and continue for streaming consumers
- Keep public APIs stable; avoid breaking changes to topics and HTTP contracts

## Commit Style
- Use Conventional Commits where possible:
  - `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `build:`
- Keep subject lines under ~72 chars; include scope when useful, e.g. `feat(storage): add sinceMinutes filter`

## Testing
- ingestion-service includes Jest scaffolding; add unit tests near `src/__tests__/`
- For other services, prefer fast unit tests around pure/utility logic and integration tests against local infra when needed
- Sample ingestion test run:
```powershell
Push-Location "./backend/ingestion-service"; npm test; Pop-Location
```

## Running the Full Stack
- Docker (recommended for validation):
```powershell
Push-Location "./infra"; docker compose up -d; docker compose ps; Pop-Location
```
- Dashboard: http://localhost:5173
- Ingestion API: http://localhost:3001/ingest
- Storage API: http://localhost:4000/recent
- WebSocket: ws://localhost:8080

## Debugging Tips
- Start services with `npm run dev:inspect` and attach via VS Code
- Use the compound `Attach: All Backends` to debug multiple services
- If the dashboard shows no live data:
  - Ensure `websocket-gateway` is running and port 8080 is free
  - Send a few events to `/ingest` to prime the pipeline

## Pull Request Checklist
- [ ] The change is scoped and documented (README or docs updated if needed)
- [ ] CI/build passes locally (`build: all (parallel)` task or `npm run build` per service)
- [ ] Tests updated or added, where applicable
- [ ] Manual verification steps described in the PR description
- [ ] No unrelated diffs, formatting-only changes, or generated files checked in

## Issue Triage
- Use labels `bug`, `enhancement`, `docs`, `infra`
- Link issues to PRs using keywords (e.g., "Fixes #123")

## Code of Conduct
- Be respectful and constructive in discussions and reviews. Assume good intent and help others grow.
