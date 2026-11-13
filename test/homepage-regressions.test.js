import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../frontend/styles.css", import.meta.url), "utf8");
const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
const pages = await Promise.all(["account.html", "admin.html", "payment-result.html", "policies.html", "track-order.html", "upi-payment.html"].map(name => readFile(new URL(`../frontend/${name}`, import.meta.url), "utf8")));

test("homepage product images do not use CSP-blocked inline error handlers", () => {
  assert.doesNotMatch(app, /<img[^>]+onerror\s*=/i);
  assert.match(app, /document\.addEventListener\('error',[\s\S]*?image\.dataset\.bfFallbackApplied/);
  assert.match(html, /favicon\.svg/);
});

test("conventional favicon URL is redirected to the existing brand SVG", () => {
  assert.match(server, /app\.get\("\/favicon\.ico",[\s\S]*?res\.redirect\(302, "\/favicon\.svg"\)/);
});

test("homepage mobile controls have usable minimum touch sizes", () => {
  assert.match(css, /\.product-sizes \.size-option\{min-width:36px;min-height:36px/);
  assert.match(css, /\.site-header \.main-nav a\{font-size:12px;min-height:36px/);
  assert.match(css, /\.product-card \.add-row \.button\{min-height:42px/);
});

test("homepage uses the approved BF-branded sneaker photo and reference headline", () => {
  assert.match(html, /PREMIUM FOOTWEAR/);
  assert.match(html, /<span class="hero-bf">BF<\/span> SHOES/);
  assert.match(html, /STEP UP YOUR <em>STYLE<\/em>/);
  assert.match(html, /class="category-cards"[\s\S]*?category-men[\s\S]*?category-women[\s\S]*?category-sports[\s\S]*?category-casual[\s\S]*?category-formal/);
  assert.match(html, /class="benefit-strip"/);
  assert.ok(css.includes("url('/bf-shoes-hero.svg')"));
  assert.doesNotMatch(html, /class=\"manifesto\"|Good design|doesn.t need/);
  assert.doesNotMatch(css, /\.manifesto/);
  assert.match(html, /styles\.css\?v=bf-home-20261113-4/);
  assert.match(html, /app\.js\?v=bf-home-20261113-4/);
  assert.doesNotMatch(html, /images\.unsplash\.com\/photo-1542291026/);
  assert.doesNotMatch(css, /bfSneakerFloat|perspective\(1100px\)/);
  assert.doesNotMatch(css, /images\.unsplash\.com/);
});

test("mobile header lays out all primary navigation links in a visible grid", () => {
  assert.match(css, /@media\(max-width:600px\)[\s\S]*?\.site-header \.main-nav\{[\s\S]*?display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /\.site-header \.main-nav a\{[\s\S]*?justify-content:center/);
  assert.match(html, /href="#category-title">Sports<\/a><a href="#benefits">About<\/a><a href="#footer">Contact<\/a>/);
});

test("mobile market selector has readable foreground and background contrast", () => {
  assert.match(css, /\.site-header \.market-select\{[\s\S]*?background:#fff;color:#111;border-color:#e31b2f/);
});

test("tablet filter drawer never reserves a desktop catalog grid column", () => {
  assert.match(css, /@media\(max-width:1024px\)\{[\s\S]*?\.catalog-layout\{position:relative;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /@media\(max-width:1024px\)\{\.catalog-layout\{grid-template-columns:minmax\(0,1fr\)!important\}/);
});


test("legacy manifesto and generic shoe imagery are removed from the homepage", async () => {
  const hero = await readFile(new URL("../frontend/bf-shoes-hero.svg", import.meta.url), "utf8");
  assert.doesNotMatch(html, /manifesto|Good design|doesn.t need|banner-left-shoe|banner-right-shoe/);
  assert.doesNotMatch(css, /\.manifesto|bf-hero-shoe\.webp|banner-left-shoe|banner-right-shoe/);
  assert.match(css, /url\('\/bf-shoes-hero\.svg'\)/);
  assert.match(hero, /BF SHOES|BF/);
});

test("all secondary pages use the BF SHOES shared theme and CSP-safe external scripts", () => {
  for (const page of pages) {
    assert.match(page, /brand-pages\.css/);
    assert.doesNotMatch(page, /<script>(?!\s*<\/script>)/i);
    assert.doesNotMatch(page, /on(?:click|error|submit)\s*=/i);
  }
});

test("public UPI page does not expose unverified bank account details", () => {
  const upi = pages.at(-1);
  assert.match(upi, /Manual payment is not available yet/);
  assert.doesNotMatch(upi, /9110769425|0054121119|KKBK0007509|Mohammed Faisal Khan/);
});

test("homepage matches the approved first-screen sequence without unapproved filler sections", () => {
  assert.doesNotMatch(html, /Easy by design|Clear delivery terms|Made to move|THE BF LETTER|Good things\.<br \/><em>Occasionally\.|Move different\.<br \/>Keep it simple\.|class="ticker"/);
  assert.match(html, /Shop by Category/);
  assert.match(html, /Find Your Perfect Pair/);
  assert.match(css, /\.category-heading \.category-rule\{display:block/);
});
