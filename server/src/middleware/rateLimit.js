const rateLimit = require('express-rate-limit');

// Brute-force protection on login/register.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

// The RapidAPI open-ai21 subscription is free-tier with a hard monthly
// quota. This is the only endpoint that calls it, so the limit is keyed
// per trader (not per IP) to stop one runaway client from burning the
// shared quota for everyone.
const parseLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.userId ? String(req.userId) : req.ip),
  message: { error: 'Slow down a little — too many sales submitted at once. Try again shortly.' },
});

module.exports = { authLimiter, parseLimiter };
