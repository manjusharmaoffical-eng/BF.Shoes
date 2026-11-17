-- Align the production outbox constraint with the notification kinds emitted by the app.
-- Existing rows remain untouched; the current database contains no outbox rows.
BEGIN;

ALTER TABLE public.notification_outbox
  DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;

ALTER TABLE public.notification_outbox
  ADD CONSTRAINT notification_outbox_kind_check
  CHECK (kind IN ('order_confirmation','newsletter_welcome','order_status_update','return_status_update'));

COMMIT;
