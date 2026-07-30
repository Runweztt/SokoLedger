-- SokoLedger schema. Applied idempotently by migrate.js.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sale_entries (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_text      TEXT NOT NULL,
  item          TEXT NOT NULL,
  quantity      NUMERIC NOT NULL,
  unit_price    NUMERIC,
  total_amount  NUMERIC NOT NULL,
  is_estimated  BOOLEAN NOT NULL DEFAULT false,
  confidence    NUMERIC,
  occurred_at   TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ledger sort/filter/search all key off these; index each independently
-- rather than one composite since the endpoint mixes them freely.
CREATE INDEX IF NOT EXISTS idx_sale_entries_user_occurred ON sale_entries (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_entries_user_item ON sale_entries (user_id, item);

-- Durable queue for RapidAPI outages. Lives in Postgres (not in-process
-- memory) so either app server can pick up a retry — required since
-- web-01/web-02 are stateless and share no memory.
CREATE TABLE IF NOT EXISTS parse_queue (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_text       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parse_queue_pending ON parse_queue (status, next_attempt_at) WHERE status = 'pending';
