const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// Local Docker Postgres doesn't speak TLS; remote hosts (Supabase, RDS, etc.)
// require it. Sniff by host instead of a separate env var since the
// connection string already carries this information.
const isLocalDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});

module.exports = pool;
