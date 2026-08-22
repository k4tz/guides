/**
 * A small orders service: create orders, apply discounts, look them up.
 * Deliberately simple — the point of this exercise is the TESTS, not the app.
 *
 * `store` is injected rather than hardcoded, which is what makes this testable:
 * in production it'd be a real database wrapper; in tests it's an in-memory fake
 * (see fakeStore.js) or a mock, depending on what the test needs to prove.
 *
 * Deliberately mirrors order_service.py so the two are directly comparable.
 */

class OrderError extends Error {}

class OrderService {
  constructor(store) {
    this.store = store; // anything with .save(order) and .get(orderId)
  }

  createOrder(orderId, subtotal, discountPercent = 0) {
    if (subtotal <= 0) {
      throw new OrderError('subtotal must be positive');
    }
    if (discountPercent < 0 || discountPercent > 100) {
      throw new OrderError('discountPercent must be between 0 and 100');
    }

    const total = Math.round(subtotal * (1 - discountPercent / 100) * 100) / 100;
    const order = {
      orderId,
      subtotal,
      discountPercent,
      total,
      status: 'created',
    };
    this.store.save(order);
    return order;
  }

  getOrder(orderId) {
    const order = this.store.get(orderId);
    if (order === null || order === undefined) {
      throw new OrderError(`order ${orderId} not found`);
    }
    return order;
  }

  cancelOrder(orderId) {
    const order = this.getOrder(orderId); // throws if missing
    if (order.status === 'cancelled') {
      throw new OrderError('order already cancelled');
    }
    order.status = 'cancelled';
    this.store.save(order);
    return order;
  }
}

module.exports = { OrderService, OrderError };
