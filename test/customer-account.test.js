import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("customer account page exposes registration, sign-in, and sign-out", async () => {
  const html = await readFile(new URL("../frontend/account.html", import.meta.url), "utf8");
  assert.match(html, /id="login-form"/);
  assert.match(html, /id="register-form"/);
  assert.match(html, /id="signout-button"/);
  assert.match(html, /id="orders-list"/);
});

test("customer account uses tab-scoped session token and loads own order history", async () => {
  const js = await readFile(new URL("../frontend/account.js", import.meta.url), "utf8");
  assert.match(js, /sessionStorage/);
  assert.match(js, /api\('\/me'\)/);
  assert.match(js, /api\('\/orders'\)/);
  assert.doesNotMatch(js, /localStorage/);
});

test("customer order history is tied to the verified customer account id", async () => {
  const auth = await readFile(new URL("../src/customer-auth.js", import.meta.url), "utf8");
  assert.match(auth, /customerAuthRouter\.get\("\/orders"/);
  assert.match(auth, /audience: "bf-shoes-customer"/);
  assert.match(auth, /claims\.typ !== "customer"/);
  assert.match(auth, /JOIN customer_accounts c ON lower\(c\.email\)=lower\(o\.customer_email\)/);
  assert.match(auth, /WHERE c\.id=\$1 AND c\.active=true/);
  assert.match(auth, /LIMIT 50/);
});

test("storefront separates India and UAE catalog, currency and carts", async () => {
  const app = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
  assert.match(html, /id="market-selector"/);
  assert.match(html, /value="IN">India · INR/);
  assert.match(html, /value="AE">UAE · AED/);
  assert.match(app, /products\?market=/);
  assert.match(app, /currency === 'AED'/);
  assert.match(app, /cartByMarket: \{ IN: \[\], AE: \[\] \}/);
  assert.match(app, /state\.market === 'IN' && selected && selected\.checkoutEnabled/);
  assert.match(app, /matchesPrice/);
  assert.match(app, /maxPriceCents/);
});


test("customer account exposes reviewed return and exchange requests without direct refunds", async () => {
  const html = await readFile(new URL("../frontend/account.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../frontend/account.js", import.meta.url), "utf8");
  const routes = await readFile(new URL("../src/returns.js", import.meta.url), "utf8");
  assert.match(html, /id="return-requests-list"/);
  assert.match(js, /api\('\/returns\/mine'\)/);
  assert.match(js, /api\('\/returns'/);
  assert.match(routes, /getCustomerSession/);
  assert.match(routes, /order\.status !== 'delivered'/);
  assert.match(routes, /No refund, fee or stock change/);
});


test("admin can review return requests through a dedicated least-privilege section", async () => {
  const html = await readFile(new URL("../frontend/admin.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../frontend/admin.js", import.meta.url), "utf8");
  const routes = await readFile(new URL("../src/returns.js", import.meta.url), "utf8");
  assert.match(html, /data-tab="returns"/);
  assert.match(html, /id="returns-panel"/);
  assert.match(js, /returns:loadReturns/);
  assert.match(js, /req\('\/returns\/admin'/);
  assert.match(routes, /requireScope\('orders:write'\)/);
  assert.match(routes, /\['admin', 'manager'\]/);
});
