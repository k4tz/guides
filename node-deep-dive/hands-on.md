# Node.js Deep Dive — Hands-on

## Scenario

You are building the backend for a small **order and payment platform**.

A customer creates an order, the service validates it, writes it to PostgreSQL, caches the result in Redis, and calls an external payment provider. The payment provider later sends a webhook. The API also exposes a streaming report and operational health/metrics endpoints.

The exercise deliberately stays small enough to understand end-to-end while containing the same boundaries found in production systems:

```text
HTTP
 ↓
request context / validation
 ↓
service logic
 ├── PostgreSQL
 ├── Redis
 └── payment HTTP service
 ↓
response

separate concerns
 ├── worker thread for CPU-heavy work
 ├── background job queue
 ├── streaming report
 └── graceful shutdown
```

## Prerequisites

- Node.js 22+
- npm
- Docker + Docker Compose for the intended PostgreSQL/Redis setup

The verification environment used for this guide did **not** provide Docker or external package-network access. Therefore the project includes a dependency-free **memory mode** used to execute and test the runnable examples here. The normal project configuration still includes PostgreSQL/Redis Docker Compose and adapters for the real environment.

---

# 1. Project setup

From the project directory:

```bash
npm install
```

For the real environment:

```bash
npm run infra:up
```

Then:

```bash
npm run dev
```

For the verification fallback:

```bash
npm run dev:memory
```

Expected output includes:

```text
Order service listening on http://localhost:3000
mode=memory
```

---

# 2. Understand the project layout

```text
hands-on-project/
├── docker-compose.yml
├── package.json
├── .env.example
├── sql/
│   └── 001_init.sql
├── src/
│   ├── config.js
│   ├── server.js
│   ├── app.js
│   ├── context.js
│   ├── errors.js
│   ├── metrics.js
│   ├── repositories/
│   │   ├── memory-order-repository.js
│   │   └── postgres-order-repository.js
│   ├── cache/
│   │   ├── memory-cache.js
│   │   └── redis-cache.js
│   ├── services/
│   │   ├── order-service.js
│   │   └── payment-client.js
│   ├── jobs/
│   │   └── queue.js
│   ├── workers/
│   │   └── cpu-worker.js
│   └── streams/
│       └── report.js
├── scripts/
│   ├── event-loop-demo.mjs
│   ├── child-process-demo.mjs
│   └── benchmark.mjs
└── test/
    └── app.test.js
```

The project deliberately keeps framework code small. The point is to expose Node's runtime behavior instead of hiding everything behind a framework.

---

# 3. Start the API

Memory mode:

```bash
npm run dev:memory
```

Health check:

```bash
curl http://localhost:3000/health/live
```

Expected:

```json
{"status":"ok"}
```

Readiness:

```bash
curl http://localhost:3000/health/ready
```

Expected in memory mode:

```json
{"status":"ready","database":"memory","cache":"memory"}
```

---

# 4. Create an order

Run:

```bash
curl -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -H 'idempotency-key: demo-001' \
  -d '{
    "customerId":"customer-1",
    "currency":"USD",
    "items":[
      {"sku":"CONF-001","name":"Conference ticket","quantity":2,"unitPrice":5000},
      {"sku":"SHIRT-001","name":"T-shirt","quantity":1,"unitPrice":2500}
    ]
  }'
```

The service calculates the total, writes the order, and schedules an asynchronous notification job.

Expected response shape:

```json
{
  "id":"...",
  "customerId":"customer-1",
  "currency":"USD",
  "totalCents":12500,
  "status":"PENDING"
}
```

The exact UUID will differ.

---

# 5. Test idempotency

Repeat the same command with the same idempotency key:

```bash
curl -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -H 'idempotency-key: demo-001' \
  -d '{
    "customerId":"customer-1",
    "currency":"USD",
    "items":[{"sku":"CONF-001","name":"Conference ticket","quantity":2,"unitPrice":5000}]
  }'
```

The service returns the original order rather than creating a second one.

This is the first important production lesson: **retries are only safe when the operation has an idempotency strategy.**

---

# 6. Fetch the order and observe caching

Replace `ORDER_ID` with the returned ID:

```bash
curl -i http://localhost:3000/orders/ORDER_ID
```

Run it twice. The second request can be served from the cache depending on the configured cache mode.

The intended real deployment has:

```text
GET /orders/:id
       ↓
Redis
  hit ─────→ response
  miss
       ↓
PostgreSQL
       ↓
Redis SETEX
       ↓
response
```

This is the classic cache-aside pattern.

---

# 7. Inspect metrics

```bash
curl http://localhost:3000/metrics
```

The response includes process-level measurements such as:

- process uptime,
- RSS,
- heap usage,
- event-loop delay statistics.

The purpose is not to build a complete monitoring platform. It is to make runtime behavior visible.

---

# 8. Run the event-loop experiment

In a separate terminal:

```bash
npm run event-loop
```

You will see synchronous work, Promise/microtask work, `nextTick`, timers, and `setImmediate` scheduled together. Because the demo is an ESM file, its `nextTick` ordering is intentionally a useful demonstration of the ESM/CommonJS distinction.

Then run the API and open:

```text
GET /debug/block?ms=1000
```

While the endpoint is running, make another request:

```bash
curl http://localhost:3000/health/live
```

The health request is delayed because the JavaScript thread is busy.

This demonstrates the most important Node performance rule:

> **Asynchronous I/O does not make CPU-bound JavaScript non-blocking.**

---

# 9. Move CPU-heavy work to a worker

Run:

```bash
curl 'http://localhost:3000/debug/cpu?n=50000000'
```

The endpoint uses a worker thread rather than performing the calculation directly on the main thread.

Compare it with:

```bash
curl 'http://localhost:3000/debug/cpu-blocking?n=50000000'
```

The blocking endpoint intentionally performs the CPU-heavy calculation on the main thread.

Watch the difference in event-loop delay through `/metrics`.

The lesson is not “workers are always better.” A worker has memory and scheduling overhead. For durable background work, a queue is often a better boundary.

---

# 10. Run the child-process demonstration

```bash
npm run child-process
```

The demo starts another OS process and communicates with it.

Compare the mental model:

```text
worker thread
  └── another JS execution thread in the same process

child process
  └── another OS process with stronger isolation
```

Use child processes when you need process isolation or need to invoke another program.

---

# 11. Streaming report

Generate a large CSV-like report without constructing the entire response as one giant string:

```bash
curl http://localhost:3000/reports/orders.csv -o orders.csv
```

The implementation uses a Readable/Transform pipeline.

Now deliberately change the implementation to build the entire report with an array and `join()`.

For a small dataset, you may see little difference. Increase the generated record count and observe memory usage.

This is the central stream lesson:

```text
streaming
→ bounded buffering
→ lower peak memory

buffer everything
→ simple code
→ potentially unbounded memory
```

---

# 12. Backpressure experiment

Open `src/streams/report.js` and lower the writable `highWaterMark` in the experimental helper.

Then run:

```bash
npm run benchmark
```

Observe that the producer must respect the destination's ability to consume data.

When a writable stream's `write()` returns `false`, pause until `drain` or use `pipeline()`/`pipe()` so the stream machinery coordinates flow.

---

# 13. Payment timeout and failure behavior

Start the local payment stub in another terminal:

```bash
npm run payment-stub
```

The project contains a local payment stub endpoint. The payment client uses a timeout.

Trigger a slow payment:

```bash
curl -X POST http://localhost:3000/debug/payment?delay=3000
```

Then compare with the configured shorter client timeout.

The important observation is that a dependency timeout prevents one request from waiting indefinitely.

Next, modify the payment client to retry every error immediately.

Run several concurrent requests.

Observe the failure mode:

```text
payment outage
     ↓
requests retry immediately
     ↓
more payment traffic
     ↓
more failures
     ↓
more retries
```

Restore bounded exponential backoff.

---

# 14. Break something on purpose #1 — block the event loop

In `src/app.js`, temporarily change the normal handler to run a large synchronous loop.

Then send two requests concurrently:

```bash
curl 'http://localhost:3000/debug/block?ms=3000' &
curl 'http://localhost:3000/health/live'
wait
```

Expected behavior:

```text
blocking request starts
        ↓
health request waits
        ↓
blocking request finishes
        ↓
health request runs
```

Fix: remove synchronous CPU work from the request path or move genuinely CPU-bound work to a worker/background system.

---

# 15. Break something on purpose #2 — remove cache fallback

In the Redis adapter, temporarily make cache access throw instead of returning a miss.

The intended production behavior is often:

```text
Redis unavailable
      ↓
cache read fails
      ↓
log/metric the failure
      ↓
query PostgreSQL
      ↓
serve request
```

But this is a **trade-off**, not a universal rule. If Redis contains authoritative state rather than a disposable cache, falling back to another source may be incorrect.

Restore the cache-aside fallback.

---

# 16. Break something on purpose #3 — remove idempotency

Temporarily disable the idempotency-key lookup.

Run the same POST twice:

```bash
curl -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -H 'idempotency-key: duplicate-test' \
  -d '{"customerId":"c1","currency":"USD","items":[{"sku":"A","name":"A","quantity":1,"unitPrice":1000}]}'
```

Run it again with the exact same body and key.

You should now see two orders.

Restore idempotency.

For a financial operation, this is not merely a correctness nicety. It can become a monetary correctness issue.

---

# 17. Graceful shutdown experiment

Start the server:

```bash
npm run dev:memory
```

In another terminal, send SIGTERM to the process.

The shutdown handler should:

```text
stop accepting new requests
        ↓
finish current work
        ↓
close DB/cache resources
        ↓
exit
```

If you are running the Docker environment, this is the same lifecycle an orchestrator uses during deployment or scale-down.

---

# 18. Real PostgreSQL + Redis mode

When Docker is available:

```bash
npm run infra:up
```

The Compose file starts:

- PostgreSQL
- Redis

The application can then be started with:

```bash
npm run dev
```

The real adapters use:

```text
Node
 ├── pg → PostgreSQL
 └── redis → Redis
```

The SQL migration creates the `orders` table and indexes.

Verify:

```bash
npm run infra:logs
```

Stop infrastructure with:

```bash
npm run infra:down
```

---

# 19. What you actually practiced

| Guide concept | Hands-on evidence |
|---|---|
| Event loop | blocking endpoint + event-loop metrics |
| Microtasks | event-loop demo |
| Worker threads | CPU endpoint |
| Child processes | child-process demo |
| Streams | CSV report |
| Backpressure | stream benchmark |
| Redis | cache-aside order lookup |
| PostgreSQL | order repository + migration |
| HTTP | API + payment client |
| Timeouts | payment client |
| Idempotency | order creation |
| Graceful shutdown | SIGTERM experiment |
| Health checks | liveness/readiness |
| Memory/performance | `/metrics` + experiments |
| Failure handling | intentional Redis/payment failures |

The important transfer is to take the same questions into your own services:

> Where does this request wait? What can block it? What can fail? What can be retried? What state must survive a process restart? What happens when traffic doubles? How will I measure the answer?
