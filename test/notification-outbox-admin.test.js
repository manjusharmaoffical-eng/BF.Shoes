import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const email = await readFile(new URL("../src/email.js", import.meta.url), "utf8");
const business = await readFile(new URL("../src/business.js", import.meta.url), "utf8");
const admin = await readFile(new URL("../frontend/admin.html", import.meta.url), "utf8");
const js = await readFile(new URL("../frontend/admin.js", import.meta.url), "utf8");

test("notification queue is owner-only and never exposes email body or provider secrets", () => {
  assert.match(business, /businessRouter\.get\("\/notifications", ownerOnly/);
  assert.match(business, /businessRouter\.post\("\/notifications\/:id\/retry", ownerOnly/);
  assert.match(business, /SELECT id,kind,recipient,subject,status,attempts,last_error,created_at,sent_at/);
  assert.doesNotMatch(business, /SELECT[^\n]*text_body[^\n]*FROM notification_outbox/);
  assert.match(email, /process\.env\.RESEND_API_KEY/);
});

test("notification retry is bounded, prevents duplicate concurrent sends and rejects already-sent rows", () => {
  const retry = email.slice(email.indexOf("export async function retryQueuedEmail"), email.indexOf("// Bounded worker for Vercel Cron"));
  assert.match(retry, /FOR UPDATE/);
  assert.match(retry, /row\.attempts >= MAX_ATTEMPTS/);
  assert.match(email, /const MAX_ATTEMPTS = 5/);
  assert.match(retry, /row\.status === "sent"/);
  assert.match(retry, /row\.status === "sending"/);
  assert.match(retry, /status='sending',sending_at=now\(\),attempts=attempts\+1/);
  assert.match(retry, /status='sent',sending_at=NULL,sent_at=now\(\),last_error=NULL/);
  assert.ok(retry.lastIndexOf('await client.query("COMMIT")') < retry.indexOf("sendWithResend(row)"), "claim must commit before provider network request");
  assert.match(email, /AbortSignal\.timeout\(PROVIDER_TIMEOUT_MS\)/);
  assert.match(email, /Idempotency-Key/);
  assert.match(email, /bf-shoes-notification\/" \+ row\.id/);
});

test("admin email queue has manual retry controls and explicit owner-only guidance", () => {
  assert.match(admin, /data-tab="communications"[^>]*>Email queue/);
  assert.match(admin, /id="communications-panel"/);
  assert.match(admin, /id="notifications-table"/);
  assert.match(js, /req\('\/business\/notifications'\)/);
  assert.match(js, /data-notification-retry/);
  assert.match(js, /confirm\('Retry delivery of this queued email/);
});

test("scheduled email worker claims rows with SKIP LOCKED and caps retries and batch size", () => {
  assert.match(email, /export async function processEmailOutbox/);
  assert.match(email, /FOR UPDATE SKIP LOCKED/);
  assert.match(email, /status='sending',sending_at=now\(\),attempts=n\.attempts\+1/);
  assert.match(email, /attempts < \$1/);
  assert.match(email, /interval '15 minutes'/);
  assert.match(email, /Math\.min\(25/);
  assert.match(email, /configured: false, processed: 0/);
});

test("scheduled email endpoint requires a timing-safe CRON_SECRET and Vercel runs daily on a Hobby-compatible schedule", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.match(server, /app\.get\("\/api\/cron\/email-outbox"/);
  assert.match(server, /secret\.length >= 32/);
  assert.match(server, /timingSafeEqual/);
  assert.match(server, /processEmailOutbox\(\{ limit: 10 \}\)/);
  assert.ok(vercel.crons.some(job => job.path === "/api/cron/email-outbox" && job.schedule === "17 3 * * *"));
});

test("order and return status changes enqueue customer-facing email without exposing internal notes", async () => {
  const routes = await readFile(new URL("../src/routes.js", import.meta.url), "utf8");
  const returns = await readFile(new URL("../src/returns.js", import.meta.url), "utf8");
  const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
  assert.match(routes, /kind: "order_status_update"/);
  assert.match(returns, /kind: 'return_status_update'/);
  assert.match(returns, /request_type} request for order/);
  assert.match(returns, /if \(parsed\.data\.customer_message\)/);
  assert.doesNotMatch(returns, /textBody:[^\n]*internal_note/);
  assert.match(schema, /'order_status_update','return_status_update'/);
  assert.match(schema, /status TEXT NOT NULL DEFAULT 'pending' CHECK \(status IN \('pending','sending','sent','failed'\)\)/);
  assert.match(schema, /ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS sending_at TIMESTAMPTZ/);
});
