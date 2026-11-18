import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
const root = new URL('../frontend/', import.meta.url);

test('BF SHOES customer website contains 28 separate HTML pages', async () => {
  const files = (await readdir(root)).filter(name => name.endsWith('.html'));
  assert.equal(files.length, 28);
});

test('all 18 added pages have SEO metadata, canonical URLs and a route back to the store', async () => {
  const pages = ['collections','men','women','kids','sports','casual','running','sneakers','watches','eyewear','size-guide','fit-guide','shoe-care','shipping','returns','faq','about','contact'];
  for (const page of pages) {
    const html = await readFile(new URL('../frontend/' + page + '.html', import.meta.url), 'utf8');
    assert.match(html, /<title>[^<]+<\/title>/, page + ' title');
    assert.match(html, /name="description"/, page + ' description');
    assert.match(html, /rel="canonical"/, page + ' canonical');
    assert.match(html, /href="\/">/, page + ' home link');
    assert.match(html, /store-pages\.css/, page + ' shared design system');
  }
});

test('collection pages load live market-specific catalogue data without inventing price or stock', async () => {
  const app = await readFile(new URL('../frontend/store-pages.js', import.meta.url), 'utf8');
  const pages = ['collections','men','women','kids','sports','casual','running','sneakers','watches','eyewear'];
  for (const page of pages) {
    const html = await readFile(new URL('../frontend/' + page + '.html', import.meta.url), 'utf8');
    assert.match(html, /data-bf-collection=/, page + ' collection selector');
    assert.match(html, /store-pages\.js/, page + ' collection script');
  }
  assert.match(app, /api\/v1\/store\/products\?market=/);
  assert.match(app, /product\.price_verified \? money/);
  assert.match(app, /v\.stock_verified/);
});

test('direct cart and checkout URLs safely open the matching in-page overlay', async () => {
  const app = await readFile(new URL('../frontend/app.js', import.meta.url), 'utf8');
  const cart = await readFile(new URL('../frontend/cart.html', import.meta.url), 'utf8');
  const checkout = await readFile(new URL('../frontend/checkout.html', import.meta.url), 'utf8');
  assert.ok(app.includes("window.location.hash === '#cart'"));
  assert.ok(app.includes("window.location.hash === '#checkout'"));
  assert.ok(cart.includes("window.location.search + '#cart'"));
  assert.ok(checkout.includes("window.location.search + '#checkout'"));
  assert.ok(checkout.includes('Checkout remains unavailable'));
  assert.ok(app.includes('if (!storefrontProductsReady) return;'));
  assert.ok(app.includes('loadProducts().then(() =>'));
  assert.ok(app.includes('if (state.cart.length)'));
});

test('kids collection only includes products explicitly labelled for kids', async () => {
  const app = await readFile(new URL('../frontend/store-pages.js', import.meta.url), 'utf8');
  assert.match(app, /if \(collection === 'kids'\) return audience === 'kids'/);
});

test('homepage and collection pages honour explicit market URLs and same-origin product images', async () => {
  const app = await readFile(new URL('../frontend/app.js', import.meta.url), 'utf8');
  const collection = await readFile(new URL('../frontend/store-pages.js', import.meta.url), 'utf8');
  assert.ok(app.includes("new URLSearchParams(window.location.search).get('market')"));
  assert.ok(app.includes("localStorage.setItem('bf-market', savedMarket)"));
  assert.ok(collection.includes("new URLSearchParams(window.location.search).get('market')"));
  assert.ok(collection.includes("parsed.hostname === 'bf-shoes.vercel.app'"));
  assert.ok(collection.includes("parsed.origin === window.location.origin"));
});

test('main category links render as a responsive grid and include Men, Women and Kids', async () => {
  const html = await readFile(new URL('../frontend/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../frontend/styles.css', import.meta.url), 'utf8');
  const start = html.indexOf('<nav class="everyday-nav"');
  const nav = html.slice(start, html.indexOf('</nav>', start) + 6);
  for (const href of ['/men.html','/women.html','/kids.html']) assert.ok(nav.includes('href="' + href + '"'));
  assert.ok(css.includes('.everyday-nav-links { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:6px; }'));
  assert.ok(css.includes('.everyday-nav-links { grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; overflow:visible; padding:0; }'));
});

test('tablet header keeps market, account and wishlist controls visible', async () => {
  const css = await readFile(new URL('../frontend/styles.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.site-header .market-select { display:inline-flex; }'));
  assert.ok(css.includes('.site-header .header-icon { display:inline-flex; }'));
});

test('homepage navigation and sitemap expose the added customer pages', async () => {
  const html = await readFile(new URL('../frontend/index.html', import.meta.url), 'utf8');
  const sitemap = await readFile(new URL('../frontend/sitemap.xml', import.meta.url), 'utf8');
  for (const page of ['collections','men','women','kids','sports','casual','running','sneakers','watches','eyewear','size-guide','fit-guide','shoe-care','shipping','returns','faq','about','contact']) {
    assert.ok(html.includes('/' + page + '.html') || sitemap.includes('/' + page + '.html'), page + ' discoverability');
    assert.ok(sitemap.includes('https://www.bfshoes.online/' + page + '.html'), page + ' sitemap entry');
  }
});
