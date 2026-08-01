# SokoLedger

A sales-logging tool for informal-economy traders: market vendors, small
shopkeepers, roadside sellers who currently keep no record of what they
sell. A trader speaks or types a sale in their own words ("sold 10 eggs
today by 12pm"); the backend turns that into a structured ledger entry.

## Demo video

[https://youtu.be/G9eDlpBg-BU]

## Live deployment

**App:** https://www.jargsai.tech (also reachable at `https://jargsai.tech`)

**API base URL:** https://www.jargsai.tech/api (e.g. `https://www.jargsai.tech/api/auth/login`,
`https://www.jargsai.tech/api/sales`; see `server/src/routes/` for the full route list)

**AI parsing API used:** https://chatgpt-42.p.rapidapi.com/conversationgpt4-2
(RapidAPI, `chatgpt-42` / MATA-G 2.1 AI, `server/src/services/parser.js`, called
server-side only). This is two separate things people mix up: the browser's own
built-in Web Speech API does the actual listening and turns your voice into
text (`public/js/speech.js`, no server involved). Once that text exists, the
backend sends it to the RapidAPI model above to turn "sold 10 eggs today by
12pm" into `{item, quantity, price, date}`. So: browser does the hearing, the
API above does the understanding.

## Local setup

Requirements: Node.js 18+, Docker (for local Postgres; skip this and swap in
a real Postgres if you already have one).

```bash
git clone <this repo>
cd sokoledger

# Postgres for local dev
docker compose up -d

cd server
cp .env.example .env
# edit .env: at minimum set RAPIDAPI_KEY to your own key
#   https://rapidapi.com/hub (search for a conversational/chat-style API,
#   e.g. "ChatGPT-4"; this app expects a POST endpoint that takes
#   {"messages": [{"role": "user", "content": "..."}]} and returns
#   {"result": "..."})

npm install
npm run migrate     # applies server/src/db/schema.sql, idempotent
npm run dev          # http://localhost:3000
```

Run the test suite:

```bash
npm test
```

### Environment variables (`server/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. `server/src/db/pool.js` auto-detects `localhost`/`127.0.0.1` and only enables TLS for remote hosts, so the same code works locally and against a managed remote Postgres. |
| `RAPIDAPI_KEY` | Server-only, never sent to or read by any frontend code. |
| `RAPIDAPI_URL` | Full URL of the parsing endpoint. Optional, defaults to a `chatgpt-42` conversational endpoint if unset. |
| `SESSION_SECRET` | Signs JWTs. Must be **identical** on web-01 and web-02, or a token issued by one won't verify on the other. |
| `PORT` | Defaults to 3000. |

## Architecture

Single monolith, not a separate frontend/backend split. `server/src/index.js`
is one Express process that serves both the static frontend (`public/`) and
the `/api/*` routes. web-01 and web-02 each run an identical copy of that
same process.

```
                       trader's browser
                              │
                    https://jargsai.tech
                    https://www.jargsai.tech
                              │
                     ┌────────────────┐
                     │      lb-01     │  haproxy, TLS termination
                     │ 54.237.154.102 │  (Let's Encrypt cert, auto-renews),
                     └────────┬───────┘  round robin, active /healthz checks
                        ┌─────┴─────┐
                        ▼           ▼
              ┌────────────────┐ ┌────────────────┐
              │     web-01     │ │     web-02     │   Express + static
              │ 44.201.123.60  │ │ 18.233.154.155 │   frontend, one process,
              │  (Node, pm2)   │ │  (Node, pm2)   │   stateless, JWT auth,
              └────────┬───────┘ └────────┬───────┘   no server-local state
                       └─────────┬─────────┘
                                 ▼
                    Supabase (managed Postgres),
                    via its IPv4 session pooler
```

**What each piece actually does:**

- **`jargsai.tech` / `www.jargsai.tech`** is just a domain name. It doesn't
  run anything, it's a DNS record pointing at lb-01's IP.
- **lb-01** serves none of the app's content. Its only job is to receive
  each request and forward it to whichever of web-01/web-02 is healthy,
  alternating between them.
- **web-01 and web-02** are where the actual work happens. Each one runs
  the **entire** application independently, the full frontend and the full
  API. They are not split by feature (it's not "web-01 handles login,
  web-02 handles the ledger"), they're identical, interchangeable copies of
  the whole app. Either one alone could serve every feature on its own.
  Running two means if one goes down, lb-01 (via its `/healthz` checks)
  routes all traffic to the other and the site stays up.

Database is Supabase, not self-hosted on either app server. Use the
**session pooler** connection string (Project Settings → Database →
Connection Pooling → Session mode), not the direct-connection hostname:
the direct hostname is IPv6-only and won't connect from a typical IPv4-only
host.

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

## Security, validation & error handling

Auth is bcrypt (12 rounds) plus stateless JWTs, 7-day expiry, checked by
`requireAuth` on every `/api/sales/*` and `/api/analytics/*` route. There's no
server-side session store; the token just has to verify against
`SESSION_SECRET`, which is why that value has to be identical on web-01 and
web-02. Every query in `db/queries/sales.js` filters on `user_id`, so one
trader can never see or export another's ledger, and a missing/expired/bad
token gets a `401` before any handler runs.

`helmet()` sets the usual hardening headers, TLS terminates at haproxy with a
real Let's Encrypt cert (see Architecture), and the Postgres connection uses
TLS for any non-local host. Login/register is rate-limited (20 attempts per
15 minutes per IP); sale submission has its own limit, keyed per user instead
of per IP, since the point there is protecting the shared RapidAPI quota, not
blocking brute force. Request bodies are capped at 20kb.

Every database call goes through `pg`'s `$1, $2` placeholders, never string
concatenation. The one spot where user input picks a column instead of a
value, the ledger's `sort` param, goes through a hardcoded whitelist first
(`SORT_COLUMNS` in `db/queries/sales.js`) so it can't turn into arbitrary SQL.

Validation happens at three layers. `middleware/validate.js` type-checks and
bounds every request body server-side, not just relying on the frontend's
`minlength` (which a client can skip entirely). The database schema backs
that up with `NOT NULL`, `UNIQUE`, `CHECK` constraints, and `ON DELETE
CASCADE`. And the AI's response gets the same treatment as any other
untrusted input: `services/parser.js` tries three JSON-extraction strategies
against whatever RapidAPI returns, then type-coerces every field, and
anything that doesn't resolve to a real item, quantity, and price, or comes
back with confidence under 0.5, goes back to the trader to confirm instead of
getting inserted as fact. On the frontend, anything rendered from user data
goes through an `escapeHtml` helper (`entry.js`, `ledger.js`, `analytics.js`)
so a sale entry can't carry HTML into the page.

For errors, route handlers are wrapped in `withValidation`, so a bad request
comes back as a specific `400`, not a stack trace, and anything unexpected
falls through to a top-level handler that logs it and returns a plain `500`.
The one dependency actually expected to fail sometimes is RapidAPI itself: a
`RemoteApiError` is handled differently from "the AI answered but couldn't
parse it". The former gets durably queued in Postgres and retried with
backoff (5s up to 5min, 6 attempts, `FOR UPDATE SKIP LOCKED` so both web
servers can poll it safely) instead of just losing the sale. Duplicate
detection is a soft warning, "you logged this 10 minutes ago, again?", not a
hard block, since a double-tap and a genuine repeat sale look the same to the
backend.

### Testing

```bash
cd server && npm test
```

Node's built-in test runner, three files: parsing/validation logic
(`parser.test.js`), price estimation (`priceInference.test.js`), and SQL
filter building (`queries.test.js`). CI runs this on every push to `main` and
only deploys if it passes.

## Credits

- [RapidAPI ChatGPT-4](https://rapidapi.com) (MATA-G 2.1 AI): `conversationgpt4-2` endpoint used for free-text sale parsing.
- [Express](https://expressjs.com/): HTTP server/routing.
- [pg (node-postgres)](https://node-postgres.com/): Postgres client.
- [Supabase](https://supabase.com/): managed Postgres hosting for production.
- [bcryptjs](https://github.com/dcodeIO/bcrypt.js): password hashing.
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken): stateless JWT auth.
- [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit): rate limiting.
- [helmet](https://helmetjs.github.io/): HTTP security headers.
- [pdfkit](http://pdfkit.org/): PDF statement generation.
- [pm2](https://pm2.keymetrics.io/): Node process manager.
- [HAProxy](https://www.haproxy.org/#docs): load balancer on lb-01.
- [Let's Encrypt](https://letsencrypt.org/) / [Certbot](https://certbot.eff.org/): free TLS certificate, auto-renewing.
- The [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API): client-side speech-to-text, no external service.
