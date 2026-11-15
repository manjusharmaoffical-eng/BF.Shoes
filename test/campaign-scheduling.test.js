import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const business = await readFile(new URL("../src/business.js", import.meta.url), "utf8");
const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");
const adminHtml = await readFile(new URL("../frontend/admin.html", import.meta.url), "utf8");
const adminJs = await readFile(new URL("../frontend/admin.js", import.meta.url), "utf8");
const app = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../frontend/styles.css", import.meta.url), "utf8");

test("campaign creation validates explicit schedule and currency", () => {
  assert.match(business, /starts_at: z\.string\(\)\.datetime\(\)/);
  assert.match(business, /ends_at: z\.string\(\)\.datetime\(\)/);
  assert.match(business, /new Date\(v\.ends_at\) > new Date\(v\.starts_at\)/);
  assert.match(adminHtml, /name="starts_at" type="datetime-local"/);
  assert.match(adminHtml, /name="ends_at" type="datetime-local"/);
  assert.match(adminHtml, /name="currency"[\s\S]*?value="AED"[\s\S]*?value="INR"/);
  assert.match(adminJs, /starts_at:starts\?starts\.toISOString\(\):null/);
  assert.match(adminJs, /ends_at:ends\?ends\.toISOString\(\):null/);
  assert.match(adminJs, /currency:f\.get\('currency'\)/);
});

test("public campaign endpoint only returns campaigns inside their configured schedule", () => {
  assert.match(storefront, /status = 'active' AND kind = 'banner'/);
  assert.match(storefront, /starts_at IS NULL OR starts_at <= now\(\)/);
  assert.match(storefront, /ends_at IS NULL OR ends_at > now\(\)/);
});

test("storefront renders campaign content as text and only uses HTTPS campaign assets", () => {
  assert.match(app, /loadActiveCampaign\(\)/);
  assert.match(app, /campaign\.target_url\.startsWith\('https:\/\/'\)/);
  assert.match(app, /campaign\.image_url\.startsWith\('https:\/\/'\)/);
  assert.match(app, /headline\.textContent = campaign\.headline/);
  assert.match(app, /detail\.textContent = details\.join/);
  assert.match(app, /localStorage\.setItem\('bf-campaign-dismissed:'/);
  assert.doesNotMatch(app, /strip\.innerHTML\s*=.*campaign/);
  assert.match(css, /\.campaign-strip \.campaign-dismiss/);
});
