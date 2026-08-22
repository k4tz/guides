import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_redis
from app.db.models import Order, Payment
from app.db.session import get_session
from app.main import app


class FakeRedis:
    def __init__(self):
        self.data = {}

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value, ex=None):
        self.data[key] = value


class Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class FakeSession:
    def __init__(self):
        self.orders = {}
        self.payments = {}
        self.next_order = 1
        self.next_payment = 1

    def add(self, obj):
        if isinstance(obj, Order):
            obj.id = self.next_order
            self.next_order += 1
            self.orders[obj.id] = obj
        elif isinstance(obj, Payment):
            obj.id = self.next_payment
            self.next_payment += 1
            self.payments[obj.id] = obj

    async def commit(self):
        return None

    async def refresh(self, obj):
        return None

    async def get(self, model, key):
        if model is Payment:
            return self.payments.get(key)
        return self.orders.get(key)

    async def execute(self, statement):
        text = str(statement)
        if "FROM orders" in text:
            order_id = list(statement.compile().params.values())[0]
            return Result(self.orders.get(order_id))
        return Result(None)

    async def scalar(self, statement):
        key = list(statement.compile().params.values())[0]
        for payment in self.payments.values():
            if payment.idempotency_key == key:
                return payment
        return None


@pytest_asyncio.fixture
async def client():
    session = FakeSession()
    fake_redis = FakeRedis()

    async def override_session():
        yield session

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_redis] = lambda: fake_redis

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
