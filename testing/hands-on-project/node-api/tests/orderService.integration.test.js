/**
 * INTEGRATION TESTS: same OrderService, but now wired to the real
 * FakeOrderStore instead of a jest.fn()-based mock. This proves the
 * service and its data layer actually work TOGETHER — e.g. that data
 * saved in createOrder is genuinely retrievable later, in the shape
 * getOrder expects. A mock-based unit test can't catch that; a mock
 * just returns whatever you told it to.
 *
 * Directly mirrors test_order_service_integration.py — compare side by side.
 *
 * Run: npx jest tests/orderService.integration.test.js
 */

const { OrderService, OrderError } = require('../orderService');
const { FakeOrderStore } = require('../fakeStore');

describe('OrderService (integration)', () => {
  let service;

  // fresh store per test — isolation principle from advanced.md: no test
  // should be able to see another test's leftover data
  beforeEach(() => {
    const store = new FakeOrderStore();
    service = new OrderService(store);
  });

  test('create then get order round-trips correctly', () => {
    service.createOrder('order_1', 200, 25);

    const fetched = service.getOrder('order_1');

    expect(fetched.orderId).toBe('order_1');
    expect(fetched.total).toBe(150);
  });

  test('create then cancel then get reflects cancellation', () => {
    service.createOrder('order_1', 100);
    service.cancelOrder('order_1');

    const fetched = service.getOrder('order_1');

    expect(fetched.status).toBe('cancelled');
  });

  test('two orders do not interfere with each other', () => {
    service.createOrder('order_1', 100, 10);
    service.createOrder('order_2', 50, 0);

    const order1 = service.getOrder('order_1');
    const order2 = service.getOrder('order_2');

    expect(order1.total).toBe(90);
    expect(order2.total).toBe(50);
  });

  test('getting a nonexistent order throws', () => {
    expect(() => service.getOrder('never_created')).toThrow('not found');
  });
});
