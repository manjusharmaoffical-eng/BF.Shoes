import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../frontend/styles.css", import.meta.url), "utf8");
const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

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

test("homepage welcomes visitors with the local BF signature sneaker hero and responsive 3D styling", () => {
  assert.match(html, /PREMIUM FOOTWEAR/);
  assert.match(html, /<span class="hero-bf">BF<\/span> SHOES/);
  assert.match(html, /STEP UP YOUR <em>STYLE<\/em>/);
  assert.match(html, /class="category-cards"[\s\S]*?category-men[\s\S]*?category-women[\s\S]*?category-sports[\s\S]*?category-casual/);
  assert.match(html, /class="benefit-strip"/);
  assert.ok(css.includes("url('/bf-shoes-hero.svg')"));
  assert.doesNotMatch(html, /images\.unsplash\.com\/photo-1542291026/);
  assert.match(css, /perspective\(1100px\) rotateY\(-13deg\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)[\s\S]*?\.hero-reference \.hero-product\{animation:none/);
});

test("mobile header lays out all primary navigation links in a visible grid", () => {
  assert.match(css, /@media\(max-width:600px\)[\s\S]*?\.site-header \.main-nav\{[\s\S]*?display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /\.site-header \.main-nav a\{[\s\S]*?justify-content:center/);
  assert.match(html, /href="#shop">Sale<\/a><a href="#story">About<\/a>/);
});

test("mobile market selector has readable foreground and background contrast", () => {
  assert.match(css, /\.site-header \.market-select\{[\s\S]*?background:#fff;color:#111;border-color:#e31b2f/);
});
