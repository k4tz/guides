# Python Backend — Hands-on

## Scenario

You are building the backend for a small order/payment service. A customer can create an order, retrieve it, and request payment. The API stores durable state in PostgreSQL, uses Redis for idempotency/cache/rate limiting, and calls an external payment service.

The exercise deliberately grows the service from a small FastAPI application into a production-shaped backend.

## Prerequisites

- Python 3.13
- uv
- Docker + Docker Compose
- Git

If Docker is unavailable, the project includes a `TEST_DATABASE_URL` path using SQLite for automated tests. The production-shaped local workflow remains PostgreSQL + Redis through Compose.

## 1. Inspect the project

```bash
cd hands-on-project
find . -maxdepth 3 -type f | sort
```

You should see `pyproject.toml`, `uv.lock`, `src/`, `tests/`, `alembic/`, `Dockerfile`, and `docker-compose.yml`.

## 2. Install dependencies

```bash
uv sync
```

Expected result: uv creates/synchronizes `.venv` from the project metadata and lockfile.

Then verify:

```bash
uv run python --version
uv run pytest
```

Expected result: all baseline tests pass.

## 3. Start infrastructure

```bash
docker compose up -d postgres redis
```

Check:

```bash
docker compose ps
```

Expected result: PostgreSQL and Redis report healthy/running.

## 4. Configure the application

Copy the example environment:

```bash
cp .env.example .env
```

The default values target the Compose services:

```text
DATABASE_URL=postgresql+asyncpg://orders:orders@localhost:5432/orders
REDIS_URL=redis://localhost:6379/0
PAYMENT_BASE_URL=http://localhost:9000
```

## 5. Run migrations

```bash
uv run alembic upgrade head
```

Expected result:

```text
Running upgrade ... -> ..., create users/orders
```

Verify the database:

```bash
docker compose exec postgres psql -U orders -d orders -c '\dt'
```

You should see the application tables.

## 6. Run the API

```bash
uv run uvicorn app.main:app --reload
```

Open another terminal and run:

```bash
curl http://localhost:8000/health/live
curl http://localhost:8000/health/ready
```

Expected responses contain `{"status":"ok"}`.

FastAPI also exposes OpenAPI documentation at `/docs`.

## 7. Create an order

```bash
curl -X POST http://localhost:8000/orders \
  -H 'Content-Type: application/json' \
  -d '{"customer_id":1,"amount":"49.99","currency":"USD"}'
```

Expected result: `201 Created` with an order ID and `pending` status.

Retrieve it:

```bash
curl http://localhost:8000/orders/1
```

## 8. Observe the database boundary

Read the implementation in:

```text
src/app/api/routes/orders.py
src/app/services/orders.py
src/app/repositories/orders.py
src/app/db/session.py
```

Trace:

```text
HTTP request
 → FastAPI validation
 → route
 → service
 → repository
 → SQLAlchemy session
 → PostgreSQL
```

The point is to identify where each responsibility lives, not to memorize the directory names.

## 9. Exercise: add a query without creating N+1

Add an endpoint that returns a customer's orders with a summary field.

First write the naive implementation and inspect the SQL. Then refactor it into a bounded query.

Run the relevant test:

```bash
uv run pytest tests/test_orders.py -q
```

Success means the response contract remains unchanged while the query count falls.

## 10. Exercise: idempotent payment creation

The payment endpoint accepts:

```text
POST /orders/{order_id}/payment
Idempotency-Key: <unique-key>
```

Send the same request twice:

```bash
curl -X POST http://localhost:8000/orders/1/payment \
  -H 'Idempotency-Key: demo-123'
```

Repeat it with the same key.

Expected behavior: the second call returns the same logical payment result instead of creating a second charge.

The implementation uses Redis to store the idempotency result for a bounded period. In a real payment system, the payment provider's own idempotency/reconciliation mechanism must also be considered.

## 11. Exercise: rate limiting

The project exposes a simple fixed-window rate limiter backed by Redis.

Send requests repeatedly:

```bash
for i in $(seq 1 15); do curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/orders/1; done
```

Expected behavior: requests eventually receive `429` once the configured threshold is exceeded.

The important lesson is that rate limiting is shared state when the API is horizontally scaled. A process-local counter is not enough.

## 12. Exercise: external payment timeout

The included payment stub can simulate latency.

Configure a deliberately low timeout in the application and request payment. The API should return a controlled error rather than hanging indefinitely.

Inspect:

```text
src/app/integrations/payments.py
src/app/services/payments.py
```

Notice that the external HTTP client has an explicit timeout and the service translates dependency failure into an API-level response.

## 13. Exercise: background reconciliation

The project includes a small reconciliation command:

```bash
uv run python scripts/reconcile.py
```

It finds payments left in an uncertain state and demonstrates why background work should have explicit ownership, retry behavior and idempotency.

For a production system, this could become a durable queue worker rather than an ad-hoc process.

## 14. Exercise: test the application

Run everything:

```bash
uv run pytest
```

Then run focused checks:

```bash
uv run pytest tests/test_orders.py -q
uv run pytest tests/test_payments.py -q
```

Tests are intentionally layered: API behavior is tested through FastAPI's test client, while some service behavior is tested without requiring every external dependency.

## 15. Exercise: quality gate

Run:

```bash
uv run ruff format --check .
uv run ruff check .
uv run mypy src
uv run pytest
```

Treat these as one quality gate, not four unrelated commands.

## 16. Break it on purpose #1 — N+1

Change the customer-order summary implementation to load related data one row at a time.

Run the endpoint with a customer that has multiple orders and inspect SQL logging.

Expected observation:

```text
1 query for orders
+ N queries for related data
```

Revert the change and use a bounded query/eager loading strategy.

## 17. Break it on purpose #2 — blocking the async path

Temporarily add:

```python
import time

time.sleep(2)
```

to an async endpoint.

Start the server and make two requests concurrently.

Expected observation: the second request is delayed by the blocking call.

Replace it with an async-friendly operation where appropriate, or move CPU/blocking work to a worker/process boundary.

The lesson: `async def` does not magically make blocking code asynchronous.

## 18. Break it on purpose #3 — remove idempotency

Temporarily ignore `Idempotency-Key` when creating a payment.

Send the same payment request twice.

Expected observation: two payment records/results can be created.

Restore the idempotency check.

The lesson: retries and duplicate delivery are normal distributed-systems conditions; correctness needs an explicit strategy.

## 19. Break it on purpose #4 — kill Redis

Stop Redis:

```bash
docker compose stop redis
```

Call the idempotent payment endpoint.

Observe whether the API fails closed, degrades, or returns an explicit dependency error. The correct behavior depends on whether Redis is being used as a correctness mechanism or only as an optimization.

Restart it:

```bash
docker compose start redis
```

## 20. Break it on purpose #5 — migration safety

Create a migration that removes a column still referenced by the running application.

Do not apply it to a real environment. Instead, run it against a disposable local database and observe the failure.

Then design an expand/contract migration instead:

```text
add new field
 → deploy compatible code
 → backfill
 → switch reads/writes
 → remove old field later
```

## 21. Measure one request end-to-end

Choose:

```text
GET /orders/{id}
```

Trace:

```text
HTTP
 ↓
FastAPI
 ↓
validation/dependency injection
 ↓
service
 ↓
Redis
 ↓
PostgreSQL
 ↓
serialization
 ↓
HTTP
```

Measure or inspect:

- total latency
- database query count
- database latency
- Redis hit/miss behavior
- response serialization
- CPU
- memory
- event-loop responsiveness

Then deliberately add latency to one dependency and see how the total request changes.

## 22. Build the production container

```bash
docker compose build api
```

Run it with the local infrastructure:

```bash
docker compose up -d
```

Check:

```bash
curl http://localhost:8000/health/live
curl http://localhost:8000/health/ready
```

The container should terminate cleanly on SIGTERM and should not rely on its filesystem for durable application state.

## 23. CI simulation

Run the same sequence CI should run:

```bash
uv sync --locked
uv run ruff format --check .
uv run ruff check .
uv run mypy src
uv run pytest
```

If any command fails, treat the commit as not ready.

## 24. What you actually just practiced

| Exercise | Backend concept |
|---|---|
| Project setup | uv, `pyproject.toml`, lockfiles, `.venv` |
| FastAPI routes | ASGI, validation, dependency injection |
| SQLAlchemy | sessions, pools, transactions, query boundaries |
| Alembic | migration discipline |
| Redis | caching, shared state, idempotency, rate limiting |
| HTTPX | external API timeouts and failures |
| N+1 failure | database performance |
| blocking sleep | async vs blocking work |
| duplicate payment | idempotency and retries |
| Redis outage | dependency failure and degradation |
| migration failure | safe schema rollout |
| quality gate | Ruff, mypy, pytest |
| Docker | reproducible runtime |
| health endpoints | deployment/readiness semantics |

The final goal is not that you can reproduce this repository. It is that when you encounter a Python backend in a real company, you can identify the same boundaries, failure modes and trade-offs in a different codebase.
