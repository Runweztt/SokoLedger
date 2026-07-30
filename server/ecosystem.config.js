// pm2 process definition, identical on web-01 and web-02. Both hosts run
// this unchanged; the only thing that varies is .env, and even that ends up
// identical since both point at the same Supabase database.
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
