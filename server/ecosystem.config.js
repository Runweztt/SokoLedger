// pm2 process definition. Identical on web-01 and web-02 — the only
// difference between the two hosts is their .env DATABASE_URL pointing
// at the same shared Postgres instance.
module.exports = {
  apps: [
    {
      name: 'sokoledger',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '300M',
      autorestart: true,
    },
  ],
};
