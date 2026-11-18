import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
const root = new URL('../frontend/', import.meta.url);

test('BF SHOES customer website contains 28 separate HTML pages', async () => {
  const files = (await readdir(root)).filter(name => name.endsWith('.html'));
  assert.equal(files.length, 28);
});

test('all 18 added pages have SEO metadata, canonical URLs and a route back to the store', async () => {
  const pages = ['collections','kids','men','women','sports','casual','running','sneakers','watches','eyewear','size-guide','fit-guide','shoe-care','shipping','returns','faq','about','contact'];
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
  const pages = ['collections','kids','men','women','sports','casual','running','sneakers','watches','eyewear'];
  for (const page of pages) {
    const html = await readFile(new URL('../frontend/' + page + '.html', import.meta.url), 'utf8');
    assert.match(html, /data-bf-collection=/, page + ' collection selector');
    assert.match(html, /store-pages\.js/, page + ' collection script');
  }
  assert.match(app, /api\/v1\/store\/products\?market=/);
  assert.match(app, /product\.price_verified \? money/);
  assert.match(app, /v\.stock_verified/);
});

test('homepage navigation and sitemap expose the added customer pages', async () => {
  const html = await readFile(new URL('../frontend/index.html', import.meta.url), 'utf8');
  const sitemap = await readFile(new URL('../frontend/sitemap.xml', import.meta.url), 'utf8');
  for (const page of ['collections','kids','men','women','sports','casual','running','sneakers','watches','eyewear','size-guide','fit-guide','shoe-care','shipping','returns','faq','about','contact']) {
    assert.ok(html.includes('/' + page + '.html') || sitemap.includes('/' + page + '.html'), page + ' discoverability');
    assert.ok(sitemap.includes('https://www.bfshoes.online/' + page + '.html'), page + ' sitemap entry');
  }
});

test('kids collection page filters only products explicitly labelled for kids', async () => {
  const html = await readFile(new URL('../frontend/kids.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../frontend/store-pages.js', import.meta.url), 'utf8');
  assert.match(html, /data-bf-collection="kids"/);
  assert.match(app, /if \(collection === 'kids'\) return audience === 'kids'/);
});

test('cart and checkout URLs open the matching in-page panels without enabling payment', async () => {
  const cart = await readFile(new URL('../frontend/cart.html', import.meta.url), 'utf8');
  const checkout = await readFile(new URL('../frontend/checkout.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../frontend/app.js', import.meta.url), 'utf8');
  assert.match(cart, /http-equiv="refresh" content="0;url=\/#cart"/);
  assert.match(checkout, /http-equiv="refresh" content="0;url=\/#checkout"/);
  assert.match(app, /function openStorefrontPanelFromHash/);
  assert.match(app, /window\.addEventListener\('hashchange', openStorefrontPanelFromHash\)/);
  assert.match(app, /if \(state\.cart\.length\)/);
});
