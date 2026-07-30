require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');

const authRoutes = require('./routes/auth');
const salesRoutes = require('./routes/sales');
const analyticsRoutes = require('./routes/analytics');
const healthRoutes = require('./routes/health');
const { startWorker } = require('./queue/parseQueue');

for (const required of ['DATABASE_URL', 'SESSION_SECRET', 'RAPIDAPI_KEY']) {
  if (!process.env[required]) {
    console.error(`Missing required env var: ${required}`);
    process.exit(1);
  }
}

const app = express();

app.use(helmet());
app.use(express.json({ limit: '20kb' }));

app.use('/healthz', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/analytics', analyticsRoutes);

app.use(express.static(path.join(__dirname, '..', '..', 'public')));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Final safety net — a route handler throwing synchronously or a
// withValidation-wrapped handler re-throwing a non-ValidationError lands
// here instead of crashing the process.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
});

startWorker();

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`SokoLedger listening on port ${port}`);
});
