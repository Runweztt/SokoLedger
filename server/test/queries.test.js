const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';

const { buildFilters, revenueByBucket } = require('../src/db/queries/sales');

test('buildFilters always scopes to the given user, params in $-order', () => {
  const { where, params } = buildFilters({ userId: 42 });
  assert.equal(where, 'user_id = $1');
  assert.deepEqual(params, [42]);
});

test('buildFilters adds date range, item, and search clauses without string-concatenating user input', () => {
  const { where, params } = buildFilters({ userId: 1, from: '2026-01-01', to: '2026-02-01', item: 'egg', q: 'market' });
  assert.match(where, /occurred_at >= \$2/);
  assert.match(where, /occurred_at <= \$3/);
  assert.match(where, /item ILIKE '%' \|\| \$4 \|\| '%'/);
  assert.match(where, /raw_text ILIKE '%' \|\| \$5 \|\| '%'/);
  assert.deepEqual(params, [1, '2026-01-01', '2026-02-01', 'egg', 'market']);
});

test('revenueByBucket rejects a bucket outside the day/week/month whitelist before touching the DB', async () => {
  await assert.rejects(() => revenueByBucket({ userId: 1, bucket: 'year' }), /Invalid bucket/);
});
