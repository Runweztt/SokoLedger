const pool = require('../pool');

const SORT_COLUMNS = {
  date: 'occurred_at',
  item: 'item',
  amount: 'total_amount',
};

// Every filter (ledger view, analytics view, duplicate check) shares this
// builder so a param is only ever validated/escaped in one place.
function buildFilters({ userId, from, to, item, q }) {
  const clauses = ['user_id = $1'];
  const params = [userId];

  if (from) {
    params.push(from);
    clauses.push(`occurred_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`occurred_at <= $${params.length}`);
  }
  if (item) {
    params.push(item);
    clauses.push(`item ILIKE '%' || $${params.length} || '%'`);
  }
  if (q) {
    params.push(q);
    clauses.push(`(item ILIKE '%' || $${params.length} || '%' OR raw_text ILIKE '%' || $${params.length} || '%')`);
  }

  return { where: clauses.join(' AND '), params };
}

async function listEntries({ userId, from, to, item, q, sort = 'date', order = 'desc', page = 1, pageSize = 50 }) {
  const { where, params } = buildFilters({ userId, from, to, item, q });
  const sortCol = SORT_COLUMNS[sort] || SORT_COLUMNS.date;
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  const rowsResult = await pool.query(
    `SELECT id, item, quantity, unit_price, total_amount, is_estimated, confidence, occurred_at, raw_text, created_at
     FROM sale_entries
     WHERE ${where}
     ORDER BY ${sortCol} ${sortOrder}, id ${sortOrder}
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const countResult = await pool.query(
    `SELECT count(*)::int AS total FROM sale_entries WHERE ${where}`,
    params
  );

  return { rows: rowsResult.rows, total: countResult.rows[0].total, page: Math.max(Number(page) || 1, 1), pageSize: limit };
}

async function insertEntry({ userId, rawText, item, quantity, unitPrice, totalAmount, isEstimated, confidence, occurredAt }) {
  const result = await pool.query(
    `INSERT INTO sale_entries (user_id, raw_text, item, quantity, unit_price, total_amount, is_estimated, confidence, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, item, quantity, unit_price, total_amount, is_estimated, confidence, occurred_at, raw_text, created_at`,
    [userId, rawText, item, quantity, unitPrice, totalAmount, isEstimated, confidence, occurredAt]
  );
  return result.rows[0];
}

// Rolling average unit price for this trader's own history of an item, used
// to fill in a missing unit_price rather than leaving the sale unrecorded.
// Only looks at entries where a real (non-estimated) price was recorded, so
// estimates don't compound on estimates.
async function averageUnitPrice(userId, item) {
  const result = await pool.query(
    `SELECT avg(unit_price)::numeric AS avg_price, count(*)::int AS sample_size
     FROM sale_entries
     WHERE user_id = $1 AND item ILIKE $2 AND unit_price IS NOT NULL AND is_estimated = false`,
    [userId, item]
  );
  const row = result.rows[0];
  if (!row || row.sample_size === 0) return null;
  return Number(row.avg_price);
}

// A trader re-submitting the same sentence (voice retry, accidental double
// tap) within a short window shouldn't silently double their revenue.
async function findRecentDuplicate(userId, item, quantity, totalAmount, windowMinutes = 10) {
  const result = await pool.query(
    `SELECT id, item, quantity, total_amount, occurred_at
     FROM sale_entries
     WHERE user_id = $1
       AND item ILIKE $2
       AND quantity = $3
       AND total_amount = $4
       AND created_at >= now() - ($5 || ' minutes')::interval
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, item, quantity, totalAmount, windowMinutes]
  );
  return result.rows[0] || null;
}

const VALID_BUCKETS = new Set(['day', 'week', 'month']);

// Unpaginated, used by CSV/PDF export where a trader needs their whole
// history, not one page of it. Kept separate from listEntries so the
// LIMIT/OFFSET cap on the ledger view stays enforced there.
async function listAllEntries({ userId, from, to, item, q, sort = 'date', order = 'asc' }) {
  const { where, params } = buildFilters({ userId, from, to, item, q });
  const sortCol = SORT_COLUMNS[sort] || SORT_COLUMNS.date;
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const result = await pool.query(
    `SELECT id, item, quantity, unit_price, total_amount, is_estimated, confidence, occurred_at, raw_text, created_at
     FROM sale_entries
     WHERE ${where}
     ORDER BY ${sortCol} ${sortOrder}, id ${sortOrder}`,
    params
  );
  return result.rows;
}

async function revenueByBucket({ userId, from, to, bucket = 'day' }) {
  if (!VALID_BUCKETS.has(bucket)) {
    throw new Error(`Invalid bucket: ${bucket}`);
  }
  const { where, params } = buildFilters({ userId, from, to });
  const result = await pool.query(
    `SELECT date_trunc('${bucket}', occurred_at) AS bucket, sum(total_amount)::numeric AS revenue, count(*)::int AS entry_count
     FROM sale_entries
     WHERE ${where}
     GROUP BY 1
     ORDER BY 1`,
    params
  );
  return result.rows.map((r) => ({ bucket: r.bucket, revenue: Number(r.revenue), entryCount: r.entry_count }));
}

async function topItems({ userId, from, to, limit = 10 }) {
  const { where, params } = buildFilters({ userId, from, to });
  const result = await pool.query(
    `SELECT item, sum(total_amount)::numeric AS revenue, sum(quantity)::numeric AS units_sold
     FROM sale_entries
     WHERE ${where}
     GROUP BY item
     ORDER BY revenue DESC
     LIMIT ${Math.min(Math.max(Number(limit) || 10, 1), 50)}`,
    params
  );
  return result.rows.map((r) => ({ item: r.item, revenue: Number(r.revenue), unitsSold: Number(r.units_sold) }));
}

module.exports = {
  buildFilters,
  listEntries,
  listAllEntries,
  insertEntry,
  averageUnitPrice,
  findRecentDuplicate,
  revenueByBucket,
  topItems,
};
