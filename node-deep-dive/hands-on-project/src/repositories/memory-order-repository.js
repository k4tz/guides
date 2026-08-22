export class MemoryOrderRepository {
  constructor() {
    this.orders = new Map();
    this.idempotency = new Map();
  }

  async findByIdByIdempotency(key) {
    return this.idempotency.get(key) ?? null;
  }

  async create(order) {
    const existing = this.idempotency.get(order.idempotencyKey);
    if (existing) return existing;
    this.orders.set(order.id, order);
    this.idempotency.set(order.idempotencyKey, order);
    return order;
  }

  async findById(id) {
    return this.orders.get(id) ?? null;
  }
}
