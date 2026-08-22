# Python Backend Ecosystem & Tooling Guide

A practical path from “I can write Python APIs” to “I can work safely in a production Python backend codebase.”

## Stack

This guide uses one opinionated modern stack:

- Python 3.13
- FastAPI
- uv
- `pyproject.toml` + `uv.lock`
- PostgreSQL
- SQLAlchemy 2.x
- Alembic
- Pydantic / pydantic-settings
- HTTPX
- pytest
- Ruff
- mypy
- Docker + Docker Compose

The guide deliberately avoids turning every alternative into a competing workflow. The objective is to make one production-shaped workflow second nature.

uv's current project workflow centers on `pyproject.toml`, a project `.venv`, and a `uv.lock` file. `uv add`, `uv sync`, `uv run`, and `uv lock` cover the common dependency/project lifecycle. The lockfile is intended to be committed for reproducible environments. citeturn0search1turn0search2

FastAPI is used as the minimal web API layer. Its current documentation covers routing, validation, settings, testing, deployment and containerization, which makes it a good fit for this guide's progression. citeturn0search9turn0search11turn0search14

## Structure

```text
python-backend/
├── README.md
├── basic.md
├── advanced.md
├── hands-on.md
└── hands-on-project/
```

## 1. Basic

[`basic.md`](basic.md) establishes the daily development workflow:

```text
Python
  ↓
uv + virtual environment + pyproject.toml + lockfile
  ↓
FastAPI + Pydantic
  ↓
SQLAlchemy + PostgreSQL + Alembic
  ↓
HTTPX / external services
  ↓
pytest + Ruff + mypy
  ↓
Docker / CI
```

It covers project initialization, dependency management, FastAPI routing, validation, async Python, database sessions, migrations, external HTTP calls, testing, typing, configuration and local workflow.

## 2. Advanced

[`advanced.md`](advanced.md) focuses on production reasoning rather than framework trivia:

- async reliability and cancellation
- timeouts and concurrency limits
- SQLAlchemy sessions, pools, transactions and N+1
- migrations and zero-downtime schema changes
- Redis caching and correctness trade-offs
- retries, idempotency and external APIs
- circuit breakers and graceful degradation
- application architecture and boundaries
- stateless services and horizontal scaling
- worker/process models
- background jobs
- health/readiness
- configuration and secrets
- testing strategy
- type checking and code quality
- security
- observability and tracing
- profiling and performance
- Docker and CI/CD
- production norms
- interview honesty
- a production launch checklist

## 3. Hands-on

[`hands-on.md`](hands-on.md) walks through a single order/payment service from a small FastAPI app to a production-shaped service.

The project uses:

```text
FastAPI
  ↓
Pydantic
  ↓
service layer
  ↓
SQLAlchemy
  ↓
PostgreSQL
  ↓
Redis
  ↓
HTTPX → payment provider
```

The exercise includes deliberate failure labs for:

- N+1 queries
- blocking code in an async endpoint
- duplicate payment requests
- Redis failure
- unsafe migrations

It also covers testing, quality gates, Docker, health checks and end-to-end request measurement.

## 4. Project verification

The project was statically compiled and its automated tests were executed successfully in the build environment:

```text
4 passed
```

The environment used for verification had Python 3.13, but did not have Docker or outbound package-index access. Therefore PostgreSQL/Redis could not be started through Compose and a fresh `uv.lock` could not be resolved from PyPI. The project includes the production-shaped Compose configuration and dependency declarations; after cloning it, run:

```bash
uv lock
uv sync
```

Then follow the PostgreSQL/Redis Docker workflow in `hands-on.md`.

The tests use dependency overrides/fakes so the application behavior can still be verified without requiring external infrastructure during the guide build.

## 5. What “done” means

After finishing this guide, you should be able to enter a Python backend repository and answer:

- How is the environment created?
- Where are direct dependencies declared?
- What guarantees reproducibility?
- Where does HTTP handling end and business logic begin?
- Where are transaction boundaries?
- How are migrations deployed safely?
- Which work is async and which is blocking?
- What happens when PostgreSQL, Redis or an external API fails?
- What is safe to retry?
- How does the application scale horizontally?
- How are errors, latency and dependency failures observed?
- What does CI verify before deployment?
- What would you inspect first when an endpoint becomes slow?

That is the difference between knowing FastAPI and understanding the Python backend ecosystem.
