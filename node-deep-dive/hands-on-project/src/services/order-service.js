import crypto from 'node:crypto';
import { AppError } from '../errors.js';

export class OrderService {
  constructor({ repository, cache, queue, cacheTtlSeconds }) {
    this.repository = repository;
    this.cache = cache;
    this.queue = queue;
    this.cacheTtlSeconds = cacheTtlSeconds;
  }

  validate(input) {
    if (!input || typeof input !== 'object') throw new AppError('Body must be an object', 400, 'INVALID_BODY');
    if (!input.customerId || typeof input.customerId !== 'string') throw new AppError('customerId is required', 400, 'INVALID_CUSTOMER');
    if (!/^[A-Z]{3}$/.test(input.currency ?? '')) throw new AppError('currency must be a 3-letter code', 400, 'INVALID_CURRENCY');
    if (!Array.isArray(input.items) || input.items.length === 0) throw new AppError('items must not be empty', 400, 'INVALID_ITEMS');
    if (input.items.length > 100) throw new AppError('too many items', 400, 'TOO_MANY_ITEMS');

    let totalCents = 0;
    for (const item of input.items) {
      if (!item.sku || !item.name) throw new AppError('item sku and name are required', 400, 'INVALID_ITEM');
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) throw new AppError('invalid quantity', 400, 'INVALID_QUANTITY');
      if (!Number.isInteger(item.unitPrice) || item.unitPrice < 1) throw new AppError('invalid unitPrice', 400, 'INVALID_PRICE');
      totalCents += item.quantity * item.unitPrice;
      if (totalCents > 2_000_000_000) throw new AppError('order total is too large', 400, 'TOTAL_TOO_LARGE');
    }
    return { ...input, totalCents };
  }

  async create(input, idempotencyKey) {
    if (!idempotencyKey) throw new AppError('Idempotency-Key is required', 400, 'MISSING_IDEMPOTENCY_KEY');
    const validated = this.validate(input);
    const existing = await this.repository.findByIdByIdempotency(idempotencyKey);
    if (existing) return existing;

    const order = {
      id: crypto.randomUUID(),
      customerId: validated.customerId,
      currency: validated.currency,
      totalCents: validated.totalCents,
      status: 'PENDING',
      idempotencyKey,
      createdAt: new Date().toISOString()
    };

    const saved = await this.repository.create(order);
    await this.cache.set(`order:${saved.id}`, saved, this.cacheTtlSeconds);
    this.queue.enqueue(async () => {
      console.log(JSON.stringify({ event: 'order.created', orderId: saved.id }));
    });
    return saved;
  }

  async get(id) {
    const cached = await this.cache.get(`order:${id}`);
    if (cached) return { order: cached, source: 'cache' };

    const order = await this.repository.findById(id);
    if (!order) throw new AppError('Order not found', 404, 'NOT_FOUND');
    await this.cache.set(`order:${id}`, order, this.cacheTtlSeconds);
    return { order, source: 'database' };
  }
}
