-- BF SHOES India storefront and finance schema reconciliation.
-- Apply only after reviewing and approving the production database migration.
-- Additive/idempotent only: preserve existing orders, products, and inventory.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS short_description TEXT NOT NULL DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS seo_title TEXT NOT NULL DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS seo_description TEXT NOT NULL DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit_cost_cents INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);
ALTER TABLE public.products ALTER COLUMN currency SET DEFAULT 'INR';

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER NOT NULL DEFAULT 5000 CHECK (delivery_fee_cents >= 0);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_address TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cod';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
ALTER TABLE public.orders ALTER COLUMN currency SET DEFAULT 'INR';

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS unit_cost_cents INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);

CREATE TABLE IF NOT EXISTS public.finance_expenses (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 category TEXT NOT NULL CHECK (category IN ('shipping','marketing','operations','software','packaging','refund','other')),
 description TEXT NOT NULL,
 amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
 expense_date DATE NOT NULL,
 currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency='INR'),
 created_by UUID REFERENCES public.admins(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_expenses_date_idx ON public.finance_expenses(expense_date DESC);

CREATE TABLE IF NOT EXISTS public.finance_funding (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kind TEXT NOT NULL CHECK (kind IN ('owner_capital','loan','investor')),
 source_name TEXT NOT NULL,
 principal_cents BIGINT NOT NULL CHECK (principal_cents > 0),
 interest_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (interest_rate_bps BETWEEN 0 AND 100000),
 start_date DATE NOT NULL,
 due_date DATE,
 notes TEXT NOT NULL DEFAULT '',
 created_by UUID REFERENCES public.admins(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (due_date IS NULL OR due_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.finance_repayments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 funding_id UUID NOT NULL REFERENCES public.finance_funding(id) ON DELETE RESTRICT,
 amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
 principal_cents BIGINT NOT NULL CHECK (principal_cents >= 0),
 interest_cents BIGINT NOT NULL CHECK (interest_cents >= 0),
 paid_date DATE NOT NULL,
 notes TEXT NOT NULL DEFAULT '',
 created_by UUID REFERENCES public.admins(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (principal_cents + interest_cents = amount_cents)
);
CREATE INDEX IF NOT EXISTS finance_repayments_funding_idx ON public.finance_repayments(funding_id, paid_date DESC);

CREATE TABLE IF NOT EXISTS public.product_images (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
 image_url TEXT NOT NULL CHECK (image_url LIKE 'https://%'),
 alt_text TEXT NOT NULL DEFAULT '',
 sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
 created_by UUID REFERENCES public.admins(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(product_id, image_url)
);
CREATE INDEX IF NOT EXISTS product_images_product_idx ON public.product_images(product_id, sort_order, created_at);
