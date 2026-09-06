const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function exposeExports(source, filename, injected = {}) {
  const exported = [];
  let transformed = source
    .replace(/^import .*$/gm, '')
    .replace(/export const\s+([A-Za-z0-9_]+)\s*=/g, (_, name) => {
      exported.push(name);
      return `const ${name} =`;
    })
    .replace(/export function\s+([A-Za-z0-9_]+)\s*\(/g, (_, name) => {
      exported.push(name);
      return `function ${name}(`;
    });
  transformed += `\nmodule.exports = { ${[...new Set(exported)].join(', ')} };\n`;
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    Date,
    Intl,
    Number,
    String,
    Object,
    Set,
    Math,
    RegExp,
    ...injected,
  };
  vm.runInNewContext(transformed, sandbox, { filename });
  return sandbox.module.exports;
}

const marketRules = exposeExports(read('src/market-rules.js'), 'market-rules.js');
const integrity = exposeExports(
  read('src/instrument-quote-integrity.js'),
  'instrument-quote-integrity.js',
  { MARKET_RULES: marketRules.MARKET_RULES },
);

assert.equal(marketRules.MARKET_RULES.GR.currency, 'EUR');
assert.equal(marketRules.MARKET_RULES.GR.timeZone, 'Europe/Athens');
assert.equal(marketRules.MARKET_RULES.GR.sessions.regularStart, 10 * 60 + 15);
assert.equal(marketRules.MARKET_RULES.GR.sessions.regularEnd, 17 * 60 + 20);
assert.equal(marketRules.MARKET_RULES.GR.advertisedDelayMinutes, 15);

const beforeOpen = marketRules.marketStateForSymbol('ALPHA.GR', new Date('2026-08-24T07:14:59.000Z'));
assert.equal(beforeOpen.open, false);
assert.equal(beforeOpen.session, 'closed');
assert.equal(beforeOpen.calendarVerified, true);

const atOpen = marketRules.marketStateForSymbol('ALPHA.GR', new Date('2026-08-24T07:15:00.000Z'));
assert.equal(atOpen.open, true);
assert.equal(atOpen.session, 'regular-market');
assert.equal(atOpen.localDate, '2026-08-24');

const beforeClose = marketRules.marketStateForSymbol('ALPHA.GR', new Date('2026-08-24T14:19:59.000Z'));
assert.equal(beforeClose.open, true);

const atClose = marketRules.marketStateForSymbol('ALPHA.GR', new Date('2026-08-24T14:20:00.000Z'));
assert.equal(atClose.open, false);
assert.equal(atClose.session, 'closed');

const nationalHoliday = marketRules.marketStateForSymbol('CREDIA.GR', new Date('2026-10-28T09:00:00.000Z'));
assert.equal(nationalHoliday.open, false);
assert.equal(nationalHoliday.holiday, true);
assert.equal(nationalHoliday.closeReason, 'holiday');
assert.equal(nationalHoliday.calendarVerified, true);

const christmasEve = marketRules.marketStateForSymbol('ALWN.GR', new Date('2026-12-24T10:00:00.000Z'));
assert.equal(christmasEve.open, false);
assert.equal(christmasEve.holiday, true);

const futureUnverified = marketRules.marketStateForSymbol('ALPHA.GR', new Date('2028-01-03T10:00:00.000Z'));
assert.equal(futureUnverified.open, false);
assert.equal(futureUnverified.calendarVerified, false);
assert.equal(futureUnverified.closeReason, 'calendar-unverified');

const unsupported = marketRules.marketStateForSymbol('VOD.L', new Date('2026-08-24T10:00:00.000Z'));
assert.equal(unsupported.open, false);
assert.equal(unsupported.session, 'unsupported');

const usRegular = marketRules.marketStateForSymbol('SPCE.US', new Date('2026-08-24T15:00:00.000Z'));
assert.equal(usRegular.market, 'US');
assert.equal(usRegular.open, true);
assert.equal(usRegular.session, 'regular-market');

// Live-device regression from 2026-09-06: Finnhub timestamped the Friday close
// exactly at 16:00:00 New York (20:00 UTC). That is the regular-session closing
// print, not a post-market quote. One second later is post-market.
const usExactFridayClose = marketRules.marketStateForSymbol('SPCE.US', new Date('2026-09-04T20:00:00.000Z'));
assert.equal(usExactFridayClose.session, 'regular-market');
const usAfterFridayClose = marketRules.marketStateForSymbol('SPCE.US', new Date('2026-09-04T20:00:01.000Z'));
assert.equal(usAfterFridayClose.session, 'post-market');

const sundayState = marketRules.marketStateForSymbol('SPCE.US', new Date('2026-09-06T19:37:35.000Z'));
assert.equal(sundayState.open, false);
assert.equal(sundayState.session, 'closed');

const spceWeekendClose = integrity.evaluateMobileQuoteIntegrity('SPCE.US', {
  nativePrice: 3.08,
  nativePreviousClose: 3.08,
  nativeCurrency: 'USD',
  providerSymbol: 'SPCE',
  source: 'Finnhub US quote',
  quality: 'realtime',
  updatedAt: '2026-09-04T20:00:00.000Z',
  checkedAt: '2026-09-06T19:37:35.000Z',
  priceTimestampVerified: true,
  session: usExactFridayClose.session,
}, {
  now: '2026-09-06T19:37:35.000Z',
  exchangeOpen: sundayState.open,
  exchangeSession: sundayState.session,
  exchangeCalendarVerified: true,
});
assert.equal(spceWeekendClose.closedMarketReferenceEligible, true);
assert.equal(spceWeekendClose.valuationReady, true);
assert.equal(spceWeekendClose.decisionReady, false);
assert.equal(spceWeekendClose.publicStatus, 'CLOSED_MARKET_REFERENCE');
assert.ok(spceWeekendClose.decisionBlockers.includes('QUOTE_DECISION_FRESHNESS_NOT_VERIFIED'));
assert.ok(!spceWeekendClose.valuationBlockers.includes('QUOTE_FRESHNESS_NOT_VERIFIED'));

const routedGreek = integrity.routeMobileInstrument('CREDIA.GR');
assert.equal(routedGreek.supported, true);
assert.equal(routedGreek.market, 'GR');
assert.equal(routedGreek.expectedCurrency, 'EUR');
assert.equal(routedGreek.timeZone, 'Europe/Athens');
assert.equal(routedGreek.advertisedDelayMinutes, 15);

const officialGreekQuote = {
  nativePrice: 0.965,
  nativePreviousClose: 0.979,
  nativeCurrency: 'EUR',
  providerSymbol: 'CREDIA',
  source: 'Euronext Athens — επίσημα δεδομένα με καθυστέρηση 15′',
  quality: 'primary_exchange_delayed',
  updatedAt: null,
  checkedAt: '2026-08-24T12:00:00.000Z',
  advertisedDelayMinutes: 15,
  priceTimestampVerified: false,
  session: 'regular-market',
};

const officialIntegrity = integrity.evaluateMobileQuoteIntegrity(
  'CREDIA.GR',
  officialGreekQuote,
  { now: '2026-08-24T12:01:00.000Z', exchangeOpen: true, exchangeSession: 'regular-market', exchangeCalendarVerified: true },
);
assert.equal(officialIntegrity.identityReady, true);
assert.equal(officialIntegrity.valuationReady, true);
assert.equal(officialIntegrity.decisionReady, false);
assert.equal(officialIntegrity.publicStatus, 'TIMESTAMP_NOT_VERIFIED');
assert.equal(officialIntegrity.exchangeCalendarVerified, true);

const unverifiedCalendarIntegrity = integrity.evaluateMobileQuoteIntegrity(
  'CREDIA.GR',
  officialGreekQuote,
  { now: '2028-01-03T12:01:00.000Z', exchangeOpen: false, exchangeSession: 'closed', exchangeCalendarVerified: false },
);
assert.equal(unverifiedCalendarIntegrity.valuationReady, false);
assert.equal(unverifiedCalendarIntegrity.decisionReady, false);
assert.equal(unverifiedCalendarIntegrity.publicStatus, 'CALENDAR_NOT_VERIFIED');
assert.ok(unverifiedCalendarIntegrity.blockers.includes('EXCHANGE_CALENDAR_NOT_VERIFIED'));

const yahooFallback = integrity.evaluateMobileQuoteIntegrity('CREDIA.GR', {
  nativePrice: 0.96,
  nativeCurrency: 'EUR',
  providerSymbol: 'CREDIA.AT',
  source: 'Yahoo Finance 1m-bar (εφεδρική πηγή)',
  quality: 'unofficial',
  updatedAt: '2026-08-24T12:00:00.000Z',
  checkedAt: '2026-08-24T12:00:05.000Z',
  priceTimestampVerified: true,
  session: 'regular-market',
}, { now: '2026-08-24T12:01:00.000Z', exchangeOpen: true, exchangeCalendarVerified: true });
assert.equal(yahooFallback.identityReady, true);
assert.equal(yahooFallback.valuationReady, false);
assert.equal(yahooFallback.decisionReady, false);
assert.equal(yahooFallback.publicStatus, 'FALLBACK_NOT_VERIFIED');

const marketSource = read('src/market-data.js');
assert.ok(marketSource.includes("import { marketStateForSymbol } from './market-rules';"));
assert.ok(!marketSource.includes('function zoneParts('));
assert.ok(!marketSource.includes('17 * 60 + 25'));
assert.ok(marketSource.includes("EURONEXT_ATHENS_STOCK_URL"));
assert.ok(marketSource.includes("primary_exchange_delayed"));
assert.ok(marketSource.includes("exchangeCalendarVerified: exchange.calendarVerified !== false"));
assert.ok(marketSource.includes("official Euronext Athens stock page identity not verified"));

console.log('Market invariants PASS: Athens 10:15-17:20/calendar rules + exact US closing-print weekend carry + currency/source fail-closed behavior.');
