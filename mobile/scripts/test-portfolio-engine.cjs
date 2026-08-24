const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadExportedModule(relativePath, context = {}) {
  let source = read(relativePath);
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
const integrity = loadExportedModule('src/instrument-quote-integrity.js');
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
    id: 'alwn', type: 'buy', symbol: 'ALWN.GR', company: 'Allwyn', quantity: 193, currency: 'EUR',
    executionPrice: 13.565, grossAmount: 2618.05,
    feeBreakdown: { commission: 9.16, transfer: 1.57, clearing: 0.72, exchange: 0.5 },
    total: 2630.0, date: '2026-07-14',
  },
  {
    id: 'credia', type: 'buy', symbol: 'CREDIA.GR', company: 'CrediaBank (CR)', quantity: 15, currency: 'EUR',
    executionPrice: 1.65, fees: 0, total: 24.75, date: '2025-10-06',
  },
  {
    id: 'spce', type: 'buy', symbol: 'SPCE.US', company: 'Virgin Galactic Holdings', quantity: 720, currency: 'USD',
    executionPrice: 3.17, fees: 0, total: 2282.72, date: '2026-03-03',
  },
];

const prices = {
  'ALWN.GR': verifiedQuote(14.22, 'EUR'),
  'CREDIA.GR': verifiedQuote(0.986, 'EUR'),
  'SPCE.US': verifiedQuote(3.08, 'USD', { fxRate: 1.1666666666666667, price: 9999 }),
};

const snapshot = buildPortfolioSnapshot(transactions, prices);
assert.equal(snapshot.positions.length, 3);
assert.equal(snapshot.summary.valuationCoverage, '3/3');
assert.equal(snapshot.summary.valuesReady, true);
assert.equal(snapshot.summary.costsReady, true);

const allwyn = snapshot.positions.find((position) => position.symbol === 'ALWN.GR');
close(allwyn.nativeValue, 2744.46, 1e-8, 'Allwyn value');
close(allwyn.cost, 2630.0, 1e-8, 'Allwyn cost');
close(allwyn.nativePnl, 114.46, 1e-8, 'Allwyn P/L');
close(allwyn.average, 2630 / 193, 1e-12, 'Allwyn all-in');
assert.equal(allwyn.positionCurrencyVerified, true);

const credia = snapshot.positions.find((position) => position.symbol === 'CREDIA.GR');
close(credia.nativeValue, 14.79, 1e-8, 'Credia value');
close(credia.nativePnl, -9.96, 1e-8, 'Credia P/L');
close(credia.average, 1.65, 1e-12, 'Credia all-in');

const spce = snapshot.positions.find((position) => position.symbol === 'SPCE.US');
close(spce.nativeValue, 2217.6, 1e-8, 'SPCE value');
close(spce.cost, 2282.72, 1e-8, 'SPCE cost');
close(spce.nativePnl, -65.12, 1e-8, 'SPCE P/L');
close(spce.average, 2282.72 / 720, 1e-12, 'SPCE all-in');
close(spce.lots[0].executionPrice, 2282.72 / 720, 1e-12, 'SPCE reconciled execution price');
close(spce.eurPrice, 3.08 / prices['SPCE.US'].fxRate, 1e-12, 'SPCE EUR price derives from native + FX');
assert.notEqual(spce.eurPrice, prices['SPCE.US'].price, 'portfolio engine must not trust a second independent quote.price truth');

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

const partial = buildPortfolioSummary([allwyn, { ...spce, eurValue: null, eurCost: null }]);
assert.equal(partial.valuationCoverage, '1/2');
assert.equal(partial.valuesReady, false);
assert.deepEqual([...partial.missingValuationSymbols], ['SPCE.US']);

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

console.log('Portfolio engine PASS: live 3-position regression, fail-closed integrity cases, FIFO/average-cost ledger and 500 synthetic positions.');
