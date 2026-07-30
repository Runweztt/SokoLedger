const { findRecentDuplicate } = require('../db/queries/sales');

const DUPLICATE_WINDOW_MINUTES = 10;

async function checkForDuplicate({ userId, item, quantity, totalAmount }) {
  return findRecentDuplicate(userId, item, quantity, totalAmount, DUPLICATE_WINDOW_MINUTES);
}

module.exports = { checkForDuplicate, DUPLICATE_WINDOW_MINUTES };
