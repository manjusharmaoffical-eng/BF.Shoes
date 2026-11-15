import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransitionReturnStatus, validateReturnItems } from '../src/return-workflow.js';

const orderItems = [
  { id: 'item-1', quantity: 2 },
  { id: 'item-2', quantity: 1 }
];

test('return workflow permits only forward review transitions', () => {
  assert.equal(canTransitionReturnStatus('requested', 'under_review'), true);
  assert.equal(canTransitionReturnStatus('under_review', 'approved'), true);
  assert.equal(canTransitionReturnStatus('approved', 'received'), true);
  assert.equal(canTransitionReturnStatus('received', 'completed'), true);
  assert.equal(canTransitionReturnStatus('completed', 'approved'), false);
  assert.equal(canTransitionReturnStatus('rejected', 'under_review'), false);
  assert.equal(canTransitionReturnStatus('requested', 'completed'), false);
});

test('return item selection allows valid partial quantities', () => {
  assert.deepEqual(validateReturnItems([
    { order_item_id: 'item-1', quantity: 1 }
  ], orderItems, 'return'), [
    { order_item_id: 'item-1', quantity: 1, requested_size: '' }
  ]);
});

test('exchange request requires a requested size for each selected item', () => {
  assert.throws(() => validateReturnItems([
    { order_item_id: 'item-1', quantity: 1 }
  ], orderItems, 'exchange'), /requested exchange size/);
  assert.deepEqual(validateReturnItems([
    { order_item_id: 'item-1', quantity: 1, requested_size: '42' }
  ], orderItems, 'exchange')[0].requested_size, '42');
});

test('return item selection rejects foreign, duplicate and excessive quantities', () => {
  assert.throws(() => validateReturnItems([{ order_item_id: 'other', quantity: 1 }], orderItems, 'return'), /does not belong/);
  assert.throws(() => validateReturnItems([
    { order_item_id: 'item-1', quantity: 1 },
    { order_item_id: 'item-1', quantity: 1 }
  ], orderItems, 'return'), /unique and valid/);
  assert.throws(() => validateReturnItems([{ order_item_id: 'item-1', quantity: 3 }], orderItems, 'return'), /exceeds/);
});

test('return workflow does not initiate a refund, fee or inventory mutation', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/returns.js', import.meta.url), 'utf8');
  assert.match(source, /No refund, fee or stock change/);
  assert.doesNotMatch(source, /UPDATE variants|INSERT INTO inventory_movements|refund_payment|createRefund/i);
});
