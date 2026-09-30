const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadExports(relativePath, replacements = [], context = {}) {
  let source = read(relativePath);
  for (const [from, to] of replacements) source = source.replace(from, to);
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
  source += `\nmodule.exports = { ${[...new Set(exported)].join(', ')} };\n`;
  const sandbox = {
    module: { exports: {} }, exports: {}, console, Date, Number, String, Object, Array, Set, Map, Math, RegExp,
    ...context,
  };
  vm.runInNewContext(source, sandbox, { filename: relativePath });
  return sandbox.module.exports;
}

const marketRules = loadExports('src/market-rules.js');
const integrity = loadExports(
  'src/instrument-quote-integrity.js',
  [["import { MARKET_RULES } from './market-rules';", 'const { MARKET_RULES } = __marketRules;']],
  { __marketRules: marketRules },
);
const quoteContract = loadExports(
  'src/quote-contract.js',
  [["import { evaluateMobileQuoteIntegrity, mobileQuotePublicMessage } from './instrument-quote-integrity';", 'const { evaluateMobileQuoteIntegrity, mobileQuotePublicMessage } = __integrity;']],
  { __integrity: integrity },
);
const accounting = loadExports('src/transaction-accounting.js');
const positionLots = require('../src/position-lots');

let portfolioSource = read('src/portfolio-engine.js')
  .replace("import { normalizeTransactions, transactionTotal } from './transaction-accounting';", 'const { normalizeTransactions, transactionTotal } = __accounting;')
  .replace("import { routeMobileInstrument } from './instrument-quote-integrity';", 'const { routeMobileInstrument } = __integrity;')
  .replace("const { buildPositionLots } = require('./position-lots');", 'const { buildPositionLots } = __positionLots;');
const portfolioExports = [];
portfolioSource = portfolioSource.replace(/export function\s+([A-Za-z0-9_]+)\s*\(/g, (_, name) => {
  portfolioExports.push(name);
  return `function ${name}(`;
});
portfolioSource += `\nmodule.exports = { ${[...new Set(portfolioExports)].join(', ')} };\n`;
const portfolioSandbox = {
  module: { exports: {} }, exports: {}, console, Date, Number, String, Object, Array, Set, Map, Math, RegExp,
  __accounting: accounting,
  __integrity: integrity,
  __positionLots: positionLots,
};
vm.runInNewContext(portfolioSource, portfolioSandbox, { filename: 'src/portfolio-engine.js' });
const portfolio = portfolioSandbox.module.exports;

const now = Date.parse('2026-09-30T12:05:00.000Z');

const usRegistry = {
  price: 3.21,
  previousClose: 3.10,
  currency: 'USD',
  quoteAt: '2026-09-30T12:04:00.000Z',
  checkedAt: '2026-09-30T12:04:05.000Z',
  source: 'Finnhub',
  providerSymbol: 'SPCE',
  quoteContract: {
    sourceRole: 'LICENSED_MARKET_DATA',
    timestampVerified: true,
    dayChangeEligible: true,
  },
};
const usQuote = quoteContract.quoteFromRegistry('SPCE.US', usRegistry, {
  now,
  exchangeOpen: true,
  exchangeSession: 'regular-market',
  exchangeCalendarVerified: true,
});
assert.ok(usQuote, 'US canonical gateway quote must survive mobile quote contract');
usQuote.fxRate = 1.18;

const usSnapshot = portfolio.buildPortfolioSnapshot([
  {
    id: 'spce-buy',
    type: 'buy',
    symbol: 'SPCE.US',
    company: 'Virgin Galactic',
    quantity: 100,
    currency: 'USD',
    executionPrice: 3,
    grossAmount: 300,
    fees: 2,
    total: 302,
    date: '2026-09-29',
  },
], { 'SPCE.US': usQuote });

assert.equal(usSnapshot.summary.valuationCoverage, '1/1');
assert.equal(usSnapshot.summary.valuesReady, true);
assert.equal(usSnapshot.positions[0].nativeValue, 321);
assert.equal(usSnapshot.positions[0].nativePnl, 19);
assert.ok(Number.isFinite(usSnapshot.positions[0].eurValue));
assert.ok(Number.isFinite(usSnapshot.positions[0].eurPnl));

const grRegistry = {
  price: 4.50,
  previousClose: 4.40,
  currency: 'EUR',
  quoteAt: '2026-09-30T12:00:00.000Z',
  checkedAt: '2026-09-30T12:04:00.000Z',
  source: 'Euronext Athens',
  providerSymbol: 'ALWN',
  advertisedDelayMinutes: 15,
  quoteContract: {
    sourceRole: 'PRIMARY_EXCHANGE',
    timestampVerified: false,
    dayChangeEligible: false,
  },
};
const grQuote = quoteContract.quoteFromRegistry('ALWN.GR', grRegistry, {
  now,
  exchangeOpen: true,
  exchangeSession: 'regular-market',
  exchangeCalendarVerified: true,
});
assert.ok(grQuote, 'Athens primary-exchange quote must remain valuation eligible even without exact trade timestamp');

const grSnapshot = portfolio.buildPortfolioSnapshot([
  {
    id: 'alwn-buy',
    type: 'buy',
    symbol: 'ALWN.GR',
    company: 'Allwyn',
    quantity: 200,
    currency: 'EUR',
    executionPrice: 4,
    grossAmount: 800,
    fees: 5,
    total: 805,
    date: '2026-09-29',
  },
], { 'ALWN.GR': grQuote });

assert.equal(grSnapshot.summary.valuationCoverage, '1/1');
assert.equal(grSnapshot.summary.valuesReady, true);
assert.equal(grSnapshot.positions[0].nativeValue, 900);
assert.equal(grSnapshot.positions[0].nativePnl, 95);

const appSource = read('PortfolioApp.js');
for (const label of ['Αξία θέσης', 'Κέρδος / Ζημία', 'Αξία χαρτοφυλακίου']) {
  assert.ok(appSource.includes(label), `UI must render ${label}`);
}
assert.ok(appSource.includes("const stale = !item.quote || item.quote.usable !== true || item.valuationEligible !== true;"), 'Missing quote must be treated as unavailable');
assert.ok(appSource.includes("const numeric = valid(value) ? Number(value) : null;"), 'Null performance must not be coerced to zero');

console.log('MINBEIS gateway -> quote contract -> portfolio value/P&L -> UI regression verified');
