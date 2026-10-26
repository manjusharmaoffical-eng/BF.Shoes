-- BF SHOES customer accounts for storefront Sign Up / Sign In.
-- Additive migration: does not modify existing orders, products, or inventory.
CREATE TABLE IF NOT EXISTS public.customer_accounts (
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
CREATE INDEX IF NOT EXISTS customer_accounts_created_idx ON public.customer_accounts(created_at DESC);
