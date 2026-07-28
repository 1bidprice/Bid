const EPSILON = 1e-8;

const finite = (value) => Number.isFinite(Number(value));
const positive = (value) => finite(value) && Number(value) > 0;
const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

function transactionFees(transaction) {
  const source = transaction?.feeBreakdown && typeof transaction.feeBreakdown === 'object'
    ? transaction.feeBreakdown
    : { other: transaction?.fees };
  return roundMoney(Object.values(source || {}).reduce((sum, value) => sum + (finite(value) ? Number(value) : 0), 0));
}

function transactionExecutionPrice(transaction) {
  if (positive(transaction?.executionPrice)) return Number(transaction.executionPrice);
  if (positive(transaction?.price)) return Number(transaction.price);
  return 0;
}

function transactionGross(transaction) {
  if (positive(transaction?.grossAmount)) return roundMoney(transaction.grossAmount);
  return roundMoney(Number(transaction?.quantity || 0) * transactionExecutionPrice(transaction));
}

function transactionTotal(transaction) {
  if (finite(transaction?.total) && Number(transaction.total) >= 0) return roundMoney(transaction.total);
  const gross = transactionGross(transaction);
  const fees = transactionFees(transaction);
  return transaction?.type === 'sell'
    ? roundMoney(Math.max(0, gross - fees))
    : roundMoney(gross + fees);
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function compareTransactions(a, b) {
  const date = String(a?.date || '').localeCompare(String(b?.date || ''));
  if (date !== 0) return date;
  const created = String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''));
  if (created !== 0) return created;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function lotPerformance(currentPrice, allInPrice, remainingQuantity) {
  if (!positive(currentPrice) || !positive(allInPrice) || !positive(remainingQuantity)) {
    return { currentValue: null, pnl: null, performancePct: null };
  }
  const currentValue = Number(currentPrice) * Number(remainingQuantity);
  const remainingCost = Number(allInPrice) * Number(remainingQuantity);
  return {
    currentValue,
    pnl: currentValue - remainingCost,
    performancePct: ((Number(currentPrice) / Number(allInPrice)) - 1) * 100,
  };
}

/**
 * Builds open purchase lots without mutating the transaction ledger.
 * Sales are allocated FIFO only for lot display. The existing portfolio
 * accounting totals remain controlled by PortfolioApp's accounting model.
 */
function buildPositionLots(transactionsInput, symbolInput, currentPriceInput = null) {
  const symbol = normalizeSymbol(symbolInput);
  const currentPrice = positive(currentPriceInput) ? Number(currentPriceInput) : null;
  const transactions = (Array.isArray(transactionsInput) ? transactionsInput : [])
    .filter((transaction) => normalizeSymbol(transaction?.symbol) === symbol)
    .filter((transaction) => ['buy', 'sell'].includes(transaction?.type))
    .sort(compareTransactions);

  const lots = [];
  let purchaseNumber = 0;
  let hadSales = false;
  let unmatchedSellQuantity = 0;

  for (const transaction of transactions) {
    const quantity = Number(transaction?.quantity || 0);
    if (!positive(quantity)) continue;

    if (transaction.type === 'buy') {
      purchaseNumber += 1;
      const totalCost = transactionTotal(transaction);
      const allInPrice = quantity > 0 ? totalCost / quantity : 0;
      lots.push({
        lotId: transaction.id || `${symbol}:${transaction.date || ''}:${purchaseNumber}`,
        transactionId: transaction.id || null,
        purchaseNumber,
        symbol,
        company: transaction.company || symbol,
        currency: transaction.currency || (symbol.endsWith('.US') ? 'USD' : 'EUR'),
        date: transaction.date || null,
        createdAt: transaction.createdAt || null,
        broker: transaction.broker || null,
        orderReference: transaction.orderReference || null,
        originalQuantity: quantity,
        remainingQuantity: quantity,
        soldQuantity: 0,
        executionPrice: transactionExecutionPrice(transaction),
        fees: transactionFees(transaction),
        totalCost,
        allInPrice,
      });
      continue;
    }

    hadSales = true;
    let quantityToAllocate = quantity;
    for (const lot of lots) {
      if (quantityToAllocate <= EPSILON) break;
      if (lot.remainingQuantity <= EPSILON) continue;
      const allocated = Math.min(lot.remainingQuantity, quantityToAllocate);
      lot.remainingQuantity -= allocated;
      lot.soldQuantity += allocated;
      quantityToAllocate -= allocated;
    }
    if (quantityToAllocate > EPSILON) unmatchedSellQuantity += quantityToAllocate;
  }

  const openLots = lots
    .filter((lot) => lot.remainingQuantity > EPSILON)
    .map((lot) => {
      const performance = lotPerformance(currentPrice, lot.allInPrice, lot.remainingQuantity);
      return {
        ...lot,
        remainingCost: lot.allInPrice * lot.remainingQuantity,
        partiallySold: lot.soldQuantity > EPSILON,
        ...performance,
      };
    });

  const openQuantity = openLots.reduce((sum, lot) => sum + lot.remainingQuantity, 0);
  const openCost = openLots.reduce((sum, lot) => sum + lot.remainingCost, 0);
  const currentValue = currentPrice === null ? null : currentPrice * openQuantity;
  const pnl = currentValue === null ? null : currentValue - openCost;

  return {
    format: 'investor-control-position-lots',
    version: 1,
    method: 'FIFO',
    symbol,
    currentPrice,
    purchaseCount: lots.length,
    openLotCount: openLots.length,
    hadSales,
    unmatchedSellQuantity,
    openQuantity,
    openCost,
    weightedAllInPrice: openQuantity > EPSILON ? openCost / openQuantity : null,
    currentValue,
    pnl,
    performancePct: currentValue === null || openCost <= EPSILON ? null : (pnl / openCost) * 100,
    openLots,
  };
}

module.exports = {
  buildPositionLots,
};
