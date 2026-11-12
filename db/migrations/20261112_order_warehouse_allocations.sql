-- Track which warehouse units each order consumes so cancellation restores
-- stock to the same location. Existing order and inventory rows are untouched.
CREATE TABLE IF NOT EXISTS order_warehouse_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  restored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, warehouse_id, variant_id)
);
CREATE INDEX IF NOT EXISTS order_warehouse_allocations_order_idx
  ON order_warehouse_allocations(order_id, restored_at);
CREATE INDEX IF NOT EXISTS order_warehouse_allocations_variant_idx
  ON order_warehouse_allocations(variant_id, warehouse_id);
ALTER TABLE order_warehouse_allocations ENABLE ROW LEVEL SECURITY;
