const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadIntegrityModuleForTest() {
  let source = read('src/instrument-quote-integrity.js');
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
  const sandbox = { module: { exports: {} }, exports: {}, console, Date, Number, String, Object, Set, Math, RegExp };
  vm.runInNewContext(source, sandbox, { filename: 'instrument-quote-integrity.js' });
  return sandbox.module.exports;
}

const { routeMobileInstrument, evaluateMobileQuoteIntegrity } = loadIntegrityModuleForTest();
const now = '2026-08-20T16:30:00.000Z';

const us = routeMobileInstrument('ABCD.US');
assert.equal(us.supported, true);
assert.equal(us.market, 'US');
assert.equal(us.baseSymbol, 'ABCD');
assert.equal(us.expectedCurrency, 'USD');

const gr = routeMobileInstrument('XYZ.GR');
assert.equal(gr.supported, true);
assert.equal(gr.market, 'GR');
assert.equal(gr.baseSymbol, 'XYZ');
assert.equal(gr.expectedCurrency, 'EUR');

const unsupported = routeMobileInstrument('VOD.L');
assert.equal(unsupported.supported, false);
assert.equal(unsupported.blocker, 'MARKET_ROUTE_UNVERIFIED');

const licensedUs = evaluateMobileQuoteIntegrity('ABCD.US', {
  nativePrice: 20,
  nativeCurrency: 'USD',
  providerSymbol: 'ABCD',
  source: 'Finnhub US quote',
  quality: 'realtime',
  updatedAt: '2026-08-20T16:29:00.000Z',
  checkedAt: '2026-08-20T16:29:05.000Z',
  priceTimestampVerified: true,
  session: 'regular-market',
}, { now, exchangeOpen: true });
assert.equal(licensedUs.identityReady, true);
assert.equal(licensedUs.valuationReady, true);
assert.equal(licensedUs.decisionReady, true);

const weekendClosedUs = evaluateMobileQuoteIntegrity('SPCE.US', {
  nativePrice: 3.06,
  nativeCurrency: 'USD',
  providerSymbol: 'SPCE',
  source: 'Finnhub US quote',
  quality: 'realtime',
  updatedAt: '2026-08-21T20:00:00.000Z',
  checkedAt: '2026-08-22T10:12:00.000Z',
  priceTimestampVerified: true,
  session: 'regular-market',
}, { now: '2026-08-22T10:15:00.000Z', exchangeOpen: false, exchangeSession: 'closed' });
assert.equal(weekendClosedUs.identityReady, true);
assert.equal(weekendClosedUs.valuationReady, true);
assert.equal(weekendClosedUs.decisionReady, false);
assert.equal(weekendClosedUs.closedMarketReferenceEligible, true);
assert.equal(weekendClosedUs.publicStatus, 'CLOSED_MARKET_REFERENCE');
assert.ok(weekendClosedUs.decisionBlockers.includes('QUOTE_DECISION_FRESHNESS_NOT_VERIFIED'));
assert.ok(!weekendClosedUs.valuationBlockers.includes('QUOTE_FRESHNESS_NOT_VERIFIED'));

const oldCloseWhileMarketOpen = evaluateMobileQuoteIntegrity('SPCE.US', {
  nativePrice: 3.06,
  nativeCurrency: 'USD',
  providerSymbol: 'SPCE',
  source: 'Finnhub US quote',
  quality: 'realtime',
  updatedAt: '2026-08-21T20:00:00.000Z',
  checkedAt: '2026-08-24T14:01:00.000Z',
  priceTimestampVerified: true,
  session: 'regular-market',
}, { now: '2026-08-24T14:02:00.000Z', exchangeOpen: true, exchangeSession: 'regular-market' });
assert.equal(oldCloseWhileMarketOpen.valuationReady, false);
assert.equal(oldCloseWhileMarketOpen.decisionReady, false);
assert.equal(oldCloseWhileMarketOpen.publicStatus, 'STALE');

const fallbackUs = evaluateMobileQuoteIntegrity('ABCD.US', {
  nativePrice: 20,
  nativeCurrency: 'USD',
  providerSymbol: 'ABCD',
  source: 'Yahoo Finance 1m-bar (εφεδρική πηγή)',
  quality: 'unofficial',
  updatedAt: '2026-08-20T16:29:00.000Z',
  checkedAt: '2026-08-20T16:29:05.000Z',
  priceTimestampVerified: true,
  session: 'regular-market',
}, { now, exchangeOpen: true });
assert.equal(fallbackUs.valuationReady, false);
assert.equal(fallbackUs.decisionReady, false);
assert.ok(fallbackUs.blockers.includes('QUOTE_SOURCE_NOT_APPROVED'));

const delayedAthens = evaluateMobileQuoteIntegrity('XYZ.GR', {
  nativePrice: 12.34,
  nativeCurrency: 'EUR',
  providerSymbol: 'XYZ',
  source: 'Euronext Athens — επίσημα δεδομένα με καθυστέρηση 15′',
  quality: 'primary_exchange_delayed',
  updatedAt: null,
  checkedAt: '2026-08-20T16:29:00.000Z',
  advertisedDelayMinutes: 15,
  priceTimestampVerified: false,
}, { now });
assert.equal(delayedAthens.identityReady, true);
assert.equal(delayedAthens.valuationReady, true);
assert.equal(delayedAthens.decisionReady, false);
assert.equal(delayedAthens.publicStatus, 'TIMESTAMP_NOT_VERIFIED');
assert.ok(delayedAthens.blockers.includes('QUOTE_TIMESTAMP_NOT_VERIFIED'));

const wrongSymbol = evaluateMobileQuoteIntegrity('ABCD.US', {
  nativePrice: 20,
  nativeCurrency: 'USD',
  providerSymbol: 'WRONG',
  source: 'Finnhub US quote',
  quality: 'realtime',
  updatedAt: '2026-08-20T16:29:00.000Z',
  checkedAt: '2026-08-20T16:29:05.000Z',
  priceTimestampVerified: true,
}, { now });
assert.equal(wrongSymbol.valuationReady, false);
assert.ok(wrongSymbol.blockers.includes('QUOTE_INSTRUMENT_MISMATCH'));

const wrongCurrency = evaluateMobileQuoteIntegrity('ABCD.US', {
  nativePrice: 20,
  nativeCurrency: 'EUR',
  providerSymbol: 'ABCD',
  source: 'Finnhub US quote',
  quality: 'realtime',
  updatedAt: '2026-08-20T16:29:00.000Z',
  checkedAt: '2026-08-20T16:29:05.000Z',
  priceTimestampVerified: true,
}, { now });
assert.equal(wrongCurrency.valuationReady, false);
assert.ok(wrongCurrency.blockers.includes('QUOTE_CURRENCY_MISMATCH'));

const market = read('src/market-data.js');
const portfolio = read('PortfolioApp.js');
const quoteContract = read('src/quote-contract.js');
const integritySource = read('src/instrument-quote-integrity.js');
const app = JSON.parse(read('app.json'));
const pkg = JSON.parse(read('package.json'));

assert.ok(!market.includes('EURONEXT_ATHENS_URLS'));
assert.ok(!market.includes("symbol === 'SPCE.US'"));
assert.ok(market.includes("if (route.market === 'US')"));
assert.ok(market.includes("if (route.market === 'GR')"));
assert.ok(market.includes('exchangeOpen: exchange.open'));
assert.ok(!market.includes("quote?.nativeCurrency || (symbol.endsWith('.US') ? 'USD' : 'EUR')"));
assert.ok(quoteContract.includes("MOBILE_QUOTE_CONTRACT_VERSION = '2026-08-20.2'"));
assert.ok(quoteContract.includes('evaluateMobileQuoteIntegrity'));
assert.ok(integritySource.includes("MOBILE_INSTRUMENT_INTEGRITY_VERSION = '2026-08-22.1'"));
assert.ok(integritySource.includes('CLOSED_MARKET_REFERENCE'));
assert.ok(portfolio.includes('positionCurrencyVerified'));
assert.ok(portfolio.includes('route.expectedCurrency === position.currency'));
assert.ok(portfolio.includes("<View style={{ alignItems: 'flex-start', marginTop: 10 }}>"));
assert.ok(portfolio.includes("{ maxWidth: '100%' }"));
assert.equal(app.expo.version, '1.7.3');
assert.equal(app.expo.android.versionCode, 31);
assert.equal(pkg.version, '1.7.3');

console.log('Investor Control v1.7.3 universal instrument integrity verification passed, including closed-market valuation and mobile card layout regression coverage.');
