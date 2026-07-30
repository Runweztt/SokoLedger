const test = require('node:test');
const assert = require('node:assert/strict');

// pool.js throws at require-time if DATABASE_URL is unset. These tests
// never actually touch the DB (see comments below), but the require
// chain (priceInference -> queries/sales -> pool) still needs it defined.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';

const { resolveUnitPrice, resolveTotalAmount } = require('../src/services/priceInference');

test('resolveUnitPrice keeps an explicitly stated unit price, not estimated', async () => {
  const result = await resolveUnitPrice({ userId: 1, item: 'eggs', unitPrice: 15, totalAmount: null, quantity: 10 });
  assert.deepEqual(result, { unitPrice: 15, isEstimated: false });
});

test('resolveUnitPrice derives unit price from total/quantity without hitting history', async () => {
  const result = await resolveUnitPrice({ userId: 1, item: 'eggs', unitPrice: null, totalAmount: 150, quantity: 10 });
  assert.deepEqual(result, { unitPrice: 15, isEstimated: false });
});

test('resolveTotalAmount prefers a stated total over recomputing it', () => {
  assert.equal(resolveTotalAmount({ unitPrice: 15, totalAmount: 200, quantity: 10 }), 200);
});

test('resolveTotalAmount computes total from unit price and quantity', () => {
  assert.equal(resolveTotalAmount({ unitPrice: 15, totalAmount: null, quantity: 10 }), 150);
});

test('resolveTotalAmount returns null when neither total nor unit price is known', () => {
  assert.equal(resolveTotalAmount({ unitPrice: null, totalAmount: null, quantity: 10 }), null);
});
