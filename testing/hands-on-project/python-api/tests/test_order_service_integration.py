"""
INTEGRATION TESTS: same OrderService, but now wired to the FakeOrderStore
instead of a Mock. This proves the service and its data layer actually
work TOGETHER — e.g. that data saved in create_order is genuinely
retrievable later, in the shape get_order expects. A unit test with a
Mock can't catch that; a Mock just returns whatever you told it to.

Run: pytest tests/test_order_service_integration.py -v
"""

import pytest

from order_service import OrderService, OrderError
from fake_store import FakeOrderStore


@pytest.fixture
def service():
    # fresh store per test — this is the isolation principle from advanced.md:
    # no test should be able to see another test's leftover data
    store = FakeOrderStore()
    return OrderService(store)


def test_create_then_get_order_round_trip(service):
    service.create_order("order_1", subtotal=200, discount_percent=25)

    fetched = service.get_order("order_1")

    assert fetched["order_id"] == "order_1"
    assert fetched["total"] == 150


def test_create_then_cancel_then_get_reflects_cancellation(service):
    service.create_order("order_1", subtotal=100)
    service.cancel_order("order_1")

    fetched = service.get_order("order_1")

    assert fetched["status"] == "cancelled"


def test_two_orders_do_not_interfere(service):
    service.create_order("order_1", subtotal=100, discount_percent=10)
    service.create_order("order_2", subtotal=50, discount_percent=0)

    order_1 = service.get_order("order_1")
    order_2 = service.get_order("order_2")

    assert order_1["total"] == 90
    assert order_2["total"] == 50


def test_getting_nonexistent_order_raises(service):
    with pytest.raises(OrderError, match="not found"):
        service.get_order("never_created")
