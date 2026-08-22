export class PostgresOrderRepository {
  constructor(pool) { this.pool = pool; }

  async findByIdByIdempotency(key) {
    const result = await this.pool.query(
      'SELECT id, customer_id AS "customerId", currency, total_cents AS "totalCents", status, idempotency_key AS "idempotencyKey", created_at AS "createdAt" FROM orders WHERE idempotency_key = $1',
      [key]
    );
    return result.rows[0] ?? null;
  }

  async create(order) {
    const result = await this.pool.query(
      `INSERT INTO orders (id, customer_id, currency, total_cents, status, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (idempotency_key)
       DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING id, customer_id AS "customerId", currency, total_cents AS "totalCents", status, idempotency_key AS "idempotencyKey", created_at AS "createdAt"`,
      [order.id, order.customerId, order.currency, order.totalCents, order.status, order.idempotencyKey]
    );
    return result.rows[0];
  }

  async findById(id) {
    const result = await this.pool.query(
      'SELECT id, customer_id AS "customerId", currency, total_cents AS "totalCents", status, idempotency_key AS "idempotencyKey", created_at AS "createdAt" FROM orders WHERE id = $1',
      [id]
    );
    return result.rows[0] ?? null;
  }
}
