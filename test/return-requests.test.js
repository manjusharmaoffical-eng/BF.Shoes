import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const customer = await readFile(new URL("../src/customer-auth.js", import.meta.url), "utf8");
const business = await readFile(new URL("../src/business.js", import.meta.url), "utf8");
const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../db/migrations/20261112_customer_returns.sql", import.meta.url), "utf8");
const account = await readFile(new URL("../frontend/account.js", import.meta.url), "utf8");
const accountHtml = await readFile(new URL("../frontend/account.html", import.meta.url), "utf8");
const admin = await readFile(new URL("../frontend/admin.html", import.meta.url), "utf8");
const adminJs = await readFile(new URL("../frontend/admin.js", import.meta.url), "utf8");

test("customer return requests require an authenticated owner, a delivered India order, and a reason", () => {
  assert.match(customer, /customerAuthRouter\.post\("\/returns"/);
  assert.match(customer, /customer_accounts c ON lower\(c\.email\)=lower\(o\.customer_email\)/);
  assert.match(customer, /WHERE o\.order_number=\$1 AND c\.id=\$2 AND c\.active=true/);
  assert.match(customer, /row\.currency !== "INR"/);
  assert.match(customer, /row\.status !== "delivered"/);
  assert.match(customer, /An active return or exchange request already exists/);
});

test("return requests record a review trail without automatic refund, fee or stock changes", () => {
  assert.match(customer, /INSERT INTO return_request_events/);
  assert.match(customer, /No refund has been issued and no return fee has been charged/);
  assert.doesNotMatch(customer, /UPDATE inventory|refund_payment|charge_return_fee|calculateIndiaReturnFee/);
  assert.match(business, /businessRouter\.patch\("\/returns\/:id", requireScope\("orders:write"\)/);
  assert.match(business, /returnStatusTransitions/);
  assert.match(business, /return\.request\.review/);
  assert.doesNotMatch(business.slice(business.indexOf('businessRouter.patch("/returns/:id"')), /refund|payment_capture|inventory_movements/);
});

test("return request schema and migration are additive and customer scoped", () => {
  for (const source of [schema,migration]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS[^;]*return_requests/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS[^;]*return_request_events/);
    assert.match(source, /REFERENCES (?:public\.)?customer_accounts\(id\)/);
    assert.match(source, /REFERENCES (?:public\.)?orders\(id\)/);
    assert.match(source, /ENABLE ROW LEVEL SECURITY/);
  }
  assert.match(migration, /status IN \('requested','under_review','approved','rejected','received','closed'\)/);
});

test("customer account and admin screens expose request submission and review controls", () => {
  assert.match(account, /api\('\/returns'\)/);
  assert.match(account, /data-return-order/);
  assert.match(account, /Submit request for review/);
  assert.match(accountHtml, /class="return-form"/);
  assert.match(admin, /data-tab="returns"/);
  assert.match(admin, /id="returns-panel"/);
  assert.match(adminJs, /req\('\/business\/returns'\)/);
  assert.match(adminJs, /data-return-save/);
});
