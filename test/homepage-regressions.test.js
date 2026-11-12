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
  assert.match(html, /WELCOME TO BF SHOES/);
  assert.match(html, /MOVE<br><em>DIFFERENT\.<\/em>/);
  assert.match(html, /bf-shoes-hero\.svg/);
  assert.doesNotMatch(html, /images\.unsplash\.com\/photo-1542291026/);
  assert.match(css, /perspective\(1100px\) rotateY\(-13deg\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)[\s\S]*?\.hero-reference \.hero-product\{animation:none/);
});
