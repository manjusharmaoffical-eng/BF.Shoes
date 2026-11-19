import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../frontend/styles.css", import.meta.url), "utf8");
const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");

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
  assert.match(css, /\.detail-add\s*\{\s*min-height:44px/);
});

test("homepage welcomes visitors with the local BF signature sneaker hero and responsive 3D styling", () => {
  assert.match(html, /WELCOME TO BF SHOES/);
  assert.match(html, /Be Bold\.<br \/>Be Fast\./);
  assert.doesNotMatch(html, /class="hero-script"/);
  assert.ok(css.includes("url('/assets/bf-home-hero.jpeg')"));
  assert.doesNotMatch(html, /images\.unsplash\.com\/photo-1542291026/);
  assert.match(css, /perspective\(1100px\) rotateY\(-13deg\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)[\s\S]*?\.hero-reference \.hero-product\{animation:none/);
});

test("mobile header lays out all primary navigation links in a visible grid without duplicate footer categories", () => {
  assert.match(css, /@media\(max-width:600px\)[\s\S]*?\.site-header \.main-nav\{[\s\S]*?display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /\.site-header \.main-nav a\{[\s\S]*?justify-content:center/);
  assert.match(html, /class="everyday-nav"[\s\S]*?href="\/collections\.html">COLLECTIONS<\/a>/);
  assert.match(html, /class="everyday-nav"[\s\S]*?href="\/men\.html">MEN<\/a>/);
  assert.match(html, /class="everyday-nav"[\s\S]*?href="\/women\.html">WOMEN<\/a>/);
  const footer = html.slice(html.indexOf('<div class="footer-bottom">'), html.indexOf('</div>', html.indexOf('<div class="footer-bottom">')) + 6);
  for (const href of ['/men.html', '/women.html', '/collections.html']) {
    assert.equal(footer.split('href="' + href + '"').length - 1, 0);
  }
  assert.match(html, /class="main-nav"[\s\S]*?href="\/about\.html">About<\/a>/);
});

test("mobile market selector has readable foreground and background contrast", () => {
  assert.match(css, /\.site-header \.market-select\{[\s\S]*?background:#fff;color:#111;border-color:#e31b2f/);
});

test("product cards expose an accessible persistent Font Awesome wishlist and real optional MRP", () => {
  assert.match(app, /localStorage\.setItem\('bf-shoes-wishlist'/);
  assert.match(app, /fa-heart/);
  assert.match(app, /fa-solid/);
  assert.match(app, /fa-regular/);
  assert.match(app, /aria-pressed="\$\{watched\}"/);
  assert.match(app, /product\.mrp_cents/);
  assert.match(app, /product-price-wrap/);
  assert.match(html, /id="header-wishlist"><i class="fa-regular fa-heart"/);
  assert.match(css, /\.wishlist-toggle\.saved\{background:#fff;border-color:#ffd1d7;color:var\(--bf-red\)\}/);
  assert.match(css, /@media\(max-width:1024px\)\{\.product-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/);
  assert.match(css, /@media\(max-width:480px\)\{\.product-grid\{grid-template-columns:minmax\(0,1fr\)/);
});

test("product detail gallery uses a public read-only endpoint, not owner-only AI Studio", () => {
  assert.match(storefront, /storefrontRouter\.get\("\/products\/:id\/images"/);
  assert.match(storefront, /SELECT pi\.image_url, pi\.alt_text[\s\S]*?FROM product_images pi[\s\S]*?p\.active = true/);
  assert.match(app, /\/api\/v1\/store\/products\//);
  assert.doesNotMatch(app, /\/api\/v1\/ai-studio\/products\//);
});

test("homepage keeps shoe size and colour selection inside the product details view", () => {
  assert.doesNotMatch(html, /<details open><summary>(?:Size|Color)<\/summary>/);
  assert.doesNotMatch(app, /data-size-product=/);
  assert.doesNotMatch(app, /<button class="quick-add"/);
  assert.match(app, /data-detail-size=/);
  assert.match(app, /data-detail-color=/);
  assert.match(app, /View details &amp; options/);
});

test("shop category navigation stays a responsive tile grid instead of a horizontal scroller", () => {
  assert.ok(html.includes('class="everyday-nav"'));
  assert.ok(html.includes('href="/men.html">MEN</a>'));
  assert.ok(html.includes('href="/women.html">WOMEN</a>'));
  assert.ok(html.includes('href="/kids.html">KIDS</a>'));
  assert.ok(css.includes('.everyday-nav-links { display:grid; overflow:visible; flex-wrap:initial; }'));
  assert.ok(css.includes('@media (min-width:1101px) { .everyday-nav-links { grid-template-columns:repeat(6,minmax(0,1fr)); } }'));
  assert.ok(css.includes('@media (min-width:601px) and (max-width:1100px) { .everyday-nav-links { grid-template-columns:repeat(4,minmax(0,1fr)); } }'));
  assert.ok(css.includes('@media (max-width:600px) { .everyday-nav-links { grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; } }'));
  const finalGridRules = css.slice(css.lastIndexOf("Keep category navigation as real tiles"));
  assert.ok(!finalGridRules.includes("overflow-x:auto"));
  assert.ok(!finalGridRules.includes("flex-wrap:nowrap"));
});

test("delivery trust strip follows the selected market without inventing UAE coverage or fees", () => {
  assert.match(html, /id="market-delivery-heading">INDIA DELIVERY/);
  assert.match(html, /id="market-delivery-detail">PIN 500052 · Delivery fee pending confirmation/);
  assert.match(app, /deliveryHeading\.textContent = isIndia \? 'INDIA DELIVERY' : 'UAE DELIVERY'/);
  assert.match(app, /deliveryDetail\.textContent = isIndia \? 'PIN 500052 · Delivery fee pending confirmation' : 'UAE delivery coverage and fee pending confirmation'/);
  assert.match(app, /updateCheckoutMarketForm\(\);\s*loadProducts\(\);\s*loadCheckoutReadiness\(\);/);
});
