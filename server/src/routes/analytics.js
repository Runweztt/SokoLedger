const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { withValidation, ValidationError } = require('../middleware/validate');
const { revenueByBucket, topItems, listAllEntries } = require('../db/queries/sales');
const pool = require('../db/pool');
const { entriesToCsv, streamEntriesToPdf } = require('../services/exporter');

const router = express.Router();
router.use(requireAuth);

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

async function buildSummary({ userId, from, to }) {
  const [byDay, byWeek, byMonth, topItemsResult] = await Promise.all([
    revenueByBucket({ userId, from, to, bucket: 'day' }),
    revenueByBucket({ userId, from, to, bucket: 'week' }),
    revenueByBucket({ userId, from, to, bucket: 'month' }),
    topItems({ userId, from, to, limit: 10 }),
  ]);

  const avgDailyRevenue = average(byDay.map((d) => d.revenue));
  const totalRevenue = byDay.reduce((sum, d) => sum + d.revenue, 0);

  // Month-over-month: compare the two most recent monthly buckets that
  // actually have data. Fewer than two months of history means there's
  // nothing to compare against yet.
  let momTrend = null;
  if (byMonth.length >= 2) {
    const current = byMonth[byMonth.length - 1];
    const previous = byMonth[byMonth.length - 2];
    const pctChange = previous.revenue === 0 ? null : ((current.revenue - previous.revenue) / previous.revenue) * 100;
    momTrend = { current: current.revenue, previous: previous.revenue, pctChange };
  }

  return { byDay, byWeek, byMonth, topItems: topItemsResult, avgDailyRevenue, totalRevenue, momTrend };
}

router.get(
  '/summary',
  withValidation(async (req, res) => {
    const { from, to } = req.query;
    if (from && Number.isNaN(new Date(from).getTime())) {
      throw new ValidationError('"from" must be a valid date');
    }
    if (to && Number.isNaN(new Date(to).getTime())) {
      throw new ValidationError('"to" must be a valid date');
    }
    const summary = await buildSummary({ userId: req.userId, from: from || undefined, to: to || undefined });
    res.json(summary);
  })
);

router.get(
  '/export',
  withValidation(async (req, res) => {
    const { format, from, to, item, q } = req.query;
    if (!['csv', 'pdf'].includes(format)) {
      throw new ValidationError('"format" must be "csv" or "pdf"');
    }

    const rows = await listAllEntries({ userId: req.userId, from: from || undefined, to: to || undefined, item: item || undefined, q: q || undefined });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="sokoledger-statement.csv"');
      return res.send(entriesToCsv(rows));
    }

    const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [req.userId]);
    const summary = await buildSummary({ userId: req.userId, from: from || undefined, to: to || undefined });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="sokoledger-statement.pdf"');
    streamEntriesToPdf(res, {
      username: userResult.rows[0]?.username || 'trader',
      from,
      to,
      summary: { totalRevenue: summary.totalRevenue, avgDailyRevenue: summary.avgDailyRevenue, topItems: summary.topItems },
      rows,
    });
  })
);

module.exports = router;
