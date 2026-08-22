"""
A small orders service: create orders, apply discounts, look them up.
Deliberately simple — the point of this exercise is the TESTS, not the app.

`store` is injected rather than hardcoded, which is what makes this testable:
in production it'd be a real database wrapper; in tests it's an in-memory fake
(see fake_store.py) or a mock, depending on what the test needs to prove.
"""


class OrderError(Exception):
    pass


class OrderService:
    def __init__(self, store):
        self.store = store  # anything with .save(order) and .get(order_id)

    def create_order(self, order_id: str, subtotal: float, discount_percent: float = 0):
        if subtotal <= 0:
            raise OrderError("subtotal must be positive")
        if not (0 <= discount_percent <= 100):
            raise OrderError("discount_percent must be between 0 and 100")

        total = round(subtotal * (1 - discount_percent / 100), 2)
        order = {
            "order_id": order_id,
            "subtotal": subtotal,
            "discount_percent": discount_percent,
            "total": total,
            "status": "created",
        }
        self.store.save(order)
        return order

    def get_order(self, order_id: str):
        order = self.store.get(order_id)
        if order is None:
            raise OrderError(f"order {order_id} not found")
        return order

    def cancel_order(self, order_id: str):
        order = self.get_order(order_id)  # raises if missing
        if order["status"] == "cancelled":
            raise OrderError("order already cancelled")
        order["status"] = "cancelled"
        self.store.save(order)
        return order
