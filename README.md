# Surpluss – Reliable Webhook Processor

A webhook ingestion and background processing service built with TypeScript, NestJS, PostgreSQL, Next.js, and Docker Compose.

## 1. Project Overview

Webhook senders retry deliveries unpredictably, downstream processing can fail transiently, and worker processes can crash mid-execution. Surpluss decouples ingestion from execution:

1. **Ingestion (`POST /webhooks`)** validates incoming payloads, persists events to PostgreSQL using `eventId` as an idempotency key, and returns `202 Accepted` immediately for both new and duplicate deliveries.
2. **Background Workers (`worker1`, `worker2`)** run as independent containers, claim eligible events via PostgreSQL row-level locking (`SELECT ... FOR UPDATE SKIP LOCKED`), renew leases via heartbeats for long-running jobs, retry transient failures with exponential backoff, and recover expired leases after worker crashes.
3. **Operations Dashboard (`apps/web`)** provides visibility into aggregate pipeline metrics, event filtering/sorting, original payloads, worker attempt timelines, and manual retries for permanently failed events.

---

## 2. Features

- **Asynchronous Webhook Ingestion**: `POST /webhooks` validates `eventId` and `type` (trimmed, non-empty) and persists before acknowledging `202 Accepted`.
- **Idempotent Delivery Handling**: Unique constraint on `webhook_events.event_id` prevents duplicate ingestion under concurrent requests; subsequent deliveries with the same `eventId` (even with a different payload) preserve the original payload.
- **Independent Concurrent Workers**: Two separate worker containers (`worker1`, `worker2`) claim and process events concurrently without double-claiming.
- **PostgreSQL Lease & Heartbeat Coordination**: Workers set a `lease_expires_at` deadline and renew it periodically so jobs exceeding the initial lease timeout are not reclaimed while the worker is healthy.
- **Exponential Backoff Retries**: Configurable retry budget (`MAX_RETRY_ATTEMPTS`), initial delay, multiplier, and max delay cap; transitions to `FAILED` once exhausted.
- **Crash Recovery**: Background scan detects `PROCESSING` rows with expired leases and transitions them to `RETRY_PENDING` (or `FAILED` if the budget is exhausted).
- **Atomic Business Action**: Inserts into `processed_orders` (`UNIQUE(event_id)`) and marks the event `COMPLETED` inside a single PostgreSQL transaction with worker ownership verification.
- **Attempt History & Manual Retry**: Immutable `processing_attempts` log per attempt; `POST /events/:id/retry` assigns a fresh retry budget to `FAILED` events while preserving history and globally increasing attempt numbers.
- **Operations Dashboard**: Next.js App Router UI with status metrics, pipeline distribution bar, search, status/type filters, sorting, pagination, JSON payload copy, attempt timeline, and confirmation-guarded manual retry.
- **Automated Integration Tests**: Jest suite executing against live PostgreSQL and the running API.

---

## 3. Technology Stack

| Category | Technology | Purpose |
|---|---|---|
| **Backend** | NestJS 10, Express, `@nestjs/config`, `@nestjs/swagger` | REST API, validation pipeline, exception filtering, OpenAPI docs |
| **Frontend** | Next.js 14 (App Router), React 18, Tailwind CSS, `lucide-react`, `clsx` | Operations dashboard UI |
| **Database** | PostgreSQL 16, Prisma 5 (`@prisma/client`) | Persistence, migrations, row-level locking (`$queryRaw` / `$executeRaw`) |
| **Worker** | Node.js 20, TypeScript, Prisma Client | Standalone polling, lease heartbeats, crash recovery |
| **Validation** | `class-validator`, `class-transformer`, `zod` | DTO validation and shared payload/simulation schemas |
| **Testing** | Jest 29, `ts-jest`, `supertest` | Database concurrency/recovery tests and HTTP API tests |
| **Infrastructure** | Docker, Docker Compose | Multi-container local orchestration (`postgres`, `migrate`, `api`, `worker1`, `worker2`, `web`) |

---

## 4. Architecture

```mermaid
flowchart LR
    Sender["Webhook Sender"] -->|"POST /webhooks (202)"| API["NestJS API (:3000)"]
    Dashboard["Next.js Dashboard (:3001)"] -->|"GET /events, POST /retry"| API
    API -->|"Prisma / SQL"| DB[("PostgreSQL (:5432)\nwebhook_events\nprocessing_attempts\nprocessed_orders")]
    DB <-->|"SELECT FOR UPDATE SKIP LOCKED\nHeartbeat & Recovery"| W1["Worker 1"]
    DB <-->|"SELECT FOR UPDATE SKIP LOCKED\nHeartbeat & Recovery"| W2["Worker 2"]
```

### Event Lifecycle

```text
POST /webhooks ──▶ PENDING
                      │
                      │ Worker claims (FOR UPDATE SKIP LOCKED)
                      ▼
                 PROCESSING ◀───────────────────────────┐
                      │                                 │
         ┌────────────┴────────────┐                    │
         │ Success                 │ Failure /          │ Retry when
         │ (atomic tx:             │ Expired Lease      │ next_retry_at <= NOW()
         │  processed_orders +     │                    │
         │  COMPLETED)             ▼                    │
         ▼                   RETRY_PENDING ─────────────┘
    COMPLETED                      │
                                   │ attempt_count >= max_attempts
                                   ▼
                                FAILED ──(Manual Retry)──▶ RETRY_PENDING
```

1. **Webhook received & validated**: `IngestWebhookDto` trims and validates `eventId` and `type`.
2. **Persisted**: Inserted into `webhook_events` as `PENDING`. Duplicate `eventId` hits PostgreSQL unique violation (`P2002`) and returns `202` without modifying the stored payload.
3. **Worker claim**: Each worker polls every `WORKER_POLL_INTERVAL_MS` using a transaction with `SELECT ... FOR UPDATE SKIP LOCKED` to atomically claim one eligible `PENDING` or due `RETRY_PENDING` event, setting `status = PROCESSING`, `worker_id`, `lease_expires_at`, and incrementing `attempt_count`.
4. **Processing & Heartbeat**: A `processing_attempts` row is created. While executing, a timer renews `lease_expires_at` every `WORKER_HEARTBEAT_INTERVAL_MS`.
5. **Completion or Retry**:
   - On success, `completeEvent()` runs a single transaction inserting into `processed_orders` (`ON CONFLICT (event_id) DO NOTHING`), updating `webhook_events` to `COMPLETED` (checking `WHERE worker_id = $me AND status = 'PROCESSING'`), and marking the attempt `SUCCESS`.
   - On failure, `failAttempt()` records `FAILURE` on the attempt and transitions the event to `RETRY_PENDING` (with exponential backoff `next_retry_at`) or `FAILED` if `attempt_count >= max_attempts`.

---

## 5. Project Structure

```text
.
├── apps/
│   ├── api/                        # NestJS API & Prisma schema
│   │   ├── prisma/
│   │   │   ├── schema.prisma       # Database models (webhook_events, processing_attempts, processed_orders)
│   │   │   └── migrations/         # SQL migrations (20240101000000_init)
│   │   ├── src/
│   │   │   ├── common/filters/     # Global HttpExceptionFilter
│   │   │   ├── config/             # Environment config loader
│   │   │   ├── modules/
│   │   │   │   ├── events/         # GET /events, /events/stats, /events/:id, POST /events/:id/retry
│   │   │   │   ├── prisma/         # PrismaService lifecycle & health check
│   │   │   │   └── webhooks/       # POST /webhooks ingestion & deduplication
│   │   │   ├── app.module.ts
│   │   │   ├── health.controller.ts
│   │   │   └── main.ts
│   │   └── Dockerfile
│   ├── worker/                     # Standalone background worker process
│   │   ├── src/worker.ts           # Claiming, simulation, heartbeat, completion tx, crash recovery
│   │   └── Dockerfile
│   └── web/                        # Next.js 14 operations dashboard
│       ├── src/
│       │   ├── app/                # App Router layout & main dashboard page
│       │   ├── components/
│       │   │   ├── events/         # EventsTable, EventFilters, EventDetailsDrawer, AttemptTimeline
│       │   │   └── ui/             # StatCard, StatusBadge, JsonViewer, ConfirmDialog, Pagination, etc.
│       │   ├── hooks/              # useEventStats, useEvents, useEventDetails, useRetryEvent
│       │   ├── lib/format.ts       # Date/duration formatting helpers
│       │   └── services/api.ts     # Typed HTTP client
│       └── Dockerfile
├── packages/
│   └── shared/src/index.ts         # Shared TypeScript interfaces, Zod schemas, backoff helpers
├── database/seeds/
│   ├── seed.ts                     # Optional seed script (20 sample events)
│   └── demo-scenarios.sh           # Bash script for assessment scenarios
├── tests/
│   └── integration/
│       ├── webhook-processor.test.ts  # DB concurrency, idempotency, retry, recovery tests
│       └── api-e2e.test.ts            # HTTP API validation & race-safe retry tests
├── docker-compose.yml
├── .env.example
└── package.json
```

---

## 6. Prerequisites

- **For Docker Compose startup (recommended)**:
  - Docker and Docker Compose v2 (`docker compose`)
  - Git
  - Node.js is **not** required on the host to run the application via Docker Compose.
- **For running automated tests or local development on the host**:
  - Node.js 20+ and npm

---

## 7. Environment Configuration

`docker-compose.yml` provides self-contained defaults for all container services, so no `.env` file is required for `docker compose up`. For local host development or running tests outside Docker, copy `.env.example`:

```bash
cp .env.example .env
```

| Variable | Purpose | Default / Example | Required |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://surpluss:surpluss_secret@localhost:5432/surpluss` | Yes |
| `PORT` | NestJS API port | `3000` | No (default `3000`) |
| `NODE_ENV` | Runtime environment | `development` / `production` | No |
| `CORS_ORIGIN` | Allowed frontend origin for API CORS | `http://localhost:3001` | No |
| `MAX_RETRY_ATTEMPTS` | Retry budget per cycle | `5` | No (default `5`) |
| `RETRY_INITIAL_DELAY_MS` | Base backoff delay in ms | `2000` (`1000` in shared default) | No |
| `RETRY_MAX_DELAY_MS` | Maximum backoff delay cap in ms | `60000` | No |
| `RETRY_BACKOFF_MULTIPLIER` | Exponential backoff multiplier | `2` | No |
| `WORKER_ID` | Unique identifier per worker process | `worker-1` | No (UUID fallback) |
| `WORKER_POLL_INTERVAL_MS` | Poll interval when queue is empty | `1000` | No |
| `WORKER_LEASE_DURATION_MS` | Initial claim lease duration in ms | `30000` | No |
| `WORKER_HEARTBEAT_INTERVAL_MS` | Lease renewal interval in ms | `10000` | No |
| `WORKER_RECOVERY_INTERVAL_MS` | Expired-lease recovery scan interval in ms | `15000` | No |
| `NEXT_PUBLIC_API_URL` | API base URL used by Next.js dashboard | `http://localhost:3000` | No |

---

## 8. Getting Started

From a clean clone, start the entire stack with a single command:

```bash
git clone <repository-url>
cd <repository-directory>
docker compose up --build
```

What happens automatically on startup:
1. **`postgres`** starts PostgreSQL 16 and waits until `pg_isready` passes.
2. **`migrate`** runs `npx prisma migrate deploy` against `postgres` and exits with code `0`.
3. **`api`** starts the NestJS server on port `3000` and exposes `/health`.
4. **`worker1`** and **`worker2`** start as two independent Node.js worker containers.
5. **`web`** starts the Next.js dashboard on port `3001` once `api` is healthy.

Access points:
- **Operations Dashboard**: `http://localhost:3001`
- **API Base URL**: `http://localhost:3000`
- **Swagger / OpenAPI Docs**: `http://localhost:3000/api/docs`

### Useful Docker Commands

```bash
# Check container status
docker compose ps

# Follow all logs
docker compose logs -f

# Follow specific services
docker compose logs -f api
docker compose logs -f worker1
docker compose logs -f worker2

# Stop containers (preserves database volume)
docker compose down

# Reset database completely (WARNING: deletes all persisted events and orders)
docker compose down -v
```

---

## 9. API Documentation

Interactive Swagger documentation is available at `http://localhost:3000/api/docs`.

### `POST /webhooks`
Ingests a webhook event and persists it before returning. Never processes synchronously.

- **Request Body**:
  ```json
  {
    "eventId": "evt_123",
    "type": "order.created",
    "data": {
      "orderId": "ORD-1001",
      "customerId": "CUS-42",
      "simulate": "ok"
    }
  }
  ```
- **Responses**:
  - `202 Accepted` (new event):
    ```json
    {
      "success": true,
      "message": "Event accepted for processing",
      "data": {
        "id": "5082cb65-6092-4ff1-902e-83dbe18c0778",
        "eventId": "evt_123",
        "status": "PENDING",
        "duplicate": false
      }
    }
    ```
  - `202 Accepted` (duplicate `eventId`): returns `"duplicate": true` and preserves the original payload.
  - `400 Bad Request`: missing/empty/whitespace `eventId` or `type`, malformed JSON, or non-object `data`.

```bash
curl -X POST http://localhost:3000/webhooks \
  -H "Content-Type: application/json" \
  -d '{"eventId":"evt_123","type":"order.created","data":{"orderId":"ORD-1001","simulate":"ok"}}'
```

### `GET /events`
Lists events with server-side pagination, filtering, and sorting.

- **Query Parameters**:
  - `page` (default `1`, `>= 1`)
  - `pageSize` (default `20`, `1..100`)
  - `status` (`PENDING | PROCESSING | COMPLETED | RETRY_PENDING | FAILED`)
  - `type` (exact event type string)
  - `search` (case-insensitive substring match on `eventId` or `type`)
  - `sortBy` (`createdAt | updatedAt | attemptCount | status`, default `createdAt`)
  - `sortOrder` (`asc | desc`, default `desc`)
- **Response (`200 OK`)**: `{ data: WebhookEvent[], total, page, pageSize, totalPages }` (`400` on invalid params).

### `GET /events/stats`
Returns aggregate counts by status (`total`, `completed`, `processing`, `pending`, `failed`, `retryPending`) and distinct `eventTypes`.

### `GET /events/:id`
Returns full event metadata, `processedOrder` (if completed), and ordered `attempts` history (`200 OK` or `404 Not Found`).

### `POST /events/:id/retry`
Manually retries a permanently `FAILED` event. Assigns a fresh retry budget (`maxAttempts = attemptCount + MAX_RETRY_ATTEMPTS`), preserves `attemptCount` and `processing_attempts`, and sets `status = RETRY_PENDING`.

- **Responses**: `200 OK` (`{ success: true, message: "Event queued for retry", data: WebhookEvent }`), `400 Bad Request` (if not `FAILED`), `404 Not Found` (if unknown ID).

### `GET /health`
Returns database connectivity status: `{ status: "ok", database: "connected", timestamp: "..." }`.

---

## 10. Failure Simulation

The worker inspects `payload.data.simulate`:

| Value | Behaviour |
|---|---|
| `ok` | Processes successfully (default when `simulate` is absent or invalid). |
| `fail_then_succeed:N` | Fails attempts `1..N` (by global `attempt_number`), then succeeds on attempt `N + 1`. |
| `always_fail` | Fails on every attempt until `attempt_count >= max_attempts`, then transitions to `FAILED`. |
| `slow:N` | Sleeps for `N` seconds while renewing the lease via heartbeats, then succeeds. |

> **Note on `fail_then_succeed:N` and retry budget**: If `N >= MAX_RETRY_ATTEMPTS` (default `5`), the event exhausts its retry budget before reaching attempt `N + 1` and transitions to `FAILED`. Triggering a manual retry extends `maxAttempts` while keeping `attemptCount` increasing, allowing subsequent attempts to reach `N + 1`.

```bash
# ok
curl -X POST http://localhost:3000/webhooks -H "Content-Type: application/json" \
  -d '{"eventId":"sim-ok-1","type":"order.created","data":{"orderId":"ORD-1","simulate":"ok"}}'

# fail_then_succeed:2
curl -X POST http://localhost:3000/webhooks -H "Content-Type: application/json" \
  -d '{"eventId":"sim-retry-1","type":"order.created","data":{"orderId":"ORD-2","simulate":"fail_then_succeed:2"}}'

# always_fail
curl -X POST http://localhost:3000/webhooks -H "Content-Type: application/json" \
  -d '{"eventId":"sim-fail-1","type":"order.created","data":{"orderId":"ORD-3","simulate":"always_fail"}}'

# slow:35 (exceeds 30s default lease; kept alive by heartbeats)
curl -X POST http://localhost:3000/webhooks -H "Content-Type: application/json" \
  -d '{"eventId":"sim-slow-1","type":"order.created","data":{"orderId":"ORD-4","simulate":"slow:35"}}'
```

---

## 11. Reliability and Correctness Guarantees

### Idempotency
- `webhook_events.event_id` has a `UNIQUE` index. `WebhooksService.ingest()` inserts directly and catches Prisma unique violation `P2002`, returning the existing row with `202 Accepted`.
- Simultaneous deliveries with the same `eventId` race at the database constraint; exactly one `INSERT` succeeds and the original payload is never overwritten.

### Worker Coordination
- `claimNextEvent()` executes inside a PostgreSQL transaction using:
  ```sql
  SELECT id, event_id, type, payload, status, attempt_count, max_attempts
  FROM webhook_events
  WHERE status = 'PENDING' OR (status = 'RETRY_PENDING' AND next_retry_at <= $now)
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
  ```
- Locked rows are skipped by competing workers, preventing two workers from claiming the same event simultaneously.

### Business Action & Transaction Boundaries
- `completeEvent()` executes inside a single PostgreSQL transaction:
  1. `INSERT INTO processed_orders (id, order_id, event_id, processed_at) VALUES (...) ON CONFLICT (event_id) DO NOTHING`
  2. `UPDATE webhook_events SET status = 'COMPLETED', ... WHERE id = $id AND worker_id = $workerId AND status = 'PROCESSING'`
  3. `UPDATE processing_attempts SET finished_at = $now, result = 'SUCCESS' WHERE id = $attemptId`
- If the worker crashes before `COMMIT`, PostgreSQL rolls back the entire transaction—neither the order nor `COMPLETED` status is persisted.
- If the transaction commits, both are durable. `processed_orders.event_id` is `UNIQUE`, so duplicate order records cannot be created.
- **Scope**: This exactly-once guarantee applies to **PostgreSQL database effects**. Arbitrary external side effects (e.g., outbound HTTP requests or emails) are at-least-once if a crash occurs between an external call and transaction commit.

### Retry Mechanism
- Backoff formula: `min(initialDelayMs * backoffMultiplier^(attempt - 1), maxDelayMs)`.
- With Docker Compose defaults (`2000ms`, multiplier `2`, max `60000ms`, max attempts `5`): delays are `2s`, `4s`, `8s`, `16s`, and attempt 5 failure transitions to `FAILED`.

### Crash Recovery
- Active workers renew `lease_expires_at` every `10s` (`WORKER_HEARTBEAT_INTERVAL_MS`).
- Every `15s` (`WORKER_RECOVERY_INTERVAL_MS`), workers scan `WHERE status = 'PROCESSING' AND lease_expires_at < $now FOR UPDATE SKIP LOCKED`.
- Expired leases are cleared and reset to `RETRY_PENDING` (or `FAILED` if `attempt_count >= max_attempts`), and open `processing_attempts` rows are marked `FAILURE`.
- **Stale worker fencing**: Even if a paused worker resumes after lease expiration, `completeEvent()` verifies `worker_id = $this_worker AND status = 'PROCESSING'` inside the completion transaction and aborts if ownership was lost.

---

## 12. Testing

Automated tests run against a live PostgreSQL instance (and running API for HTTP E2E tests).

```bash
# 1. Ensure the stack (or at least postgres + migrate + api) is running
docker compose up -d

# 2. Install dependencies (first time on host)
npm install --workspaces --include-workspace-root
cd tests && npm install && cd ..

# 3. Run all integration & API E2E tests
cd tests
DATABASE_URL="postgresql://surpluss:surpluss_secret@localhost:5432/surpluss" \
API_URL="http://localhost:3000" \
npm run test:verbose
```

### Type Checking & Builds

```bash
# Typecheck each workspace
npm run typecheck --workspace=packages/shared
npm run typecheck --workspace=apps/api
npm run typecheck --workspace=apps/worker
npm run typecheck --workspace=apps/web
cd tests && npx tsc --noEmit

# Production builds
npm run build --workspace=packages/shared
npm run build --workspace=apps/api
npm run build --workspace=apps/worker
npm run build --workspace=apps/web
```

### Covered Test Suites
- **`tests/integration/webhook-processor.test.ts`**: Concurrent duplicate ingestion, payload preservation, `FOR UPDATE SKIP LOCKED` concurrent worker claiming, concurrent completion idempotency, exponential backoff calculation, `RETRY_PENDING` / `FAILED` transitions, expired-lease crash recovery, manual retry attempt continuity, and `processed_orders.event_id` unique constraint.
- **`tests/integration/api-e2e.test.ts`**: `GET /health`, `POST /webhooks` concurrent deduplication & invalid input rejection (`400`), `GET /events` filtering/sorting/pagination, `GET /events/stats`, and race-safe concurrent `POST /events/:id/retry`.

---

## 13. Demonstration Scenarios

Ensure the stack is running (`docker compose up -d`). You can also run `./database/seeds/demo-scenarios.sh` in Bash.

### 1. Duplicate Event Submission
```bash
EVENT_ID="demo-dup-$(date +%s)"
for i in 1 2 3; do
  curl -s -X POST http://localhost:3000/webhooks -H "Content-Type: application/json" \
    -d "{\"eventId\":\"$EVENT_ID\",\"type\":\"order.created\",\"data\":{\"orderId\":\"ORD-DUP\",\"amount\":$i}}" &
done; wait
```
Verify one `processed_orders` row:
```bash
docker exec surpluss-postgres psql -U surpluss -d surpluss \
  -c "SELECT we.event_id, we.status, po.order_id FROM webhook_events we LEFT JOIN processed_orders po ON po.event_id = we.id WHERE we.event_id LIKE 'demo-dup-%';"
```

### 2. Temporary Failure (`fail_then_succeed:2`)
```bash
curl -X POST http://localhost:3000/webhooks -H "Content-Type: application/json" \
  -d "{\"eventId\":\"demo-retry-$(date +%s)\",\"type\":\"order.payment\",\"data\":{\"orderId\":\"ORD-R1\",\"simulate\":\"fail_then_succeed:2\"}}"
```
Observe attempts #1 and #2 fail, and attempt #3 succeed in the dashboard (`http://localhost:3001`).

### 3. Permanent Failure (`always_fail`) & Manual Retry
```bash
curl -X POST http://localhost:3000/webhooks -H "Content-Type: application/json" \
  -d "{\"eventId\":\"demo-fail-$(date +%s)\",\"type\":\"order.payment\",\"data\":{\"orderId\":\"ORD-F1\",\"simulate\":\"always_fail\"}}"
```
After ~30s (5 attempts), the event reaches `FAILED`. Open it in `http://localhost:3001` and click **Manual Retry** (or `POST /events/<uuid>/retry`).

### 4. Parallel Processing
```bash
for i in 1 2 3 4; do
  curl -s -X POST http://localhost:3000/webhooks -H "Content-Type: application/json" \
    -d "{\"eventId\":\"demo-slow-$i-$(date +%s)\",\"type\":\"order.slow\",\"data\":{\"simulate\":\"slow:5\"}}" &
done; wait
docker compose logs --tail=20 worker1 worker2
```

### 5. Worker Crash Recovery (`docker kill`)
```bash
# Submit a slow event and inspect which worker claimed it
curl -X POST http://localhost:3000/webhooks -H "Content-Type: application/json" \
  -d '{"eventId":"demo-crash-1","type":"order.crash","data":{"orderId":"ORD-CRASH","simulate":"slow:10"}}'

# Check active worker in DB or logs, then kill that container (e.g. surpluss-worker1):
docker kill surpluss-worker1

# Wait ~30-45s for lease expiry and recovery by worker2, then inspect:
docker compose logs --tail=20 worker2
# Restart worker1 when done:
docker compose start worker1
```

### 6. Burst of 500 Events
```bash
for i in $(seq 1 500); do
  curl -s -X POST http://localhost:3000/webhooks -H "Content-Type: application/json" \
    -d "{\"eventId\":\"burst-$i-$(date +%s)\",\"type\":\"order.burst\",\"data\":{\"orderId\":\"ORD-B-$i\",\"simulate\":\"ok\"}}" > /dev/null &
  [ $((i % 50)) -eq 0 ] && wait
done; wait
curl -s http://localhost:3000/events/stats
```

---

## 14. Engineering Decisions and Trade-offs

- **PostgreSQL-backed queue vs. Redis/BullMQ**: Using PostgreSQL for both state and job claiming eliminates an extra moving part and allows claiming, business writes (`processed_orders`), and status updates to share ACID transactions. Trade-off: polling (`1s`) adds up to 1s latency when idle and puts light read load on PostgreSQL compared to push-based brokers.
- **`SELECT ... FOR UPDATE SKIP LOCKED`**: Idiomatic PostgreSQL pattern for concurrent workers; competing workers skip locked rows without blocking each other.
- **Database `UNIQUE` constraints as source of truth**: Application-level existence checks cannot prevent races under concurrent requests. Catching `P2002` at ingestion and using `ON CONFLICT (event_id) DO NOTHING` on `processed_orders` enforces correctness at the storage layer.
- **Separate `processing_attempts` table**: Storing each attempt independently keeps an immutable audit trail across automatic retries, crash recoveries, and manual retries without overwriting prior errors or worker IDs.
- **Short leases with heartbeats**: A 30s lease limits crash-recovery lag while 10s heartbeats allow `slow:N` jobs longer than 30s to complete without premature reclamation.
- **Manual retry preserves `attemptCount`**: Extending `maxAttempts = attemptCount + retryBudget` rather than resetting `attemptCount` to `0` keeps attempt numbers globally monotonic.
- **Standalone worker process**: Running `apps/worker` as a lightweight Node.js script decoupled from NestJS HTTP allows independent scaling and container crash testing (`docker kill`) without taking down the API.

---

## 15. Known Limitations

1. **External side effects are not transactionally rolled back**: Exactly-once guarantees cover PostgreSQL (`processed_orders` + `webhook_events`). If an external HTTP/email call is added inside `executeSimulation()` and the worker crashes before DB commit, the external call will run again on retry.
2. **Polling latency**: Workers poll every `1000ms` when idle, and the dashboard polls every `5000ms` rather than using `LISTEN/NOTIFY` or WebSockets/SSE.
3. **Recovery delay depends on lease duration**: After a `docker kill`, an event waits up to `WORKER_LEASE_DURATION_MS + WORKER_RECOVERY_INTERVAL_MS` (~45s by default) before being reclaimed.
4. **No authentication or webhook signature verification**: Excluded per assessment scope; unauthenticated callers can post webhooks or trigger manual retries.
5. **Single-row claim per poll iteration**: Each worker claims 1 event per transaction; under very high throughput, batching or multiple concurrent worker replicas would be needed.
6. **Frontend ESLint dependency**: `eslint` is not installed in `apps/web/package.json` `devDependencies`, so `next build` skips the ESLint step.

---

## 16. What I Would Do Next

1. **Outbound idempotency keys & outbox pattern**: Pass `eventId` as an `Idempotency-Key` to downstream services if external side effects are introduced.
2. **PostgreSQL `LISTEN/NOTIFY` wakeups**: Wake idle workers immediately on `INSERT` instead of waiting up to `1s` per poll, reducing latency and idle DB queries.
3. **Prometheus metrics & structured JSON logging**: Export queue depth, processing latency histograms, retry counts, and lease-recovery counters for alerting.
4. **Webhook HMAC signature verification & API auth**: Validate sender signatures at `POST /webhooks` and protect operator endpoints.
5. **Table partitioning / archival**: Partition `webhook_events` and `processing_attempts` by `created_at` to keep `FOR UPDATE SKIP LOCKED` index scans fast at multi-million-row scale.
