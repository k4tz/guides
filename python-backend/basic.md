# Python Backend — Basic

## 1. Why a Python backend ecosystem exists

Python itself gives you a language and standard library. A production backend needs more: isolated dependencies, reproducible environments, HTTP routing, validation, database access, migrations, tests, linting, type checking, configuration, and a repeatable way to run all of it.

The goal is not to memorize a pile of tools. The goal is to understand one coherent workflow:

```text
Python version
    ↓
uv project + .venv + pyproject.toml + uv.lock
    ↓
FastAPI
    ↓
Pydantic validation → service logic → SQLAlchemy → PostgreSQL
                         ↓
                       Redis
    ↓
pytest + Ruff + mypy
    ↓
Docker / CI / production process
```

The rest of this guide is a variation on that model.

## 2. The opinionated stack

- Python 3.13
- FastAPI
- uv for project/dependency/environment management
- `pyproject.toml` as the project configuration center
- `uv.lock` committed to Git
- PostgreSQL
- SQLAlchemy 2.x
- Alembic
- Pydantic / pydantic-settings
- HTTPX
- pytest
- Ruff
- mypy
- Docker + Compose

There are other valid choices. This guide deliberately teaches one workflow first so that the mechanics become automatic.

## 3. Install Python and uv

Install Python 3.13 using your OS/package manager or uv itself. Verify:

```bash
python3 --version
```

Install uv from its official installer, then verify:

```bash
uv --version
```

uv manages Python projects, dependencies, environments and a lockfile. `uv run` executes commands in the project environment, while `uv add` updates project dependencies and the lockfile. citeturn0search1turn0search2

## 4. Start a project

```bash
uv init --python 3.13
uv add fastapi "uvicorn[standard]" pydantic-settings
uv add sqlalchemy asyncpg alembic redis httpx
uv add --dev pytest pytest-asyncio ruff mypy
```

A modern project normally contains:

```text
project/
├── pyproject.toml
├── uv.lock
├── .python-version
├── .venv/
├── src/
│   └── app/
└── tests/
```

`pyproject.toml` describes the project and its declared dependencies; `uv.lock` records the resolved dependency set and should be committed. uv creates and maintains the project `.venv` as part of the normal project workflow. citeturn0search2turn0search8

Do not manually edit `uv.lock`.

## 5. The four commands you will use constantly

```bash
uv add fastapi
uv sync
uv run pytest
uv run ruff check .
```

Think of them as:

```text
change dependencies → sync environment → run project command → verify quality
```

You generally do not need to activate `.venv` manually. `uv run ...` runs the command in the project environment. citeturn0search13

## 6. A minimal FastAPI application

```python
from fastapi import FastAPI

app = FastAPI(title="Orders API")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

Run it:

```bash
uv run uvicorn app:app --reload
```

FastAPI builds on ASGI and gives you routing, request parsing, validation and OpenAPI documentation. Its basic API model is intentionally small: create an application, declare routes, and return Python data or typed models. citeturn0search9

## 7. Request validation with Pydantic

```python
from decimal import Decimal
from pydantic import BaseModel, Field


class CreateOrder(BaseModel):
    customer_id: int
    amount: Decimal = Field(gt=0)
    currency: str = Field(min_length=3, max_length=3)


@app.post("/orders")
async def create_order(payload: CreateOrder) -> dict:
    return {"customer_id": payload.customer_id, "amount": payload.amount}
```

The important pattern is:

```text
untrusted HTTP input → validated typed object → application code
```

Keep validation close to the boundary. Do not make every service function rediscover whether an incoming string is actually a valid currency or positive amount.

## 8. Dependencies: FastAPI's dependency injection

Use dependencies for cross-cutting request concerns and resources:

```python
from fastapi import Depends, Header


async def get_request_id(x_request_id: str | None = Header(default=None)) -> str:
    return x_request_id or "generated-id"


@app.get("/orders/{order_id}")
async def get_order(order_id: int, request_id: str = Depends(get_request_id)):
    return {"order_id": order_id, "request_id": request_id}
```

Good dependency candidates include authentication, authorization, database sessions, request context and configuration. Avoid hiding core business decisions inside dependency functions.

## 9. Async Python: the mental model

`async def` does not mean “runs in parallel.” It means the coroutine can suspend at `await` points while the event loop lets other work progress.

```python
import asyncio


async def fetch_price() -> int:
    await asyncio.sleep(0.1)
    return 100


async def main() -> None:
    prices = await asyncio.gather(fetch_price(), fetch_price())
    print(prices)


asyncio.run(main())
```

Use async for I/O-bound work when the libraries involved are async-aware. Do not put blocking file, network or CPU-heavy work directly inside an async endpoint and assume `async` makes it non-blocking.

## 10. Database access: SQLAlchemy

The core mental model is:

```text
request
  ↓
service function
  ↓
SQLAlchemy session
  ↓
connection pool
  ↓
PostgreSQL
```

A minimal model:

```python
from sqlalchemy import String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
```

A production application should make transaction boundaries explicit. Do not let sessions leak across requests.

## 11. Migrations: Alembic

Your database schema is part of the deployed application. Treat schema changes like code:

```bash
uv run alembic revision --autogenerate -m "add order status"
uv run alembic upgrade head
```

A migration is not just a generated file. Read it, test it, and consider whether it is safe against the existing production data.

## 12. HTTP clients with HTTPX

```python
import httpx


async def charge_payment(order_id: int) -> dict:
    timeout = httpx.Timeout(5.0, connect=2.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            "https://payments.example/charges",
            json={"order_id": order_id},
        )
        response.raise_for_status()
        return response.json()
```

The important production idea is not the library. It is that external calls need explicit timeouts and deliberate failure handling.

## 13. Testing with pytest

FastAPI's testing stack works naturally with pytest and HTTPX. citeturn0search11

```python
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

Run:

```bash
uv run pytest
```

Start with deterministic unit tests and API tests. Add integration tests where the real database, Redis or external protocol behavior matters.

## 14. Ruff and mypy

Ruff handles formatting and linting in one fast tool:

```bash
uv run ruff format .
uv run ruff check .
```

mypy checks static type assumptions:

```bash
uv run mypy src
```

The point is not “make the tools happy.” The point is to make entire categories of mistakes visible before review or production.

## 15. Configuration

Use environment-driven configuration and validate it at startup:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    redis_url: str
    payment_base_url: str

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
```

Commit `.env.example`, never real credentials.

## 16. Local development workflow

A healthy daily loop looks like:

```text
pull latest code
   ↓
uv sync
   ↓
start PostgreSQL + Redis
   ↓
uv run pytest
   ↓
make change
   ↓
uv run pytest
   ↓
uv run ruff check .
uv run ruff format --check .
uv run mypy src
   ↓
commit
```

The goal is a short feedback loop. If a developer has to remember seven manual setup steps every morning, the project is underspecified.

## 17. What you can do now

After `basic.md`, you should be able to:

- create an isolated modern Python project
- manage dependencies with uv
- structure a FastAPI application
- validate input with Pydantic
- write async endpoints without confusing concurrency with parallelism
- access PostgreSQL through SQLAlchemy
- evolve schemas with Alembic
- call external services with timeouts
- write API tests with pytest
- enforce formatting, linting and types
- run a reproducible local development workflow

Continue to `advanced.md` for production architecture, failure modes, observability, security and the launch checklist.
