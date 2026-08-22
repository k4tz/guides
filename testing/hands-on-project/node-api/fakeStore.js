/**
 * An in-memory fake standing in for a real database. Real enough to catch
 * real bugs (e.g. "did save() actually persist the right fields"), fast
 * enough to run in milliseconds with zero setup — no real DB needed.
 *
 * This is the "Fake" from the mock/stub/fake vocabulary in advanced.md:
 * a lightweight working implementation, not just a recorder of calls (mock)
 * or canned-response object (stub).
 */

class FakeOrderStore {
  constructor() {
    this._data = new Map();
  }

  save(order) {
    this._data.set(order.orderId, { ...order }); // copy, avoid aliasing bugs
  }

  get(orderId) {
    return this._data.get(orderId) ?? null;
  }
}

module.exports = { FakeOrderStore };
