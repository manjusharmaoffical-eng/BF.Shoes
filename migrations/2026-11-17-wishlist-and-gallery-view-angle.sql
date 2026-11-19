-- Additive, idempotent schema delta for account-synced wishlists and gallery angles.
-- A verified custom-format backup must exist before applying this to production.
BEGIN;

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS view_angle TEXT NOT NULL DEFAULT 'detail';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_images_view_angle_check'
      AND conrelid = 'public.product_images'::regclass
  ) THEN
    ALTER TABLE public.product_images
      ADD CONSTRAINT product_images_view_angle_check
      CHECK (view_angle IN ('front','back','top','bottom','detail'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.customer_wishlist (
  customer_id UUID NOT NULL REFERENCES public.customer_accounts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);
CREATE INDEX IF NOT EXISTS customer_wishlist_customer_created_idx
  ON public.customer_wishlist(customer_id, created_at DESC);

COMMIT;
