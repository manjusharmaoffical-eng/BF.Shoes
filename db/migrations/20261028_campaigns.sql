-- Additive campaign table required by src/business.js campaign endpoints.
-- Safe to re-run; does not alter existing product prices, inventory, or orders.
CREATE TABLE IF NOT EXISTS public.campaigns (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 160),
 kind TEXT NOT NULL CHECK (kind IN ('banner','coupon','sale','ad')),
 status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','ended')),
 headline TEXT NOT NULL DEFAULT '',
 image_url TEXT CHECK (image_url IS NULL OR image_url LIKE 'https://%'),
 target_url TEXT CHECK (target_url IS NULL OR target_url LIKE 'https://%'),
 coupon_code TEXT NOT NULL DEFAULT '',
 discount_percent INTEGER NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 90),
 starts_at TIMESTAMPTZ,
 ends_at TIMESTAMPTZ,
 budget_cents BIGINT NOT NULL DEFAULT 0 CHECK (budget_cents BETWEEN 0 AND 1000000000),
 currency CHAR(3) NOT NULL DEFAULT 'AED' CHECK (currency ~ '^[A-Z]{3}$'),
 created_by UUID REFERENCES public.admins(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS campaigns_created_at_idx ON public.campaigns(created_at DESC);
