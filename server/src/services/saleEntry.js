const { insertEntry } = require('../db/queries/sales');
const { resolveUnitPrice, resolveTotalAmount } = require('./priceInference');
const { checkForDuplicate } = require('./duplicateCheck');

// The one insert path every route (parse, manual fallback, duplicate
// confirm) and the queue retry worker all funnel through, so price
// inference and duplicate handling only live in one place.
async function resolveAndInsertSale({ userId, rawText, item, quantity, unitPrice, totalAmount, confidence, occurredAt, skipDuplicateCheck = false, force = false }) {
  const priceResult = await resolveUnitPrice({ userId, item, unitPrice, totalAmount, quantity });
  const finalTotal = resolveTotalAmount({ unitPrice: priceResult.unitPrice, totalAmount, quantity });

  if (finalTotal === null) {
    return {
      status: 'clarify',
      question: `What did the ${item} sell for in total, or per unit?`,
    };
  }

  if (!skipDuplicateCheck && !force) {
    const duplicate = await checkForDuplicate({ userId, item, quantity, totalAmount: finalTotal });
    if (duplicate) {
      return { status: 'duplicate', duplicate };
    }
  }

  const entry = await insertEntry({
    userId,
    rawText,
    item,
    quantity,
    unitPrice: priceResult.unitPrice,
    totalAmount: finalTotal,
    isEstimated: priceResult.isEstimated,
    confidence: confidence ?? null,
    occurredAt: occurredAt || new Date(),
  });

  return { status: 'inserted', entry };
}

module.exports = { resolveAndInsertSale };
