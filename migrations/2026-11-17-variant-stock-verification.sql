-- Existing seed quantities are not trusted as physical stock until a human records a count.
-- This is additive: existing stock quantities are preserved but remain unavailable to shoppers.
BEGIN;
ALTER TABLE public.variants
  ADD COLUMN IF NOT EXISTS stock_verified BOOLEAN NOT NULL DEFAULT FALSE;
COMMIT;
