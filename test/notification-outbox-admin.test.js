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
  assert.match(email, /FOR UPDATE/);
  assert.match(email, /row\.attempts >= 5/);
  assert.match(email, /row\.status === "sent"/);
  assert.match(email, /row\.status === "pending" && row\.attempts > 0/);
  assert.match(email, /status='sent',sent_at=now\(\),last_error=NULL/);
});

test("admin email queue has manual retry controls and explicit owner-only guidance", () => {
  assert.match(admin, /data-tab="communications"[^>]*>Email queue/);
  assert.match(admin, /id="communications-panel"/);
  assert.match(admin, /id="notifications-table"/);
  assert.match(js, /req\('\/business\/notifications'\)/);
  assert.match(js, /data-notification-retry/);
  assert.match(js, /confirm\('Retry delivery of this queued email/);
});
