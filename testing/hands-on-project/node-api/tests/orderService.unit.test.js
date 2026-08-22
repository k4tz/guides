/**
 * UNIT TESTS: test OrderService's logic in complete isolation.
 * The store is a jest.fn()-based fake object — we don't care how it's
 * implemented, only that OrderService calls it correctly and reacts
 * correctly to what it returns.
 *
 * Directly mirrors test_order_service_unit.py — compare them side by side.
 *
 * Run: npx jest tests/orderService.unit.test.js
 */

const { OrderService, OrderError } = require('../orderService');

function makeMockStore() {
  return {
    save: jest.fn(),
    get: jest.fn(),
  };
}

describe('OrderService (unit)', () => {
  test('creates order and calculates total with discount', () => {
    const store = makeMockStore();
    const service = new OrderService(store);

    const order = service.createOrder('order_1', 100, 10);

    expect(order.total).toBe(90);
    expect(order.status).toBe('created');
  });

  test('creates order with no discount', () => {
    const store = makeMockStore();
    const service = new OrderService(store);

    const order = service.createOrder('order_1', 50);

    expect(order.total).toBe(50);
  });

  test('saves the created order to the store', () => {
    const store = makeMockStore();
    const service = new OrderService(store);

    service.createOrder('order_1', 100, 0);

    // verify the store was called correctly — not just that we got a result back
    expect(store.save).toHaveBeenCalledTimes(1);
    const savedOrder = store.save.mock.calls[0][0];
    expect(savedOrder.orderId).toBe('order_1');
  });

  test.each([0, -10, -0.01])(
    'rejects non-positive subtotal (%f)',
    (subtotal) => {
      const store = makeMockStore();
      const service = new OrderService(store);

      expect(() => service.createOrder('order_1', subtotal)).toThrow(
        'subtotal must be positive'
      );
    }
  );

  test.each([-1, 101, 150])(
    'rejects invalid discountPercent (%i)',
    (discount) => {
      const store = makeMockStore();
      const service = new OrderService(store);

      expect(() => service.createOrder('order_1', 100, discount)).toThrow(
        OrderError
      );
    }
  );

  test('getOrder throws when not found', () => {
    const store = makeMockStore();
    store.get.mockReturnValue(null);
    const service = new OrderService(store);

    expect(() => service.getOrder('missing_order')).toThrow('not found');
  });

  test('cancelOrder changes status', () => {
    const store = makeMockStore();
    const existingOrder = { orderId: 'order_1', status: 'created' };
    store.get.mockReturnValue(existingOrder);
    const service = new OrderService(store);

    const result = service.cancelOrder('order_1');

    expect(result.status).toBe('cancelled');
    expect(store.save).toHaveBeenCalledWith({
      orderId: 'order_1',
      status: 'cancelled',
    });
  });

  test('cancelling an already-cancelled order throws', () => {
    const store = makeMockStore();
    store.get.mockReturnValue({ orderId: 'order_1', status: 'cancelled' });
    const service = new OrderService(store);

    expect(() => service.cancelOrder('order_1')).toThrow('already cancelled');
  });
});
