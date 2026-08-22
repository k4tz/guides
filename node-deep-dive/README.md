# Node.js Deep Dive

A production-oriented deep dive into Node.js runtime behavior, asynchronous execution, streams, concurrency, HTTP internals, performance, scaling, reliability, security, and observability.

The guide uses **plain JavaScript** and targets modern Node.js 22+.

## Guide structure

### [basic.md](basic.md)

The core mental model and the patterns that cover most day-to-day Node.js backend work:

- Node runtime and asynchronous I/O
- call stack and event loop phases
- microtasks, Promises, `queueMicrotask()`, `process.nextTick()`
- timers, I/O callbacks, `setImmediate()`
- streams, `pipe()`, backpressure, `highWaterMark`
- concurrency vs parallelism
- worker threads and shared memory
- V8 memory fundamentals
- performance and event-loop delay
- HTTP internals, keep-alive, connection pooling
- `fetch()` / Undici
- stateless services and horizontal scaling
- cluster, PM2, containers
- graceful shutdown and health checks

### [advanced.md](advanced.md)

Production concerns and trade-offs:

- timeouts, retries, backoff, idempotency
- operational vs programmer errors
- `unhandledRejection` / `uncaughtException`
- circuit breakers and graceful degradation
- streaming and backpressure decisions
- N+1 and performance diagnosis
- memory leaks, heap snapshots, CPU profiling
- workers vs child processes vs queues vs microservices
- HTTP connection management
- horizontal scaling and zero-downtime deployment
- CommonJS/ESM/module resolution/npm
- prototype pollution, SSRF, request smuggling, ReDoS
- dependency and secrets management
- authentication, authorization, JWT, rate limiting, validation
- `AsyncLocalStorage`, correlation IDs, tracing, OpenTelemetry
- high-performance API measurement
- production checklist
- interview honesty

### [hands-on.md](hands-on.md)

A step-by-step exercise around a realistic **order/payment backend**, including:

- HTTP API
- PostgreSQL
- Redis
- cache-aside behavior
- idempotency
- payment timeouts
- streams and backpressure
- worker threads
- child processes
- event-loop measurement
- health/readiness checks
- graceful shutdown
- deliberately broken scenarios

### `hands-on-project/`

The runnable project used by the walkthrough.

## Verification note

The intended project environment uses **PostgreSQL and Redis through Docker Compose**. The verification environment used while creating this guide had Node.js available but did not have Docker or working external package-network access. The project therefore includes a dependency-free memory mode that was used to execute the API and tests, while the PostgreSQL/Redis Compose configuration and adapters are included for the intended environment.

The verification run used Node.js `v22.16.0`.

## Suggested learning order

```text
basic.md
   ↓
hands-on.md alongside the project
   ↓
advanced.md
   ↓
repeat the hands-on failure experiments
   ↓
apply the checklist to one of your own APIs
```

The best outcome is not memorizing Node.js trivia. It is being able to trace one request from HTTP through application code, database/cache/external calls, and back to the response—and explain where concurrency, latency, memory, and failure behavior come from.
