const pool = require('../db/pool');
const { parseSaleText, RemoteApiError } = require('../services/parser');
const { resolveAndInsertSale } = require('../services/saleEntry');

const MAX_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 5000;
const BASE_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

function backoffFor(attempts) {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
}

async function enqueue(userId, rawText) {
  await pool.query(
    'INSERT INTO parse_queue (user_id, raw_text) VALUES ($1, $2)',
    [userId, rawText]
  );
}

async function listPending(userId) {
  const result = await pool.query(
    `SELECT id, raw_text, status, attempts, last_error, created_at
     FROM parse_queue
     WHERE user_id = $1 AND status IN ('pending', 'failed')
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

// Claims exactly one due row across however many app instances are
// polling concurrently. FOR UPDATE SKIP LOCKED means a second instance's
// poll simply skips a row another instance already grabbed, instead of
// blocking on it or double-processing it. This is what makes the queue
// safe with two stateless web servers sharing one Postgres.
async function claimNextDue(client) {
  const result = await client.query(
    `SELECT id, user_id, raw_text, attempts
     FROM parse_queue
     WHERE status = 'pending' AND next_attempt_at <= now()
     ORDER BY next_attempt_at
     LIMIT 1
     FOR UPDATE SKIP LOCKED`
  );
  return result.rows[0] || null;
}

async function processOne() {
  const client = await pool.connect();
  let claimed = null;
  try {
    await client.query('BEGIN');
    claimed = await claimNextDue(client);
    if (!claimed) {
      await client.query('COMMIT');
      return false;
    }

    try {
      const parsed = await parseSaleText(claimed.raw_text);

      if (parsed.kind === 'structured') {
        await resolveAndInsertSale({
          userId: claimed.user_id,
          rawText: claimed.raw_text,
          item: parsed.item,
          quantity: parsed.quantity,
          unitPrice: parsed.unitPrice,
          totalAmount: parsed.totalAmount,
          confidence: parsed.confidence,
          occurredAt: parsed.occurredAt,
          skipDuplicateCheck: true,
        });
        await client.query(`UPDATE parse_queue SET status = 'done' WHERE id = $1`, [claimed.id]);
      } else {
        // The API came back but still couldn't confidently parse the
        // sentence. No trader is present to answer a clarifying question
        // right now, so surface it as "needs your input" instead of
        // silently retrying forever.
        const reason = parsed.kind === 'clarify' ? parsed.question : 'Could not understand this sale';
        await client.query(
          `UPDATE parse_queue SET status = 'failed', last_error = $2 WHERE id = $1`,
          [claimed.id, reason]
        );
      }
    } catch (err) {
      if (err instanceof RemoteApiError) {
        const attempts = claimed.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await client.query(
            `UPDATE parse_queue SET status = 'failed', attempts = $2, last_error = $3 WHERE id = $1`,
            [claimed.id, attempts, `Gave up after ${attempts} attempts: ${err.message}`]
          );
        } else {
          await client.query(
            `UPDATE parse_queue
             SET attempts = $2, last_error = $3, next_attempt_at = now() + ($4 || ' milliseconds')::interval
             WHERE id = $1`,
            [claimed.id, attempts, err.message, backoffFor(attempts)]
          );
        }
      } else {
        throw err;
      }
    }

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('parse_queue worker error:', err);
    return false;
  } finally {
    client.release();
  }
}

function startWorker() {
  const timer = setInterval(() => {
    processOne().catch((err) => console.error('parse_queue tick failed:', err));
  }, POLL_INTERVAL_MS);
  timer.unref();
  return timer;
}

// Removes a failed/pending queue row once the trader has resolved it
// themselves through the manual fallback form, so it stops showing up in
// "still working on these" forever.
async function dismiss(userId, id) {
  await pool.query('DELETE FROM parse_queue WHERE id = $1 AND user_id = $2', [id, userId]);
}

module.exports = { enqueue, listPending, processOne, startWorker, dismiss };
