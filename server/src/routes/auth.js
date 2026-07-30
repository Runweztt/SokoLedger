const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { requireString, withValidation, ValidationError } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();
const BCRYPT_ROUNDS = 12;
const TOKEN_TTL = '7d';

function issueToken(userId) {
  return jwt.sign({ userId }, process.env.SESSION_SECRET, { expiresIn: TOKEN_TTL });
}

router.post(
  '/register',
  authLimiter,
  withValidation(async (req, res) => {
    const username = requireString(req.body, 'username', { minLength: 3, maxLength: 50 });
    const password = requireString(req.body, 'password', { minLength: 8, maxLength: 200 });

    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      throw new ValidationError('That username is already taken');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, passwordHash]
    );
    const user = result.rows[0];
    res.status(201).json({ token: issueToken(user.id), username: user.username });
  })
);

router.post(
  '/login',
  authLimiter,
  withValidation(async (req, res) => {
    const username = requireString(req.body, 'username', { minLength: 1, maxLength: 50 });
    const password = requireString(req.body, 'password', { minLength: 1, maxLength: 200 });

    const result = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    const passwordMatches = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!user || !passwordMatches) {
      return res.status(401).json({ error: 'Wrong username or password' });
    }

    res.json({ token: issueToken(user.id), username: user.username });
  })
);

module.exports = router;
