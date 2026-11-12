CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Customer accounts are created by the dedicated migration and included here for fresh installs.
CREATE TABLE IF NOT EXISTS customer_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 160),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_accounts_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT customer_accounts_email_unique UNIQUE (email)
);
CREATE INDEX IF NOT EXISTS customer_accounts_created_idx ON customer_accounts(created_at DESC);


CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'staff')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS api_keys_prefix_idx ON api_keys(key_prefix);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  short_description TEXT NOT NULL DEFAULT '',
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT 'BF SHOES',
  image_url TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'AED',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL UNIQUE,
  size_label TEXT NOT NULL,
  color_name TEXT NOT NULL,
  stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, size_label, color_name)
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
-- New products default to the primary UAE storefront; existing product currencies and prices are unchanged.
ALTER TABLE products ALTER COLUMN currency SET DEFAULT 'AED';
-- Costs remain NULL until the owner records actual purchase cost; reports must not invent profit.
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_cost_cents INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);
CREATE INDEX IF NOT EXISTS variants_product_idx ON variants(product_id);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  delivery_fee_cents INTEGER NOT NULL CHECK (delivery_fee_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  idempotency_key TEXT UNIQUE,
  request_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cod';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER CHECK (delivery_fee_cents IS NULL OR delivery_fee_cents >= 0);
-- Never assume a delivery fee: preserve historical values but require explicit values for future orders.
ALTER TABLE orders ALTER COLUMN delivery_fee_cents DROP DEFAULT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  size_label TEXT NOT NULL,
  color_name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0)
);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  reason TEXT NOT NULL,
  reference_order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
  actor_admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'api_key', 'system')),
  actor_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Business tools, team roles, newsletter and email delivery queue.
DO $$ BEGIN
  ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
  ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('admin','manager','staff'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('banner','coupon','sale','ad')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','ended')),
  headline TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  target_url TEXT,
  coupon_code TEXT NOT NULL DEFAULT '',
  discount_percent INTEGER NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 90),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  budget_cents BIGINT NOT NULL DEFAULT 0 CHECK (budget_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns(status, starts_at, ends_at);
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('order_confirmation','newsletter_welcome')),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx ON notification_outbox(status, created_at);

-- Product costs are intentionally nullable until an actual cost is entered.
ALTER TABLE products ADD COLUMN IF NOT EXISTS short_description TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_title TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_description TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_cost_cents INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost_cents INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);
CREATE TABLE IF NOT EXISTS finance_expenses (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 category TEXT NOT NULL CHECK (category IN ('shipping','marketing','operations','software','packaging','refund','other')),
 description TEXT NOT NULL,
 amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
 expense_date DATE NOT NULL,
 currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','AED')),
 created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE finance_expenses DROP CONSTRAINT IF EXISTS finance_expenses_currency_check;
ALTER TABLE finance_expenses ADD CONSTRAINT finance_expenses_currency_check CHECK (currency IN ('INR','AED'));
CREATE INDEX IF NOT EXISTS finance_expenses_currency_date_idx ON finance_expenses(currency, expense_date DESC);
CREATE TABLE IF NOT EXISTS finance_funding (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kind TEXT NOT NULL CHECK (kind IN ('owner_capital','loan','investor')),
 source_name TEXT NOT NULL,
 principal_cents BIGINT NOT NULL CHECK (principal_cents > 0),
 currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','AED')),
 interest_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (interest_rate_bps BETWEEN 0 AND 100000),
 start_date DATE NOT NULL,
 due_date DATE,
 notes TEXT NOT NULL DEFAULT '',
 created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (due_date IS NULL OR due_date >= start_date)
);
ALTER TABLE finance_funding ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','AED'));
CREATE INDEX IF NOT EXISTS finance_funding_currency_idx ON finance_funding(currency, start_date DESC);
CREATE TABLE IF NOT EXISTS finance_repayments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 funding_id UUID NOT NULL REFERENCES finance_funding(id) ON DELETE RESTRICT,
 amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
 principal_cents BIGINT NOT NULL CHECK (principal_cents >= 0),
 interest_cents BIGINT NOT NULL CHECK (interest_cents >= 0),
 paid_date DATE NOT NULL,
 notes TEXT NOT NULL DEFAULT '',
 created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (principal_cents + interest_cents = amount_cents)
);
CREATE INDEX IF NOT EXISTS finance_repayments_funding_idx ON finance_repayments(funding_id, paid_date DESC);


-- Product image gallery for AI-generated and manually curated product media.
CREATE TABLE IF NOT EXISTS product_images (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 image_url TEXT NOT NULL CHECK (image_url LIKE 'https://%'),
 alt_text TEXT NOT NULL DEFAULT '',
 sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
 created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(product_id, image_url)
);
CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images(product_id, sort_order, created_at);


-- India GST and UAE VAT invoice profiles. Rates are configured by the owner.
CREATE TABLE IF NOT EXISTS tax_profiles (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('IN_GST','AE_VAT')),
 profile_name TEXT NOT NULL, seller_name TEXT NOT NULL, seller_address TEXT NOT NULL, registration_number TEXT NOT NULL DEFAULT '',
 seller_state TEXT NOT NULL DEFAULT '', currency CHAR(3) NOT NULL CHECK (currency IN ('INR','AED')),
 tax_rate_bps INTEGER NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000), active BOOLEAN NOT NULL DEFAULT TRUE,
 created_by UUID REFERENCES admins(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(jurisdiction, profile_name)
);
CREATE TABLE IF NOT EXISTS tax_invoices (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
 profile_id UUID NOT NULL REFERENCES tax_profiles(id) ON DELETE RESTRICT, invoice_number TEXT NOT NULL UNIQUE,
 jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('IN_GST','AE_VAT')), currency CHAR(3) NOT NULL,
 invoice_date DATE NOT NULL DEFAULT CURRENT_DATE, seller_snapshot JSONB NOT NULL, buyer_snapshot JSONB NOT NULL, lines JSONB NOT NULL,
 subtotal_cents BIGINT NOT NULL CHECK (subtotal_cents >= 0), discount_cents BIGINT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
 tax_rate_bps INTEGER NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000), cgst_cents BIGINT NOT NULL DEFAULT 0 CHECK (cgst_cents >= 0),
 sgst_cents BIGINT NOT NULL DEFAULT 0 CHECK (sgst_cents >= 0), igst_cents BIGINT NOT NULL DEFAULT 0 CHECK (igst_cents >= 0),
 vat_cents BIGINT NOT NULL DEFAULT 0 CHECK (vat_cents >= 0), total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
 place_of_supply TEXT NOT NULL DEFAULT '', tax_treatment TEXT NOT NULL CHECK (tax_treatment IN ('INTRA_STATE','INTER_STATE','UAE_VAT','ZERO_RATED','EXEMPT')),
 status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','void','credited')),
 created_by UUID REFERENCES admins(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(order_id, profile_id)
);
CREATE INDEX IF NOT EXISTS tax_invoices_date_idx ON tax_invoices(invoice_date DESC);
CREATE INDEX IF NOT EXISTS tax_invoices_jurisdiction_date_idx ON tax_invoices(jurisdiction, invoice_date DESC);
CREATE TABLE IF NOT EXISTS tax_credit_notes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id UUID NOT NULL REFERENCES tax_invoices(id) ON DELETE RESTRICT,
 credit_note_number TEXT NOT NULL UNIQUE, reason TEXT NOT NULL, amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
 tax_cents BIGINT NOT NULL CHECK (tax_cents >= 0), created_by UUID REFERENCES admins(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cover foreign-key columns used in joins and referential checks.
CREATE INDEX IF NOT EXISTS api_keys_created_by_idx ON api_keys(created_by);
CREATE INDEX IF NOT EXISTS campaigns_created_by_idx ON campaigns(created_by);
CREATE INDEX IF NOT EXISTS finance_expenses_created_by_idx ON finance_expenses(created_by);
CREATE INDEX IF NOT EXISTS finance_funding_created_by_idx ON finance_funding(created_by);
CREATE INDEX IF NOT EXISTS finance_repayments_created_by_idx ON finance_repayments(created_by);
CREATE INDEX IF NOT EXISTS inventory_movements_actor_admin_id_idx ON inventory_movements(actor_admin_id);
CREATE INDEX IF NOT EXISTS inventory_movements_reference_order_id_idx ON inventory_movements(reference_order_id);
CREATE INDEX IF NOT EXISTS inventory_movements_variant_id_idx ON inventory_movements(variant_id);
CREATE INDEX IF NOT EXISTS order_items_variant_id_idx ON order_items(variant_id);
CREATE INDEX IF NOT EXISTS product_images_created_by_idx ON product_images(created_by);
CREATE INDEX IF NOT EXISTS tax_credit_notes_created_by_idx ON tax_credit_notes(created_by);
CREATE INDEX IF NOT EXISTS tax_credit_notes_invoice_id_idx ON tax_credit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS tax_invoices_created_by_idx ON tax_invoices(created_by);
CREATE INDEX IF NOT EXISTS tax_invoices_profile_id_idx ON tax_invoices(profile_id);
CREATE INDEX IF NOT EXISTS tax_profiles_created_by_idx ON tax_profiles(created_by);


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
  provider TEXT NOT NULL CHECK (provider IN ('payu','paytabs')),
  txnid TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL CHECK (currency IN ('INR','AED')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','failed','review','paid_stock_review')),
  provider_payment_id TEXT,
  checkout_params JSONB NOT NULL,
  callback_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ
);
-- Upgrade existing PayU-only installations without dropping payment history.
ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS payment_attempts_provider_check;
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_provider_check CHECK (provider IN ('payu','paytabs'));
ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS payment_attempts_currency_check;
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_currency_check CHECK (currency IN ('INR','AED'));

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


-- Covering indexes for warehouse and production foreign keys.
CREATE INDEX IF NOT EXISTS production_batches_created_by_idx ON production_batches(created_by);
CREATE INDEX IF NOT EXISTS production_batches_product_id_idx ON production_batches(product_id);
CREATE INDEX IF NOT EXISTS stock_transfers_created_by_idx ON stock_transfers(created_by);
CREATE INDEX IF NOT EXISTS stock_transfers_from_warehouse_idx ON stock_transfers(from_warehouse_id);
CREATE INDEX IF NOT EXISTS stock_transfers_to_warehouse_idx ON stock_transfers(to_warehouse_id);
CREATE INDEX IF NOT EXISTS stock_transfers_variant_id_idx ON stock_transfers(variant_id);
CREATE INDEX IF NOT EXISTS warehouse_stock_movements_actor_idx ON warehouse_stock_movements(actor_admin_id);
CREATE INDEX IF NOT EXISTS warehouse_stock_movements_variant_id_idx ON warehouse_stock_movements(variant_id);
CREATE INDEX IF NOT EXISTS warehouses_created_by_idx ON warehouses(created_by);


-- Customer return/exchange requests: request and review only; no refund or fee is processed here.
CREATE TABLE IF NOT EXISTS return_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL CHECK (request_type IN ('return','exchange')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 120),
  details TEXT NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','under_review','approved','rejected','received','closed')),
  review_note TEXT NOT NULL DEFAULT '' CHECK (char_length(review_note) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS return_requests_customer_created_idx ON return_requests(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS return_requests_order_status_idx ON return_requests(order_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS return_request_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_request_id UUID NOT NULL REFERENCES return_requests(id) ON DELETE RESTRICT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('customer','admin','system')),
  actor_id UUID,
  status TEXT NOT NULL CHECK (status IN ('requested','under_review','approved','rejected','received','closed')),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS return_request_events_request_created_idx ON return_request_events(return_request_id,created_at);
ALTER TABLE return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_request_events ENABLE ROW LEVEL SECURITY;
