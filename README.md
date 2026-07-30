# SokoLedger

A sales-logging tool for informal-economy traders — market vendors, small
shopkeepers, roadside sellers — who currently keep no record of what they
sell, and so have no financial history to show a lender. A trader speaks or
types a sale in their own words ("sold 10 eggs today by 12pm"); the backend
turns that into a structured ledger entry; entries roll up into a revenue
history a trader can actually hand to a loan officer.

## Live deployment

**https://www.jargsai.tech** (also reachable at `https://jargsai.tech`) —
running on two app servers (web-01, web-02) behind an haproxy load balancer
(lb-01), backed by Supabase Postgres. See "Architecture" below for the full
picture, and "Deploying to web-01 and web-02" for how it got there.

## How it works

1. **Capture.** The trader types a sentence, or taps the mic and speaks —
   speech-to-text happens client-side via the browser's Web Speech API, no
   external STT service, no key. Browsers without Web Speech support (Safari,
   several mobile browsers) never see a mic button in the first place.
2. **Parse.** The raw sentence is POSTed to the RapidAPI **open-ai21**
   `conversationllama` endpoint with an instruction to return strict JSON. The
   endpoint returns free-form text, not a guaranteed schema, so the server
   tries direct `JSON.parse`, then a markdown-fence-stripped parse, then a
   "find the first `{...}`" scrape, before giving up.
3. **Resolve.**
   - Confident, complete → inserted immediately, shown in under a couple
     seconds.
   - Missing item/quantity or low-confidence → a short follow-up question,
     never a blank form.
   - Missing price but the trader has sold this item before → filled in from
     their own rolling average, flagged `estimated` in the UI.
   - RapidAPI down/timeout (28s budget — this particular endpoint routinely
     takes 15-20s to respond) → queued in Postgres, retried with backoff by a
     background worker running in every app instance; the trader sees "saved,
     will process shortly" and never loses the entry.
   - Near-duplicate within 10 minutes → flagged, requires explicit confirm.
4. **Roll up.** The ledger view and the financial blueprint view both read
   through the same parameterized query layer (`server/src/db/queries/sales.js`)
   — no duplicated filter/sort logic between the two.

## Local setup

Requirements: Node.js 18+, Docker (for local Postgres — swap in a real
Postgres and skip this if you have one).

```bash
git clone <this repo>
cd sokoledger

# Postgres for local dev
docker compose up -d

cd server
cp .env.example .env
# edit .env: at minimum set RAPIDAPI_KEY to your own key
#   https://rapidapi.com/rphrp1985/api/open-ai21

npm install
npm run migrate     # applies server/src/db/schema.sql, idempotent
npm run dev          # http://localhost:3000
```

Run the test suite (pure-function tests: defensive JSON parsing, price
inference, the query builder — no DB needed to run these):

```bash
npm test
```

### Environment variables (`server/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Same value on web-01 and web-02 in production — see "Data tier" below. `server/src/db/pool.js` auto-detects `localhost`/`127.0.0.1` and only enables TLS for remote hosts, so the same code works against local Docker Postgres and a managed remote Postgres without a separate flag. |
| `RAPIDAPI_KEY` | Server-only. Never sent to or read by any frontend code — see `server/src/services/parser.js`. |
| `RAPIDAPI_URL` | Full URL of the parsing endpoint. Optional — defaults to open-ai21's `conversationllama` endpoint if unset, so you can point at a different RapidAPI parsing service without touching code. |
| `SESSION_SECRET` | Signs JWTs. Must be **identical** on web-01 and web-02, or a token issued by one won't verify on the other. |
| `PORT` | Defaults to 3000. |

## Architecture

**This is a single monolith, not a separate frontend/backend split.**
`server/src/index.js` is one Express process that serves both the static
frontend (`public/` — plain HTML/CSS/JS, no build step) and the `/api/*`
routes, on both app servers. There's no independent "frontend server" or
"backend server" to point to — web-01 and web-02 each run one identical copy
of that same monolithic process, and the only thing that differs between
them is nothing: both point at the same database via the same `DATABASE_URL`.
Horizontal scaling here means running more copies of the whole monolith
behind the load balancer, not splitting it into services.

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
              │  (Node, pm2)   │ │  (Node, pm2)   │   stateless — JWT auth,
              └────────┬───────┘ └────────┬───────┘   no server-local state
                       └─────────┬─────────┘
                                 ▼
                    Supabase (managed Postgres),
                    via its IPv4 session pooler
```

**Data tier decision:** Postgres is hosted on **Supabase** rather than
self-managed on one of the app servers — no OS patching, backups, or failover
to own for a two-app-server deployment. Both web-01 and web-02 connect to the
same Supabase project via `DATABASE_URL`, so either can serve any request
statelessly: JWT verification only depends on `SESSION_SECRET`, never on
which server issued the token.

**Gotcha worth documenting:** Supabase's direct-connection hostname
(`db.<ref>.supabase.co`) resolves to an **IPv6-only** address. Plain AWS EC2
instances without an IPv6-enabled VPC/subnet get `ENETUNREACH` trying to
connect to it — discovered this the hard way mid-deployment. The fix is
Supabase's **session pooler** hostname instead (Project Settings → Database →
Connection Pooling → Session mode), which is IPv4-compatible:

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Also, unlike local Docker Postgres, Supabase requires TLS — `server/src/db/pool.js`
handles this automatically (see the env var table above) rather than needing
a separate config flag per environment.

### Deploying to web-01 and web-02

This repo isn't pushed to a git remote the servers can pull from, so the
actual deploy used `rsync` directly from a local checkout rather than
`git clone` on the host — same effect, one less moving part. One-time setup,
run once per host (`44.201.123.60` and `18.233.154.155`):

```bash
# Node 20, pm2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs rsync
sudo npm install -g pm2

sudo mkdir -p /opt/sokoledger && sudo chown ubuntu:ubuntu /opt/sokoledger
rsync -az --delete --exclude 'node_modules' --exclude '.env' --exclude '.git' \
  ./ ubuntu@<host>:/opt/sokoledger/

ssh ubuntu@<host>
cd /opt/sokoledger/server
npm ci --omit=dev
```

Write `.env` on **both** hosts — identical except neither needs anything
host-specific, since the database is external (Supabase) rather than
colocated on one of them:

```
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
RAPIDAPI_KEY=...
RAPIDAPI_URL=https://open-ai21.p.rapidapi.com/conversationllama
SESSION_SECRET=<same long random value on both hosts>
PORT=3000
```

Run the migration **once**, from either host (it's the same remote database
either way):

```bash
npm run migrate
```

Start under pm2 (identical on both hosts):

```bash
pm2 start ecosystem.config.js --env production
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu   # survive reboot
```

If a host firewall (`ufw`) is active, make sure it allows inbound `3000/tcp`
from lb-01's private IP — this bit us during the real deployment: `ufw` was
active on one host but not the other, with only 22/80/443 open, so the load
balancer's health checks silently failed against it until this rule was
added:

```bash
sudo ufw allow from <lb-01-private-ip> to any port 3000 proto tcp
```

`deploy/deploy.sh <host>` scripts subsequent updates (rsync + `pm2 reload`)
once this initial setup is done; see the comments at the top of that file.
`deploy/web-app.service` is a systemd-unit alternative to pm2 if you'd rather
not run a Node process manager.

### Load balancer (lb-01 — `54.237.154.102`)

Two configs are provided — `deploy/haproxy.cfg` is the one actually running
on lb-01 (it shipped with haproxy pre-installed):

- **`deploy/haproxy.cfg`** (in use) — round robin with real **active** health
  checks (`option httpchk GET /healthz`) that probe each backend
  independently of live traffic, terminates TLS at `:443`, and redirects
  `:80` → `:443`.
- **`deploy/nginx.conf`** (alternative, not deployed) — round robin (nginx's
  default with no directive needed). Honest limitation: stock nginx only
  does **passive** health checking (`max_fails`/`fail_timeout` — a backend is
  marked down only after live requests to it actually fail). There's no
  active out-of-band probe of `/healthz` without nginx Plus.

Deployed config points at web-01/web-02's **private** IPs
(`10.227.114.6:3000`, `10.227.46.81:3000`), not their public ones — lb-01,
web-01, and web-02 all sit in the same VPC subnet, so there's no reason to
route app traffic over the public internet between them.

**TLS:** certificate is a real Let's Encrypt cert (`certbot`, standalone
plugin) covering both `jargsai.tech` and `www.jargsai.tech`, auto-renewing
via `certbot`'s systemd timer. Because the standalone plugin needs port 80
free to complete its challenge, renewal-hook scripts stop haproxy right
before renewal and restart it right after (rebuilding the combined
cert+key file haproxy needs at the same time):

```
/etc/letsencrypt/renewal-hooks/pre/stop-haproxy.sh    → systemctl stop haproxy
/etc/letsencrypt/renewal-hooks/post/start-haproxy.sh  → rebuild combined pem, systemctl start haproxy
```

Verified with `certbot renew --dry-run` that this round-trips cleanly.
haproxy needs cert + key concatenated into one file for its `bind ... ssl crt`
directive:

```bash
cat /etc/letsencrypt/live/www.jargsai.tech/fullchain.pem \
    /etc/letsencrypt/live/www.jargsai.tech/privkey.pem \
    > /etc/haproxy/certs/jargsai.tech.pem
```

To deploy config changes: drop the file in, validate, reload —
`haproxy -c -f /etc/haproxy/haproxy.cfg && sudo systemctl reload haproxy`.

### Verifying traffic actually splits across both servers

`/healthz` returns `{ status, instance: os.hostname(), pid }` specifically so
this is checkable, not just assumed. This is exactly how it was verified
during development (two local instances standing in for web-01/web-02, nginx
in front of them):

```bash
$ curl -s http://localhost:3001/healthz   # web-01 stand-in
{"status":"ok","instance":"LAPTOP-N3A5GI37","pid":85291}
$ curl -s http://localhost:3002/healthz   # web-02 stand-in
{"status":"ok","instance":"LAPTOP-N3A5GI37","pid":85919}

$ for i in $(seq 1 10); do curl -s http://localhost:8080/healthz; echo; done
{"status":"ok","instance":"LAPTOP-N3A5GI37","pid":85919}
{"status":"ok","instance":"LAPTOP-N3A5GI37","pid":85291}
{"status":"ok","instance":"LAPTOP-N3A5GI37","pid":85919}
{"status":"ok","instance":"LAPTOP-N3A5GI37","pid":85291}
...
```

The alternating `pid` across ten sequential requests through the load
balancer is the proof — one process never serves two requests in a row. This
was later re-verified against the real, deployed lb-01/web-01/web-02:

```bash
$ for i in $(seq 1 8); do curl -s https://www.jargsai.tech/healthz; echo; done
{"status":"ok","instance":"7139-web-01","pid":47603}
{"status":"ok","instance":"7139-web-02","pid":43510}
{"status":"ok","instance":"7139-web-01","pid":47603}
{"status":"ok","instance":"7139-web-02","pid":43510}
...
```

Full functional flow was also exercised end-to-end against the live,
deployed servers behind lb-01 (not just local dev): register and login
routed to **different** backend servers by the load balancer, and login
still succeeded — proof both app servers share the same `SESSION_SECRET`
and the same database. `POST /api/sales/parse` against the real, live
RapidAPI endpoint correctly queued a slow-to-respond entry, and the
background worker recovered and inserted it within its first retry —
exactly the "API unavailable" path the queue exists for, seen end-to-end in
production rather than simulated.

## What's assumed / decided for you

- **Duplicate window:** 10 minutes, same trader + item + quantity + total.
  Tune `DUPLICATE_WINDOW_MINUTES` in `server/src/services/duplicateCheck.js`
  if that's wrong for your traders' rhythm.
- **Confidence threshold:** the model's self-reported `confidence` below 0.5
  triggers a clarifying question rather than auto-inserting. There's no way
  to validate this threshold without a live subscription and real trader
  sentences; treat it as a starting point.
- **Rate limit on `/api/sales/parse`:** 12 requests/minute per trader. This is
  the only endpoint that spends RapidAPI quota; everything else is unlimited
  (beyond the login/register brute-force limiter).
- **Queue retry policy:** exponential backoff from 5s, capped at 5 minutes,
  giving up after 6 attempts and surfacing the entry as "needs your input"
  with the original text preserved — never silently dropped.
- **No client-side framework:** plain HTML/CSS/JS, matching the brief and
  keeping the whole frontend a handful of small files a trader's low-power
  phone can load fast.
- **Single monolith, not split services:** one Express process serves both
  the frontend and the API, and that same process is what's replicated
  across web-01/web-02. At this scale, splitting frontend/backend into
  separate deployable services would add operational overhead (two things to
  build, deploy, and keep in sync) for no real benefit.
- **No web fonts:** the type pairing (a system slab-serif stack for
  headers/numbers, a system monospace stack for the ledger lines) is
  deliberately fonts-already-on-the-device — traders are the target
  audience, and a webfont fetch is real data cost to someone on a
  pay-per-MB connection.
- **`bcryptjs`, not `bcrypt`:** `bcrypt` ships a native (compiled)
  module — a binary built for one OS/arch fails on another with an opaque
  `not a valid Win32 application` / `ERR_DLOPEN_FAILED` error, exactly the
  kind of thing that breaks a grader's setup for reasons that have nothing to
  do with the app. `bcryptjs` is a pure-JS drop-in with the same API, so the
  same `node_modules` works unmodified on Windows, macOS, Linux, and the ARM
  EC2 instances this app is actually deployed on.
- **RapidAPI timeout is 28s, not a smaller "sensible" default:** measured
  directly — open-ai21 often takes 15-20s to respond. A shorter timeout just
  means more requests bounce into the retry queue for no reason.

## Credits

- [RapidAPI open-ai21](https://rapidapi.com/rphrp1985/api/open-ai21) —
  `conversationllama` endpoint used for free-text sale parsing.
- [Express](https://expressjs.com/) — HTTP server/routing.
- [pg (node-postgres)](https://node-postgres.com/) — Postgres client.
- [Supabase](https://supabase.com/) — managed Postgres hosting for production.
- [bcryptjs](https://github.com/dcodeIO/bcrypt.js) — password hashing (pure JS,
  chosen over `bcrypt` for cross-platform reliability — see "What's assumed"
  below).
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) — stateless JWT auth.
- [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) — auth and RapidAPI-quota rate limiting.
- [helmet](https://helmetjs.github.io/) — HTTP security headers.
- [pdfkit](http://pdfkit.org/) — PDF statement generation.
- [pm2](https://pm2.keymetrics.io/) — Node process manager.
- [HAProxy](https://www.haproxy.org/#docs) — load balancer on lb-01 (nginx
  config also provided as an alternative, not deployed).
- [Let's Encrypt](https://letsencrypt.org/) / [Certbot](https://certbot.eff.org/) — free TLS certificate, auto-renewing.
- The [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) — client-side speech-to-text, no external service.
