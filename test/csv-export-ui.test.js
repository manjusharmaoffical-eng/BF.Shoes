import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, js, routes] = await Promise.all([
  readFile(new URL('../frontend/admin.html', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/business.js', import.meta.url), 'utf8')
]);

test('admin exposes separate market selectors for inventory and order CSV exports', () => {
  assert.match(html, /id="inventory-export-currency"/);
  assert.match(html, /id="orders-export-currency"/);
  assert.match(html, /id="export-inventory"/);
  assert.match(html, /id="export-orders"/);
});

test('CSV downloads use the authenticated admin token and private customer-data warning', () => {
  assert.match(js, /Authorization:'Bearer '\+token/);
  assert.match(js, /Keep customer data private/);
});

test('inventory and order exports are owner-only and currency-filtered', () => {
  assert.match(routes, /businessRouter\.get\("\/exports\/inventory\.csv", ownerOnly/);
  assert.match(routes, /businessRouter\.get\("\/exports\/orders\.csv", ownerOnly/);
  assert.match(routes, /currency: z\.enum\(\["INR", "AED"\]\)/);
});

test('finance P&L export preserves incomplete-cost warning and selected market/date scope', async () => {
  const finance = await readFile(new URL('../src/finance.js', import.meta.url), 'utf8');
  assert.match(html, /id="export-finance"/);
  assert.match(js, /\/finance\/export\.csv\?/);
  assert.match(finance, /financeRouter\.get\("\/export\.csv"/);
  assert.match(finance, /Profit withheld because actual sold-unit costs are missing/);
  assert.match(finance, /Invalid date range or currency/);
});

test('all CSV exports write owner audit events before returning customer or finance data', async () => {
  const business = await readFile(new URL('../src/business.js', import.meta.url), 'utf8');
  const finance = await readFile(new URL('../src/finance.js', import.meta.url), 'utf8');
  assert.match(business, /report\.export\.inventory/);
  assert.match(business, /report\.export\.orders/);
  assert.match(finance, /finance\.export\.csv/);
});
