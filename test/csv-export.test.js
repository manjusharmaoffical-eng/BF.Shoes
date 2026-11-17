import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from '../src/csv-export.js';

test('CSV cells quote commas, quotes, newlines and null values safely', () => {
  assert.equal(csvCell('A, "B"'), '"A, ""B"""');
  assert.equal(csvCell('line 1\nline 2'), '"line 1\nline 2"');
  assert.equal(csvCell(null), '""');
});

test('CSV neutralizes spreadsheet formulas in untrusted values', () => {
  for (const value of ['=1+1', '+SUM(A1:A2)', '-2+3', '@cmd', '  =HYPERLINK("x")']) {
    assert.equal(csvCell(value).startsWith('"\''), true);
  }
  assert.equal(csvCell('SKU-123'), '"SKU-123"');
});

test('CSV exports a stable header and CRLF rows', () => {
  assert.equal(toCsv([{ sku: 'BF-1', stock: 3 }], [
    { key: 'sku', label: 'SKU' }, { key: 'stock', label: 'Stock' }
  ]), '"SKU","Stock"\r\n"BF-1","3"\r\n');
});
