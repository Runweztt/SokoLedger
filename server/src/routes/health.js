const express = require('express');
const os = require('os');
const pool = require('../db/pool');

const router = express.Router();

// Includes hostname+pid in the body (not just a 200) so that curling this
// through the load balancer repeatedly gives visible proof requests are
// actually alternating between web-01 and web-02, not just that one of
// them happens to be up — see README verification section.
router.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    return res.status(503).json({ status: 'db_unreachable', instance: os.hostname(), pid: process.pid });
  }
  res.json({ status: 'ok', instance: os.hostname(), pid: process.pid });
});

module.exports = router;
