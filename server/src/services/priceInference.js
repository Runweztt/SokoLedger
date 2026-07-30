const { averageUnitPrice } = require('../db/queries/sales');

// Fills a missing unit_price from the trader's own sales history rather
// than blocking the entry or guessing a market-wide number. The UI must
// show this as "estimated", since it's a convenience for the ledger view,
// not a fact the trader stated.
async function resolveUnitPrice({ userId, item, unitPrice, totalAmount, quantity }) {
  if (unitPrice !== null && unitPrice !== undefined) {
    return { unitPrice, isEstimated: false };
  }

  if (totalAmount !== null && totalAmount !== undefined && quantity > 0) {
    return { unitPrice: totalAmount / quantity, isEstimated: false };
  }

  const historical = await averageUnitPrice(userId, item);
  return { unitPrice: historical, isEstimated: historical !== null };
}

function resolveTotalAmount({ unitPrice, totalAmount, quantity }) {
  if (totalAmount !== null && totalAmount !== undefined) return totalAmount;
  if (unitPrice !== null && unitPrice !== undefined) return unitPrice * quantity;
  return null;
}

module.exports = { resolveUnitPrice, resolveTotalAmount };
