-- BF SHOES runtime schema reconciliation for production 42P01/42703 errors.
-- Additive and idempotent: preserves existing rows, orders, prices, and inventory.
BEGIN;

-- Columns used by current storefront, tracking, and finance routes.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS short_description TEXT NOT NULL DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS seo_title TEXT NOT NULL DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS seo_description TEXT NOT NULL DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit_cost_cents INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'INR';

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_address TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cod';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS total_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS vat_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_rate_bps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_country CHAR(2) NOT NULL DEFAULT 'IN';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_emirate TEXT NOT NULL DEFAULT '';
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS unit_cost_cents INTEGER;

-- Tables referenced by live code but absent from the production table listing.
CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE, consented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('order_confirmation','newsletter_welcome')),
  recipient TEXT NOT NULL, subject TEXT NOT NULL, text_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx ON public.notification_outbox(status, created_at);

CREATE TABLE IF NOT EXISTS public.tax_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('IN_GST','AE_VAT')),
  profile_name TEXT NOT NULL, seller_name TEXT NOT NULL, seller_address TEXT NOT NULL,
  registration_number TEXT NOT NULL DEFAULT '', seller_state TEXT NOT NULL DEFAULT '',
  currency CHAR(3) NOT NULL CHECK (currency IN ('INR','AED')),
  tax_rate_bps INTEGER NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  active BOOLEAN NOT NULL DEFAULT TRUE, created_by UUID REFERENCES public.admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(jurisdiction, profile_name)
);
CREATE TABLE IF NOT EXISTS public.tax_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL REFERENCES public.tax_profiles(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL UNIQUE,
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('IN_GST','AE_VAT')),
  currency CHAR(3) NOT NULL, invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  seller_snapshot JSONB NOT NULL, buyer_snapshot JSONB NOT NULL, lines JSONB NOT NULL,
  subtotal_cents BIGINT NOT NULL CHECK (subtotal_cents >= 0),
  delivery_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  discount_cents BIGINT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_rate_bps INTEGER NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  cgst_cents BIGINT NOT NULL DEFAULT 0 CHECK (cgst_cents >= 0),
  sgst_cents BIGINT NOT NULL DEFAULT 0 CHECK (sgst_cents >= 0),
  igst_cents BIGINT NOT NULL DEFAULT 0 CHECK (igst_cents >= 0),
  vat_cents BIGINT NOT NULL DEFAULT 0 CHECK (vat_cents >= 0),
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  place_of_supply TEXT NOT NULL DEFAULT '',
  tax_treatment TEXT NOT NULL CHECK (tax_treatment IN ('INTRA_STATE','INTER_STATE','UAE_VAT','ZERO_RATED','EXEMPT')),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','void','credited')),
  created_by UUID REFERENCES public.admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(order_id, profile_id)
);
CREATE INDEX IF NOT EXISTS tax_invoices_date_idx ON public.tax_invoices(invoice_date DESC);
CREATE INDEX IF NOT EXISTS tax_invoices_jurisdiction_date_idx ON public.tax_invoices(jurisdiction, invoice_date DESC);
CREATE TABLE IF NOT EXISTS public.tax_credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.tax_invoices(id) ON DELETE RESTRICT,
  credit_note_number TEXT NOT NULL UNIQUE, reason TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  tax_cents BIGINT NOT NULL CHECK (tax_cents >= 0),
  created_by UUID REFERENCES public.admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
