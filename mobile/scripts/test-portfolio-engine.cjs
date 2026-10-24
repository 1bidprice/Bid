const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadExportedModule(relativePath, context = {}) {
  let source = read(relativePath);
  source = source.replace(/^import .*$/gm, '');
  const exported = [];
  source = source.replace(/export const\s+([A-Za-z0-9_]+)\s*=/g, (_, name) => {
    exported.push(name);
    return `const ${name} =`;
  });
  source = source.replace(/export function\s+([A-Za-z0-9_]+)\s*\(/g, (_, name) => {
    exported.push(name);
    return `function ${name}(`;
  });
  source = source.replace(/export default\s+/g, '');
  source += `\nmodule.exports = { ${[...new Set(exported)].join(', ')} };\n`;
  const sandbox = {
    module: { exports: {} }, exports: {}, console, Date, Number, String, Object, Array, Set, Math, RegExp,
    ...context,
  };
  vm.runInNewContext(source, sandbox, { filename: relativePath });
  return sandbox.module.exports;
}

const accounting = loadExportedModule('src/transaction-accounting.js');
const marketRules = loadExportedModule('src/market-rules.js');
const integrity = loadExportedModule('src/instrument-quote-integrity.js', { MARKET_RULES: marketRules.MARKET_RULES });
const positionLots = require('../src/position-lots');

function loadPortfolioEngine() {
  let source = read('src/portfolio-engine.js');
  source = source
    .replace("import { normalizeTransactions, transactionTotal } from './transaction-accounting';", 'const { normalizeTransactions, transactionTotal } = __accounting;')
    .replace("import { routeMobileInstrument } from './instrument-quote-integrity';", 'const { routeMobileInstrument } = __integrity;')
    .replace("const { buildPositionLots } = require('./position-lots');", 'const { buildPositionLots } = __positionLots;');
  const exported = [];
  source = source.replace(/export function\s+([A-Za-z0-9_]+)\s*\(/g, (_, name) => {
    exported.push(name);
    return `function ${name}(`;
  });
  source += `\nmodule.exports = { ${[...new Set(exported)].join(', ')} };\n`;
  const sandbox = {
    module: { exports: {} }, exports: {}, console, Date, Number, String, Object, Array, Set, Math, RegExp,
    __accounting: accounting,
    __integrity: integrity,
    __positionLots: positionLots,
  };
  vm.runInNewContext(source, sandbox, { filename: 'src/portfolio-engine.js' });
  return sandbox.module.exports;
}

const { buildOpenPositionLedger, buildPortfolioPositions, buildPortfolioSummary, buildPortfolioSnapshot } = loadPortfolioEngine();

function close(actual, expected, epsilon = 1e-8, label = 'value') {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= epsilon, `${label}: expected ${expected}, got ${actual}`);
}

function verifiedQuote(nativePrice, currency, extra = {}) {
  return {
    nativePrice,
    nativeCurrency: currency,
    usable: true,
    quoteContract: { valuationEligible: true, decisionEligible: false },
    ...extra,
  };
}

const transactions = [
  {
    id: 'alpha-gr', type: 'buy', symbol: 'ALPHA.GR', company: 'Synthetic Alpha', quantity: 100, currency: 'EUR',
    executionPrice: 10, grossAmount: 1000,
    feeBreakdown: { commission: 3, transfer: 1, clearing: 0.5, exchange: 0.5 },
    total: 1005, date: '2026-01-10',
  },
  {
    id: 'beta-gr', type: 'buy', symbol: 'BETA.GR', company: 'Synthetic Beta', quantity: 20, currency: 'EUR',
    executionPrice: 2, fees: 0, total: 40, date: '2026-01-11',
  },
  {
    id: 'gamma-us', type: 'buy', symbol: 'GAMMA.US', company: 'Synthetic Gamma', quantity: 50, currency: 'USD',
    executionPrice: 5, fees: 0, total: 250, date: '2026-01-12',
  },
];

const prices = {
  'ALPHA.GR': verifiedQuote(12, 'EUR'),
  'BETA.GR': verifiedQuote(1.5, 'EUR'),
  'GAMMA.US': verifiedQuote(6, 'USD', { fxRate: 1.2, price: 9999 }),
};

const snapshot = buildPortfolioSnapshot(transactions, prices);
assert.equal(snapshot.positions.length, 3);
assert.equal(snapshot.summary.valuationCoverage, '3/3');
assert.equal(snapshot.summary.valuesReady, true);
assert.equal(snapshot.summary.costsReady, true);

const alpha = snapshot.positions.find((position) => position.symbol === 'ALPHA.GR');
close(alpha.nativeValue, 1200, 1e-8, 'Synthetic Alpha value');
close(alpha.cost, 1005, 1e-8, 'Synthetic Alpha cost');
close(alpha.nativePnl, 195, 1e-8, 'Synthetic Alpha P/L');
close(alpha.average, 10.05, 1e-12, 'Synthetic Alpha all-in');
assert.equal(alpha.positionCurrencyVerified, true);

const beta = snapshot.positions.find((position) => position.symbol === 'BETA.GR');
close(beta.nativeValue, 30, 1e-8, 'Synthetic Beta value');
close(beta.nativePnl, -10, 1e-8, 'Synthetic Beta P/L');
close(beta.average, 2, 1e-12, 'Synthetic Beta all-in');

const gamma = snapshot.positions.find((position) => position.symbol === 'GAMMA.US');
close(gamma.nativeValue, 300, 1e-8, 'Synthetic Gamma value');
close(gamma.cost, 250, 1e-8, 'Synthetic Gamma cost');
close(gamma.nativePnl, 50, 1e-8, 'Synthetic Gamma P/L');
close(gamma.average, 5, 1e-12, 'Synthetic Gamma all-in');
close(gamma.lots[0].executionPrice, 5, 1e-12, 'Synthetic Gamma execution price');
close(gamma.eurPrice, 5, 1e-12, 'Synthetic Gamma EUR price derives from native + FX');
assert.notEqual(gamma.eurPrice, prices['GAMMA.US'].price, 'portfolio engine must not trust a second independent quote.price truth');

const wrongCurrency = buildPortfolioPositions([
  { type: 'buy', symbol: 'ABC.US', quantity: 10, currency: 'EUR', executionPrice: 10, total: 100 },
], { 'ABC.US': verifiedQuote(11, 'USD', { fxRate: 1.1 }) })[0];
assert.equal(wrongCurrency.valuationEligible, false);
assert.ok(wrongCurrency.valuationBlockers.includes('POSITION_CURRENCY_MISMATCH'));
assert.equal(wrongCurrency.nativeValue, null);

const missingCurrency = buildPortfolioPositions([
  { type: 'buy', symbol: 'XYZ.GR', quantity: 10, executionPrice: 10, total: 100 },
], { 'XYZ.GR': verifiedQuote(11, 'EUR') })[0];
assert.equal(missingCurrency.valuationEligible, false);
assert.ok(missingCurrency.valuationBlockers.includes('POSITION_CURRENCY_MISSING'));

const unsupported = buildPortfolioPositions([
  { type: 'buy', symbol: 'VOD.L', quantity: 10, currency: 'GBP', executionPrice: 10, total: 100 },
], { 'VOD.L': verifiedQuote(11, 'GBP') })[0];
assert.equal(unsupported.valuationEligible, false);
assert.ok(unsupported.valuationBlockers.includes('MARKET_ROUTE_UNVERIFIED'));

const noFx = buildPortfolioPositions([
  { type: 'buy', symbol: 'ABC.US', quantity: 10, currency: 'USD', executionPrice: 10, total: 100 },
], { 'ABC.US': verifiedQuote(11, 'USD') })[0];
assert.equal(noFx.valuationEligible, false);
assert.ok(noFx.valuationBlockers.includes('FX_RATE_MISSING'));

const partial = buildPortfolioSummary([alpha, { ...gamma, eurValue: null, eurCost: null }]);
assert.equal(partial.valuationCoverage, '1/2');
assert.equal(partial.valuesReady, false);
assert.deepEqual([...partial.missingValuationSymbols], ['GAMMA.US']);

const fifoLedger = buildOpenPositionLedger([
  { id: 'b1', type: 'buy', symbol: 'FIFO.GR', currency: 'EUR', quantity: 10, executionPrice: 10, total: 100, date: '2026-01-01' },
  { id: 'b2', type: 'buy', symbol: 'FIFO.GR', currency: 'EUR', quantity: 10, executionPrice: 20, total: 200, date: '2026-01-02' },
  { id: 's1', type: 'sell', symbol: 'FIFO.GR', currency: 'EUR', quantity: 5, executionPrice: 30, total: 150, date: '2026-01-03' },
])[0];
close(fifoLedger.quantity, 15, 1e-12, 'ledger remaining quantity');
close(fifoLedger.cost, 225, 1e-12, 'ledger average-cost remaining cost');

let seed = 0x6d2b79f5;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}

for (let i = 0; i < 500; i += 1) {
  const market = i % 2 ? 'US' : 'GR';
  const currency = market === 'US' ? 'USD' : 'EUR';
  const symbol = `SYN${i}.${market}`;
  const quantity = 1 + Math.floor(random() * 1000);
  const price = 0.5 + random() * 100;
  const total = accounting.roundMoney(quantity * price);
  const quotePrice = 0.5 + random() * 100;
  const fxRate = market === 'US' ? 1.05 + random() * 0.2 : 1;
  const result = buildPortfolioPositions([
    { type: 'buy', symbol, currency, quantity, executionPrice: Number(price.toFixed(2)), total },
  ], {
    [symbol]: verifiedQuote(quotePrice, currency, { fxRate }),
  })[0];
  assert.equal(result.valuationEligible, true, `${symbol} must value`);
  close(result.nativeValue, quantity * quotePrice, 1e-7, `${symbol} native value`);
  close(result.nativePnl, result.nativeValue - total, 1e-7, `${symbol} P/L`);
  close(result.average, total / quantity, 1e-10, `${symbol} average`);
  if (market === 'US') close(result.eurValue, result.nativeValue / fxRate, 1e-7, `${symbol} EUR value`);
}

const scaleTransactions = [];
const scalePrices = {};
let expectedScaleValueEur = 0;
let expectedScaleCostEur = 0;
for (let i = 0; i < 1000; i += 1) {
  const market = i % 2 ? 'US' : 'GR';
  const currency = market === 'US' ? 'USD' : 'EUR';
  const symbol = `LOAD${i}.${market}`;
  const quantity = 1 + (i % 25);
  const executionPrice = 10 + (i % 17);
  const nativePrice = executionPrice + 1;
  const total = quantity * executionPrice;
  const fxRate = market === 'US' ? 1.1 : 1;
  scaleTransactions.push({
    id: `load-${i}`,
    type: 'buy',
    symbol,
    company: `Load ${i}`,
    quantity,
    currency,
    executionPrice,
    total,
    date: '2026-01-01',
  });
  scalePrices[symbol] = verifiedQuote(nativePrice, currency, { fxRate });
  expectedScaleValueEur += market === 'US' ? (quantity * nativePrice) / fxRate : quantity * nativePrice;
  expectedScaleCostEur += market === 'US' ? total / fxRate : total;
}
const scaleStarted = Date.now();
const scaleSnapshot = buildPortfolioSnapshot(scaleTransactions, scalePrices);
const scaleElapsedMs = Date.now() - scaleStarted;
assert.equal(scaleSnapshot.positions.length, 1000, '1000-position combined portfolio must preserve every position');
assert.equal(scaleSnapshot.summary.valuationCoverage, '1000/1000');
assert.equal(scaleSnapshot.summary.valuesReady, true);
assert.equal(scaleSnapshot.summary.costsReady, true);
close(scaleSnapshot.summary.totalValue, expectedScaleValueEur, 1e-6, '1000-position total value');
close(scaleSnapshot.summary.totalCost, expectedScaleCostEur, 1e-6, '1000-position total cost');

const portfolioAppSource = read('PortfolioApp.js');
assert.match(portfolioAppSource, /positions\.slice\(0, positionVisibleCount\)\.map/, 'position cards must be windowed');
assert.match(portfolioAppSource, /slice\(0, transactionVisibleCount\)\.map/, 'transaction cards must be windowed');
assert.match(portfolioAppSource, /POSITION_PAGE_SIZE = 50/, 'position UI page size must remain bounded');

console.log(`Portfolio engine PASS: synthetic valuation/integrity regressions, 500 randomized positions, and 1000-position combined portfolio in ${scaleElapsedMs}ms with windowed UI.`);
