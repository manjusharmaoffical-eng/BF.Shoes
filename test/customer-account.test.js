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
