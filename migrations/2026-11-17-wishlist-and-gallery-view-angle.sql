-- Additive, idempotent schema delta for account-synced wishlists and gallery angles.
-- Apply only after confirming the target database and taking/verifying a backup.
BEGIN;

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS view_angle TEXT NOT NULL DEFAULT 'detail';
ALTER TABLE public.product_images
  DROP CONSTRAINT IF EXISTS product_images_view_angle_check;
ALTER TABLE public.product_images
  ADD CONSTRAINT product_images_view_angle_check
  CHECK (view_angle IN ('front','back','top','bottom','detail'));

CREATE TABLE IF NOT EXISTS public.customer_wishlist (
  customer_id UUID NOT NULL REFERENCES public.customer_accounts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);
CREATE INDEX IF NOT EXISTS customer_wishlist_customer_created_idx
  ON public.customer_wishlist(customer_id, created_at DESC);

COMMIT;
