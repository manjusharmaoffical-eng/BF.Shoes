import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateInventoryValuation } from '../src/finance-math.js';

test('inventory value is withheld if any stocked variant lacks an actual unit cost', () => {
  const result = calculateInventoryValuation({ stockedVariants: 6, totalUnits: 60, missingCostVariants: 6, knownInventoryValueCents: '12500' });
  assert.equal(result.complete, false);
  assert.equal(result.inventory_value_cents, null);
  assert.equal(result.known_inventory_value_cents, '12500');
  assert.equal(result.total_units, 60);
});

test('complete inventory valuation uses exact integer cents', () => {
  const result = calculateInventoryValuation({ stockedVariants: 3, totalUnits: 18, missingCostVariants: 0, knownInventoryValueCents: '125099' });
  assert.equal(result.complete, true);
  assert.equal(result.inventory_value_cents, '125099');
});

test('inventory valuation rejects invalid counts and money', () => {
  assert.throws(() => calculateInventoryValuation({ stockedVariants: -1, totalUnits: 0, missingCostVariants: 0, knownInventoryValueCents: 0 }), /non-negative integer/);
  assert.throws(() => calculateInventoryValuation({ stockedVariants: 4, totalUnits: 3, missingCostVariants: 0, knownInventoryValueCents: 0 }), /inconsistent/);
  assert.throws(() => calculateInventoryValuation({ stockedVariants: 2, totalUnits: 2, missingCostVariants: 3, knownInventoryValueCents: 0 }), /inconsistent/);
  assert.throws(() => calculateInventoryValuation({ stockedVariants: 1, totalUnits: 1, missingCostVariants: 0, knownInventoryValueCents: '-1' }), /non-negative integer/);
});

test('owner finance summary, admin dashboard and CSV expose market-scoped current inventory valuation', async () => {
  const { readFile } = await import('node:fs/promises');
  const finance = await readFile(new URL('../src/finance.js', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../frontend/admin.js', import.meta.url), 'utf8');
  assert.match(finance, /p\.currency=\$1/);
  assert.match(finance, /inventory_value_cents:inventory\.inventory_value_cents/);
  assert.match(finance, /current_stock_units:inventory\.total_units/);
  assert.match(admin, /Current stock units/);
  assert.match(admin, /Inventory value/);
  assert.match(admin, /x\.inventory\?\.complete\?money/);
});
