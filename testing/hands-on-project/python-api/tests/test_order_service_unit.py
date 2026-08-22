"""
UNIT TESTS: test OrderService's logic in complete isolation.
The store is a Mock — we don't care how it's implemented, only that
OrderService calls it correctly and reacts correctly to what it returns.

Run: pytest tests/test_order_service_unit.py -v
"""

from unittest.mock import Mock

import pytest

from order_service import OrderService, OrderError


def test_create_order_calculates_total_with_discount():
    store = Mock()
    service = OrderService(store)

    order = service.create_order("order_1", subtotal=100, discount_percent=10)

    assert order["total"] == 90
    assert order["status"] == "created"


def test_create_order_with_no_discount():
    store = Mock()
    service = OrderService(store)

    order = service.create_order("order_1", subtotal=50)

    assert order["total"] == 50


def test_create_order_saves_to_store():
    store = Mock()
    service = OrderService(store)

    service.create_order("order_1", subtotal=100, discount_percent=0)

    # verify the store was called correctly — not just that we got a result back
    store.save.assert_called_once()
    saved_order = store.save.call_args[0][0]
    assert saved_order["order_id"] == "order_1"


@pytest.mark.parametrize("subtotal", [0, -10, -0.01])
def test_create_order_rejects_non_positive_subtotal(subtotal):
    store = Mock()
    service = OrderService(store)

    with pytest.raises(OrderError, match="subtotal must be positive"):
        service.create_order("order_1", subtotal=subtotal)


@pytest.mark.parametrize("discount", [-1, 101, 150])
def test_create_order_rejects_invalid_discount(discount):
    store = Mock()
    service = OrderService(store)

    with pytest.raises(OrderError, match="discount_percent"):
        service.create_order("order_1", subtotal=100, discount_percent=discount)


def test_get_order_raises_when_not_found():
    store = Mock()
    store.get.return_value = None
    service = OrderService(store)

    with pytest.raises(OrderError, match="not found"):
        service.get_order("missing_order")


def test_cancel_order_changes_status():
    store = Mock()
    existing_order = {"order_id": "order_1", "status": "created"}
    store.get.return_value = existing_order
    service = OrderService(store)

    result = service.cancel_order("order_1")

    assert result["status"] == "cancelled"
    store.save.assert_called_once_with({"order_id": "order_1", "status": "cancelled"})


def test_cancel_order_twice_raises():
    store = Mock()
    store.get.return_value = {"order_id": "order_1", "status": "cancelled"}
    service = OrderService(store)

    with pytest.raises(OrderError, match="already cancelled"):
        service.cancel_order("order_1")
