CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  customer_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PAID', 'FAILED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_customer_id_created_at_idx
  ON orders (customer_id, created_at DESC);
