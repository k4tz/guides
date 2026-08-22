import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryOrderRepository } from '../src/repositories/memory-order-repository.js';
import { MemoryCache } from '../src/cache/memory-cache.js';
import { InMemoryJobQueue } from '../src/jobs/queue.js';
import { OrderService } from '../src/services/order-service.js';

function service() {
  return new OrderService({
    repository: new MemoryOrderRepository(),
    cache: new MemoryCache(),
    queue: new InMemoryJobQueue(),
    cacheTtlSeconds: 60
  });
}

test('creates an order and computes total', async () => {
  const orderService = service();
  const order = await orderService.create({
    customerId: 'c1',
    currency: 'USD',
    items: [{ sku: 'A', name: 'A', quantity: 2, unitPrice: 500 }]
  }, 'key-1');

  assert.equal(order.totalCents, 1000);
  assert.equal(order.status, 'PENDING');
});

test('repeating the same idempotency key does not create a second order', async () => {
  const orderService = service();
  const input = { customerId: 'c1', currency: 'USD', items: [{ sku: 'A', name: 'A', quantity: 1, unitPrice: 500 }] };
  const first = await orderService.create(input, 'same-key');
  const second = await orderService.create(input, 'same-key');
  assert.equal(first.id, second.id);
});

test('cache is used after the first lookup', async () => {
  const orderService = service();
  const order = await orderService.create({
    customerId: 'c1',
    currency: 'USD',
    items: [{ sku: 'A', name: 'A', quantity: 1, unitPrice: 500 }]
  }, 'cache-key');

  const result = await orderService.get(order.id);
  assert.equal(result.source, 'cache');
});
