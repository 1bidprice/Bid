import { normalizeTransactions, transactionTotal } from './transaction-accounting';
import { routeMobileInstrument } from './instrument-quote-integrity';
const { buildPositionLots } = require('./position-lots');

const EPSILON = 1e-8;
const finite = (value) => Number.isFinite(Number(value));
const positive = (value) => finite(value) && Number(value) > 0;

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function compareTransactions(a, b) {
  const date = String(a?.date || '').localeCompare(String(b?.date || ''));
  if (date !== 0) return date;
  const created = String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''));
  if (created !== 0) return created;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

export function buildOpenPositionLedger(transactionsInput) {
  const transactions = normalizeTransactions(transactionsInput).sort(compareTransactions);
  const ledger = {};

  for (const transaction of transactions) {
    if (!['buy', 'sell'].includes(transaction.type)) continue;
    const symbol = normalizeSymbol(transaction.symbol);
    const quantity = Number(transaction.quantity || 0);
    if (!symbol || !positive(quantity)) continue;

    const transactionCurrency = normalizeCurrency(transaction.currency);
    const position = ledger[symbol] || {
      symbol,
      company: transaction.company || symbol,
      currency: transactionCurrency,
      currencyConflict: false,
      quantity: 0,
      cost: 0,
    };

    if (!position.currency && transactionCurrency) position.currency = transactionCurrency;
    if (position.currency && transactionCurrency && position.currency !== transactionCurrency) {
      position.currencyConflict = true;
    }

    if (transaction.type === 'buy') {
      position.quantity += quantity;
      position.cost += transactionTotal(transaction);
    } else if (position.quantity > EPSILON) {
      const sold = Math.min(quantity, position.quantity);
      position.cost -= (position.cost / position.quantity) * sold;
      position.quantity -= sold;
      if (position.quantity <= EPSILON) {
        position.quantity = 0;
        position.cost = 0;
      }
    }

    ledger[symbol] = position;
  }

  return Object.values(ledger).filter((position) => position.quantity > EPSILON);
}

function positionValuationBlockers(position, route, quote, fxRate) {
  const blockers = [];
  if (!route.supported) blockers.push(route.blocker || 'MARKET_ROUTE_UNVERIFIED');
  if (!position.currency) blockers.push('POSITION_CURRENCY_MISSING');
  if (position.currencyConflict) blockers.push('POSITION_CURRENCY_CONFLICT');
  if (route.supported && position.currency && route.expectedCurrency !== position.currency) {
    blockers.push('POSITION_CURRENCY_MISMATCH');
  }
  if (!quote) blockers.push('QUOTE_MISSING');
  if (quote && quote.quoteContract?.valuationEligible !== true) blockers.push('QUOTE_NOT_VALUATION_ELIGIBLE');
  if (quote && quote.usable !== true) blockers.push('QUOTE_NOT_USABLE');
  if (quote && !positive(quote.nativePrice)) blockers.push('QUOTE_PRICE_MISSING');
  if (position.currency === 'USD' && !positive(fxRate)) blockers.push('FX_RATE_MISSING');
  return [...new Set(blockers)];
}

function positionIntegrityWarning(position, route, blockers) {
  if (!route.supported) {
    return 'Η αγορά αυτού του προϊόντος δεν έχει επαληθευμένο αυτόματο route. Η θέση παραμένει αποθηκευμένη χωρίς αυτόματη αποτίμηση.';
  }
  if (!position.currency) {
    return 'Το νόμισμα της θέσης δεν έχει καταγραφεί. Η θέση δεν αποτιμάται αυτόματα.';
  }
  if (position.currencyConflict) {
    return 'Οι συναλλαγές της ίδιας θέσης περιέχουν διαφορετικά νομίσματα. Η θέση δεν αποτιμάται μέχρι να διορθωθούν.';
  }
  if (route.expectedCurrency !== position.currency) {
    return `Το δηλωμένο νόμισμα (${position.currency}) δεν συμφωνεί με την επαληθευμένη αγορά (${route.expectedCurrency}). Η θέση δεν αποτιμάται αυτόματα.`;
  }
  if (blockers.includes('FX_RATE_MISSING')) {
    return 'Δεν υπάρχει επαληθευμένη ισοτιμία για τη μετατροπή της θέσης σε ευρώ.';
  }
  if (blockers.includes('QUOTE_NOT_VALUATION_ELIGIBLE') || blockers.includes('QUOTE_NOT_USABLE') || blockers.includes('QUOTE_MISSING')) {
    return 'Δεν υπάρχει χρησιμοποιήσιμη επαληθευμένη τιμή για αυτόματη αποτίμηση της θέσης.';
  }
  return null;
}

export function buildPortfolioPositions(transactionsInput, pricesInput = {}) {
  const transactions = normalizeTransactions(transactionsInput);
  const prices = pricesInput && typeof pricesInput === 'object' ? pricesInput : {};
  const ledger = buildOpenPositionLedger(transactions);

  return ledger.map((position) => {
    const quote = prices[position.symbol] || null;
    const route = routeMobileInstrument(position.symbol);
    const fxRate = position.currency === 'USD' && positive(quote?.fxRate)
      ? Number(quote.fxRate)
      : position.currency === 'EUR'
        ? 1
        : null;
    const valuationBlockers = positionValuationBlockers(position, route, quote, fxRate);
    const valuationEligible = valuationBlockers.length === 0;
    const nativePrice = valuationEligible ? Number(quote.nativePrice) : null;
    const eurPrice = nativePrice === null
      ? null
      : position.currency === 'EUR'
        ? nativePrice
        : nativePrice / fxRate;
    const nativeValue = nativePrice === null ? null : nativePrice * position.quantity;
    const eurValue = eurPrice === null ? null : eurPrice * position.quantity;
    const nativePnl = nativeValue === null ? null : nativeValue - position.cost;
    const eurCost = position.currency === 'EUR'
      ? position.cost
      : position.currency === 'USD' && positive(fxRate)
        ? position.cost / fxRate
        : null;
    const eurPnl = eurValue === null || eurCost === null ? null : eurValue - eurCost;
    const lotSummary = buildPositionLots(transactions, position.symbol, nativePrice);

    return {
      ...position,
      quote,
      instrumentRoute: route,
      positionCurrencyVerified: route.supported === true
        && position.currencyConflict !== true
        && route.expectedCurrency === position.currency,
      valuationEligible,
      valuationBlockers,
      instrumentIntegrityWarning: positionIntegrityWarning(position, route, valuationBlockers),
      nativePrice,
      eurPrice,
      fxRate,
      nativeValue,
      eurValue,
      nativePnl,
      nativePct: nativePnl === null || position.cost <= EPSILON ? null : (nativePnl / position.cost) * 100,
      eurCost,
      eurPnl,
      average: position.quantity > EPSILON ? position.cost / position.quantity : 0,
      lots: lotSummary.openLots,
      lotMethod: lotSummary.method,
      hadLotSales: lotSummary.hadSales,
      unmatchedSellQuantity: lotSummary.unmatchedSellQuantity,
    };
  });
}

export function buildPortfolioSummary(positionsInput) {
  const positions = Array.isArray(positionsInput) ? positionsInput : [];
  const valuedPositions = positions.filter((position) => finite(position.eurValue) && finite(position.eurCost));
  const costedPositions = positions.filter((position) => finite(position.eurCost));
  const missingValuationSymbols = positions
    .filter((position) => !finite(position.eurValue) || !finite(position.eurCost))
    .map((position) => position.symbol);

  const valuesReady = positions.length === valuedPositions.length;
  const costsReady = positions.length === costedPositions.length;
  const totalValue = positions.length === 0
    ? 0
    : valuedPositions.length
      ? valuedPositions.reduce((sum, position) => sum + Number(position.eurValue), 0)
      : null;
  const totalCost = positions.length === 0
    ? 0
    : costedPositions.length
      ? costedPositions.reduce((sum, position) => sum + Number(position.eurCost), 0)
      : null;
  const totalPnl = positions.length === 0
    ? 0
    : valuedPositions.length
      ? valuedPositions.reduce((sum, position) => sum + Number(position.eurPnl), 0)
      : null;

  return {
    positionCount: positions.length,
    valuedPositionCount: valuedPositions.length,
    costedPositionCount: costedPositions.length,
    valuesReady,
    costsReady,
    totalValue,
    totalCost,
    totalPnl,
    valuationCoverage: positions.length ? `${valuedPositions.length}/${positions.length}` : '0/0',
    missingValuationSymbols,
  };
}

export function buildPortfolioSnapshot(transactionsInput, pricesInput = {}) {
  const positions = buildPortfolioPositions(transactionsInput, pricesInput);
  return {
    positions,
    summary: buildPortfolioSummary(positions),
  };
}
