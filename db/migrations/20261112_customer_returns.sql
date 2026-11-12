-- Ensure the customer account dependency exists when this migration is run independently.
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

-- BF SHOES customer return/exchange request workflow.
-- Additive only. Requests are reviewed by staff; this migration does not charge fees or issue refunds.
CREATE TABLE IF NOT EXISTS public.return_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customer_accounts(id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL CHECK (request_type IN ('return','exchange')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 120),
  details TEXT NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','under_review','approved','rejected','received','closed')),
  review_note TEXT NOT NULL DEFAULT '' CHECK (char_length(review_note) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS return_requests_customer_created_idx ON public.return_requests(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS return_requests_order_status_idx ON public.return_requests(order_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS public.return_request_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_request_id UUID NOT NULL REFERENCES public.return_requests(id) ON DELETE RESTRICT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('customer','admin','system')),
  actor_id UUID,
  status TEXT NOT NULL CHECK (status IN ('requested','under_review','approved','rejected','received','closed')),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS return_request_events_request_created_idx ON public.return_request_events(return_request_id,created_at);
ALTER TABLE public.return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_request_events ENABLE ROW LEVEL SECURITY;
