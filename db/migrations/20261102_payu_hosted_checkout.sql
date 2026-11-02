-- PayU hosted checkout with pending orders and time-limited stock reservations.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending_payment','confirmed','processing','shipped','delivered','cancelled'));
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('unpaid','pending','paid','failed','refunded','review'));

CREATE TABLE IF NOT EXISTS payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('payu')),
  txnid TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL CHECK (currency = 'INR'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','failed','review','paid_stock_review')),
  provider_payment_id TEXT,
  checkout_params JSONB NOT NULL,
  callback_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS order_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, variant_id)
);

CREATE INDEX IF NOT EXISTS payment_attempts_order_created_idx ON payment_attempts(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_reservations_variant_expiry_idx ON order_reservations(variant_id, expires_at);
CREATE INDEX IF NOT EXISTS order_reservations_order_idx ON order_reservations(order_id);
CREATE INDEX IF NOT EXISTS payment_attempts_provider_status_idx ON payment_attempts(provider, status, created_at DESC);

ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_reservations ENABLE ROW LEVEL SECURITY;
