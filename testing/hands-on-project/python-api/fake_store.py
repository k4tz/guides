"""
An in-memory fake standing in for a real database. Real enough to catch
real bugs (e.g. "did save() actually persist the right fields"), fast
enough to run in milliseconds with zero setup — no real DB needed.

This is the "Fake" from the mock/stub/fake vocabulary in advanced.md:
a lightweight working implementation, not just a recorder of calls (mock)
or canned-response object (stub).
"""


class FakeOrderStore:
    def __init__(self):
        self._data = {}

    def save(self, order):
        self._data[order["order_id"]] = dict(order)  # copy, avoid aliasing bugs

    def get(self, order_id):
        return self._data.get(order_id)
