-- Warehouse locations, stock ledgers, transfers, and production batches.
CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  address TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, variant_id)
);

CREATE TABLE IF NOT EXISTS warehouse_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  reason TEXT NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  actor_admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  planned_qty INTEGER NOT NULL CHECK (planned_qty > 0),
  good_qty INTEGER NOT NULL DEFAULT 0 CHECK (good_qty >= 0),
  rejected_qty INTEGER NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','cancelled')),
  planned_for DATE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (good_qty + rejected_qty <= planned_qty)
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  to_warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled')),
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_warehouse_id <> to_warehouse_id)
);

CREATE INDEX IF NOT EXISTS warehouse_inventory_variant_idx ON warehouse_inventory(variant_id);
CREATE INDEX IF NOT EXISTS warehouse_stock_movements_date_idx ON warehouse_stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS warehouse_stock_movements_warehouse_date_idx ON warehouse_stock_movements(warehouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS production_batches_completed_idx ON production_batches(completed_at DESC) WHERE status='completed';
CREATE INDEX IF NOT EXISTS production_batches_variant_idx ON production_batches(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_transfers_created_idx ON stock_transfers(created_at DESC);

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS production_batches_created_by_idx ON production_batches(created_by);
CREATE INDEX IF NOT EXISTS production_batches_product_id_idx ON production_batches(product_id);
CREATE INDEX IF NOT EXISTS stock_transfers_created_by_idx ON stock_transfers(created_by);
CREATE INDEX IF NOT EXISTS stock_transfers_from_warehouse_idx ON stock_transfers(from_warehouse_id);
CREATE INDEX IF NOT EXISTS stock_transfers_to_warehouse_idx ON stock_transfers(to_warehouse_id);
CREATE INDEX IF NOT EXISTS stock_transfers_variant_id_idx ON stock_transfers(variant_id);
CREATE INDEX IF NOT EXISTS warehouse_stock_movements_actor_idx ON warehouse_stock_movements(actor_admin_id);
CREATE INDEX IF NOT EXISTS warehouse_stock_movements_variant_id_idx ON warehouse_stock_movements(variant_id);
CREATE INDEX IF NOT EXISTS warehouses_created_by_idx ON warehouses(created_by);
