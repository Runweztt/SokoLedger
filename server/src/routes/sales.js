const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { parseLimiter } = require('../middleware/rateLimit');
const { withValidation, requireString, optionalString, requireNumber, optionalNumber, ValidationError } = require('../middleware/validate');
const { listEntries } = require('../db/queries/sales');
const { parseSaleText, RemoteApiError } = require('../services/parser');
const { resolveAndInsertSale } = require('../services/saleEntry');
const parseQueue = require('../queue/parseQueue');

const router = express.Router();
router.use(requireAuth);

const SORT_FIELDS = new Set(['date', 'item', 'amount']);

router.post(
  '/parse',
  parseLimiter,
  withValidation(async (req, res) => {
    const text = requireString(req.body, 'text', { minLength: 2, maxLength: 500 });

    let parsed;
    try {
      parsed = await parseSaleText(text);
    } catch (err) {
      if (err instanceof RemoteApiError) {
        await parseQueue.enqueue(req.userId, text);
        return res.status(202).json({
          status: 'queued',
          message: "Saved, we'll finish processing it shortly.",
        });
      }
      throw err;
    }

    if (parsed.kind === 'clarify') {
      return res.json({ status: 'clarify', question: parsed.question, partial: parsed.partial });
    }
    if (parsed.kind === 'unparseable') {
      return res.json({
        status: 'unparseable',
        message: "Couldn't quite understand that sale, fill in what's missing below.",
        partial: null,
      });
    }

    const result = await resolveAndInsertSale({
      userId: req.userId,
      rawText: text,
      item: parsed.item,
      quantity: parsed.quantity,
      unitPrice: parsed.unitPrice,
      totalAmount: parsed.totalAmount,
      confidence: parsed.confidence,
      occurredAt: parsed.occurredAt,
    });

    if (result.status === 'clarify') {
      return res.json({ status: 'clarify', question: result.question, partial: parsed });
    }
    if (result.status === 'duplicate') {
      return res.json({
        status: 'duplicate',
        message: 'Looks like you already logged this a few minutes ago. Log it again anyway?',
        duplicate: result.duplicate,
        partial: parsed,
      });
    }
    res.status(201).json({ status: 'inserted', entry: result.entry });
  })
);

// Covers the fallback form after an unparseable/clarify response, and
// confirming a flagged duplicate (force: true). One insert path shared
// with /parse so there is a single place price inference/duplicate logic
// lives (see services/saleEntry.js).
router.post(
  '/manual',
  withValidation(async (req, res) => {
    const item = requireString(req.body, 'item', { minLength: 1, maxLength: 200 });
    const quantity = requireNumber(req.body, 'quantity', { min: 0.001 });
    const unitPrice = optionalNumber(req.body, 'unitPrice', { min: 0 });
    const totalAmount = optionalNumber(req.body, 'totalAmount', { min: 0 });
    const rawText = optionalString(req.body, 'rawText', { maxLength: 500 }) || `${quantity} ${item}`;
    const force = req.body.force === true;
    const occurredAt = req.body.occurredAt ? new Date(req.body.occurredAt) : new Date();

    if (Number.isNaN(occurredAt.getTime())) {
      throw new ValidationError('"occurredAt" must be a valid date');
    }

    // Deliberately does NOT require unitPrice/totalAmount here: leaving
    // both blank is valid when this item has enough history for
    // resolveAndInsertSale to fill in a rolling-average estimate. It only
    // comes back as "clarify" below when there's truly no price to go on.
    const result = await resolveAndInsertSale({
      userId: req.userId,
      rawText,
      item,
      quantity,
      unitPrice,
      totalAmount,
      confidence: null,
      occurredAt,
      force,
    });

    if (result.status === 'clarify') {
      return res.json({ status: 'clarify', question: result.question });
    }
    if (result.status === 'duplicate') {
      return res.json({
        status: 'duplicate',
        message: 'Looks like you already logged this a few minutes ago. Log it again anyway?',
        duplicate: result.duplicate,
      });
    }
    res.status(201).json({ status: 'inserted', entry: result.entry });
  })
);

router.get(
  '/',
  withValidation(async (req, res) => {
    const { from, to, item, q, sort, order, page, pageSize } = req.query;

    if (sort && !SORT_FIELDS.has(sort)) {
      throw new ValidationError(`"sort" must be one of: ${[...SORT_FIELDS].join(', ')}`);
    }
    if (order && !['asc', 'desc'].includes(order)) {
      throw new ValidationError('"order" must be "asc" or "desc"');
    }
    if (from && Number.isNaN(new Date(from).getTime())) {
      throw new ValidationError('"from" must be a valid date');
    }
    if (to && Number.isNaN(new Date(to).getTime())) {
      throw new ValidationError('"to" must be a valid date');
    }

    const result = await listEntries({
      userId: req.userId,
      from: from || undefined,
      to: to || undefined,
      item: item || undefined,
      q: q || undefined,
      sort,
      order,
      page,
      pageSize,
    });
    res.json(result);
  })
);

router.get(
  '/pending',
  withValidation(async (req, res) => {
    const rows = await parseQueue.listPending(req.userId);
    res.json({ rows });
  })
);

router.delete(
  '/pending/:id',
  withValidation(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw new ValidationError('Invalid queue item id');
    }
    await parseQueue.dismiss(req.userId, id);
    res.status(204).end();
  })
);

module.exports = router;
