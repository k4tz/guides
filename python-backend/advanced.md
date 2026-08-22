# Python Backend — Advanced

## 1. Reliability starts with explicit boundaries

A production API is a chain of failure domains:

```text
HTTP client
  ↓
FastAPI process
  ↓
application logic
  ↓
PostgreSQL / Redis
  ↓
external services
```

Each boundary needs an explicit answer to:

1. What can fail?
2. How long can we wait?
3. Can we retry?
4. Is the operation idempotent?
5. What state is safe to expose after failure?

A reliable system is not one where failures never happen. It is one where failures have bounded, observable behavior.

## 2. Async reliability

Async code introduces failure modes that synchronous-looking code can hide.

### Cancellation

A request may disappear while an awaited operation is running. Use cancellation-aware code and avoid swallowing `CancelledError` casually.

### Timeouts

Every network boundary should have a timeout. A missing timeout can turn a dependency outage into a thread/task/socket pile-up.

```python
import asyncio


result = await asyncio.wait_for(do_external_work(), timeout=3.0)
```

Prefer modern timeout APIs such as `asyncio.timeout()` where appropriate.

### Concurrency limits

Do not turn one incoming request into unlimited downstream work.

```python
import asyncio

limit = asyncio.Semaphore(20)


async def bounded_call(item):
    async with limit:
        return await call_dependency(item)
```

The limit is a capacity decision, not a magic number. Measure the downstream service and tune it.

## 3. Database transactions

Transactions define what must succeed or fail together.

```text
BEGIN
  create order
  reserve inventory
  record payment intent
COMMIT
```

If inventory reservation fails, the database should not contain a partially committed order unless that partial state is intentionally modeled.

### Isolation is a trade-off

Stronger isolation can reduce anomalies but may increase contention and retries. High-throughput workloads sometimes deliberately choose weaker isolation with application-level safeguards.

### Connection pools

A pool prevents every request from opening a new TCP connection, but the pool is finite. Too few connections cause queueing; too many can overwhelm PostgreSQL. Size it from measured workload and database capacity, not a generic internet recommendation.

## 4. SQLAlchemy production norms

### Avoid N+1

One query for orders followed by one query per order can become:

```text
1 + N queries
```

Use joins, eager loading, batching or explicit data-fetch plans.

### Keep session scope predictable

A common API boundary is one session per request, with transaction ownership made explicit. Do not store a session in a global variable.

### Know when to leave the ORM

SQLAlchemy Core or carefully written SQL is appropriate when the query is complex, performance-critical, bulk-oriented or easier to reason about directly. “ORM everywhere” is not a principle.

## 5. Migrations and zero-downtime schema changes

A dangerous deployment is:

```text
deploy code that expects new column
        ↓
then add new column
```

If old application instances are still running, they may not understand the new schema.

Prefer an expand/contract approach:

```text
1. Expand schema compatibly
2. Deploy code that can use old + new schema
3. Backfill data
4. Switch reads/writes
5. Remove old schema later
```

A destructive migration should be treated as a multi-deployment change, not a single SQL file.

## 6. Redis: cache, not source of truth

A common model:

```text
request
  ↓
Redis hit? ── yes → return
  │
  no
  ↓
PostgreSQL
  ↓
write cache
```

Trade-offs:

- caching reduces database load and latency
- stale data becomes possible
- invalidation becomes a correctness problem
- Redis introduces another failure domain

For data where stale values are dangerous, prefer short TTLs, explicit invalidation, or no cache.

## 7. External APIs and retries

A retry is only safe when the operation can tolerate duplication.

For example:

```text
POST /payments
```

should not blindly retry after a timeout if the provider might have accepted the original request.

Use an idempotency key where the provider supports it and persist enough state to reconcile uncertain outcomes.

A reasonable retry strategy usually includes:

- bounded attempts
- exponential backoff
- jitter
- retryable-status classification
- total time budget
- observability

Do not retry validation errors, authentication failures or deterministic business errors.

## 8. Circuit breakers and graceful degradation

If an external dependency is repeatedly failing, continuously sending it requests can make the incident worse.

A circuit breaker moves through states such as:

```text
CLOSED → failures → OPEN → cooldown → HALF-OPEN → CLOSED
```

Use it when repeated dependency calls have meaningful cost and an alternative behavior exists.

Graceful degradation might mean:

- cached catalog data instead of live data
- accepting an order and processing payment asynchronously
- returning a partial response
- disabling a non-critical recommendation feature

Degradation is useful only when the degraded behavior is explicitly designed and safe.

## 9. Error taxonomy

Separate errors by meaning.

### Programmer errors

Examples:

- impossible state
- broken invariant
- unexpected `AttributeError`
- programming bug

These should be fixed, not retried.

### Operational errors

Examples:

- database unavailable
- payment provider timeout
- Redis unavailable
- connection refused

These may require retries, fallback or a controlled 5xx response.

Do not expose stack traces or internal exception details to API clients.

## 10. FastAPI application architecture

A useful default is:

```text
src/app/
├── api/
│   ├── routes/
│   └── dependencies.py
├── domain/
├── services/
├── repositories/
├── db/
├── integrations/
├── config.py
└── main.py
```

This is a starting point, not a religion.

### Keep routers thin

Routers should primarily translate HTTP into application calls:

```text
HTTP concerns
    ↓
application/service concerns
    ↓
data/integration concerns
```

If a 200-line router contains payment rules, SQL, retries and business invariants, the boundary has failed.

### Don't over-abstract

A repository interface around every single query may add ceremony without adding flexibility. Introduce boundaries when they protect a real architectural seam.

## 11. Stateless services and scaling

A stateless API process can be replicated:

```text
                    ┌→ API worker
Load balancer ──────┼→ API worker
                    └→ API worker
                         ↓
                   shared state
                 PostgreSQL / Redis
```

Avoid process-local state that must survive a restart or be shared across workers.

For example, an in-memory Python dictionary is not a distributed cache.

## 12. Workers and process models

FastAPI applications are typically served by an ASGI server such as Uvicorn. Multiple worker processes provide process-level parallelism.

The important distinction is:

```text
async concurrency inside a process
        vs
parallelism across processes
```

More workers are not automatically faster. Each process consumes memory and creates its own connection pools. A database that supports 50 useful concurrent connections does not become faster because the API opens 500.

## 13. Background work

Do not make the HTTP request wait for work that does not need to be completed before responding.

Examples:

- sending email
- generating reports
- image processing
- webhook fanout
- reconciliation

For lightweight work, an in-process background task can be enough. For durable work, use a real queue/worker system such as Celery, RabbitMQ, Redis Streams or a managed queue.

The trade-off is complexity: durable background work introduces delivery semantics, retries, visibility, idempotency and monitoring.

## 14. Health and readiness

Separate:

```text
liveness = should this process be restarted?
readiness = can this process receive traffic?
```

A process can be alive while PostgreSQL is unavailable. Marking that process “not ready” may be safer than repeatedly accepting traffic that cannot succeed.

Do not make liveness checks depend on every external dependency; a temporary payment provider outage should not necessarily cause Kubernetes to restart every API process.

## 15. Configuration and secrets

Configuration should be validated at startup.

Good:

```text
DATABASE_URL → validated Settings object → application
```

Bad:

```python
os.getenv("DATABASE_URL")  # scattered throughout the codebase
```

Secrets belong in a secret manager or deployment secret store. `.env` is a local-development convenience, not a production secret-management strategy.

## 16. Testing strategy

Use layers:

```text
many fast unit tests
        ↓
fewer API/integration tests
        ↓
fewer full-system tests
```

### Unit tests

Test business rules without real infrastructure where practical.

### Integration tests

Use real PostgreSQL/Redis when the behavior depends on their semantics.

### API tests

Verify validation, authentication, status codes and response contracts.

### Don't mock what you don't understand

If your test mocks SQLAlchemy's internals so heavily that it no longer exercises the actual query, it may give false confidence.

## 17. Type checking as design feedback

Types are useful beyond autocomplete.

```python
from decimal import Decimal


def calculate_total(subtotal: Decimal, tax: Decimal) -> Decimal:
    return subtotal + tax
```

Precise types expose unclear boundaries. If a function accepts `str | int | None | dict`, ask whether the design itself is underspecified.

Use mypy pragmatically. Gradual typing is fine; suppressing every error defeats the purpose.

## 18. Ruff, formatting and pre-commit

A project should make the correct workflow easy:

```bash
uv run ruff format --check .
uv run ruff check .
uv run mypy src
uv run pytest
```

Pre-commit can run cheap checks before a commit. CI must still run them because local hooks can be skipped.

## 19. Security norms

### Input validation

Validate at the boundary. Never trust IDs, filters, filenames, headers or third-party payloads.

### SQL injection

Use parameterized SQL / SQLAlchemy expressions. Never concatenate user input into SQL.

### SSRF

If users can influence a URL your server fetches, validate allowed schemes, hosts and network destinations. Cloud metadata endpoints are particularly sensitive.

### JWT

A JWT is a signed token, not automatically a secure authorization model. Consider:

- signing algorithm validation
- issuer/audience validation
- expiration
- key rotation
- token revocation strategy
- least-privilege claims

### Dependencies

Pin/lock dependencies, review upgrades, and scan for known vulnerabilities. A lockfile gives reproducibility; it does not make a vulnerable package safe.

### CORS and headers

CORS is not authentication. Configure allowed origins deliberately. Add security headers at the HTTP boundary where appropriate.

## 20. Observability

Logs answer “what happened?”

Metrics answer “how often/how much?”

Traces answer “where did the time go?”

For production APIs, useful signals include:

- request count
- latency percentiles
- error rate
- DB query latency
- pool saturation
- Redis hit/miss ratio
- external dependency latency
- queue depth
- CPU/memory
- event-loop or worker saturation

### Request correlation

A request ID should survive the path:

```text
HTTP request
 ↓
FastAPI
 ↓
service
 ↓
DB/external call
 ↓
log/trace
```

`contextvars` or `contextvars`-based libraries can carry request-scoped information. For more advanced propagation, `AsyncLocalStorage` is the Node equivalent conceptually; in Python, use `contextvars` and OpenTelemetry context propagation.

## 21. Profiling slow APIs

Never optimize from intuition alone.

Measure the path:

```text
HTTP
 ↓
middleware
 ↓
validation
 ↓
business logic
 ↓
DB / Redis
 ↓
external API
 ↓
serialization
 ↓
response
```

Track:

- total request latency
- database latency
- number of queries
- Redis latency/hit rate
- external API latency
- serialization time
- CPU
- memory
- connection-pool wait time

For CPU profiling, use tools such as `cProfile`, `py-spy` or platform profilers. For memory problems, use `tracemalloc` and heap/object inspection techniques.

The first optimization question should be: **where is the time actually going?**

## 22. Docker and production

A production image should:

- install only required runtime dependencies
- run as a non-root user where practical
- use a pinned/locked dependency set
- define a predictable entrypoint
- expose health endpoints
- handle SIGTERM gracefully
- write logs to stdout/stderr
- avoid storing durable application state in the container filesystem

Docker Compose is excellent for local PostgreSQL/Redis and integration testing. Production orchestration may be ECS, Kubernetes, a VM or a managed platform; the underlying application principles remain the same.

## 23. CI/CD workflow

A useful minimum pipeline is:

```text
checkout
 ↓
install locked dependencies
 ↓
ruff format --check
 ↓
ruff check
 ↓
mypy
 ↓
pytest
 ↓
build image
 ↓
security/dependency checks
 ↓
publish/deploy
```

Deploy only artifacts that passed the same checks used to validate the commit.

## 24. Dependency and versioning norms

- Commit `pyproject.toml` and `uv.lock`.
- Keep `.python-version` aligned with supported runtime policy.
- Add direct dependencies explicitly rather than relying on transitive packages.
- Upgrade dependencies deliberately.
- Read migration notes for major upgrades.
- Avoid unnecessary dependency churn.
- Prefer standard-library functionality when it is sufficient.

`uv.lock` is intended to capture exact resolved dependencies and is designed to be checked into version control for reproducible environments. citeturn0search2turn0search12

## 25. Interview honesty

Be precise about ownership.

Good:

> “I owned the FastAPI endpoints and database optimization; the deployment team owned the production Kubernetes rollout.”

Not:

> “I architected the entire production platform.”

Likewise, distinguish:

- used SQLAlchemy vs designed the data-access layer
- wrote unit tests vs owned the test strategy
- used Docker vs designed the deployment architecture
- added an AWS resource vs owned AWS infrastructure

Strong engineers can explain their exact boundary without inflating it.

## 26. Production checklist

### Project

- [ ] Python version is explicitly pinned
- [ ] `pyproject.toml` contains direct dependencies
- [ ] `uv.lock` is committed
- [ ] `.venv` is ignored by Git
- [ ] production and development dependencies are distinguishable

### API

- [ ] Request payloads are validated
- [ ] Response contracts are deliberate
- [ ] Authentication and authorization are explicit
- [ ] Pagination/filtering limits unbounded queries
- [ ] Rate limiting exists where abuse is plausible
- [ ] External calls have timeouts
- [ ] Idempotency exists for retryable write operations where required

### Database

- [ ] Transactions have explicit boundaries
- [ ] Connection pool is sized intentionally
- [ ] N+1 queries are avoided
- [ ] Important queries have appropriate indexes
- [ ] Migrations are reviewed and tested
- [ ] Destructive changes use a safe rollout strategy

### Async/background work

- [ ] Blocking work is not executed in async request paths
- [ ] Background jobs have retry/failure semantics
- [ ] Jobs are idempotent where necessary
- [ ] Queue depth/failures are observable

### Security

- [ ] Secrets are outside source control
- [ ] Input is validated
- [ ] SQL is parameterized
- [ ] SSRF-sensitive URL fetches are constrained
- [ ] JWT validation includes issuer/audience/expiry as appropriate
- [ ] Dependencies are scanned and updated deliberately
- [ ] CORS and security headers are configured deliberately

### Operations

- [ ] Liveness and readiness semantics are separated
- [ ] Graceful shutdown is implemented
- [ ] Logs are structured/useful
- [ ] Request correlation exists
- [ ] Metrics cover latency/errors/dependencies
- [ ] Tracing exists where distributed debugging requires it
- [ ] CPU/memory profiling is possible
- [ ] CI runs tests, linting and type checks

### Deployment

- [ ] Runtime image contains only required dependencies
- [ ] Container does not depend on local durable state
- [ ] Health checks are configured
- [ ] Rollback procedure exists
- [ ] Schema rollout is compatible with application rollout

## 27. What “production-level Python” actually means

It is not knowing 50 Python libraries.

It means being able to reason about:

```text
code
 ↓
dependencies
 ↓
process/runtime
 ↓
HTTP
 ↓
async/concurrency
 ↓
database
 ↓
external systems
 ↓
failure
 ↓
observability
 ↓
deployment
```

The strongest Python backend engineers understand the boundaries between these layers and can explain the trade-offs when one of them fails.
