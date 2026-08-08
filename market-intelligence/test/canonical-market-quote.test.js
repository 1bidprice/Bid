import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanonicalQuoteRegistry,
  canonicalizeMarketSnapshot,
} from '../src/canonical-market-quote.js';

const generatedAt = '2026-08-04T12:00:00.000Z';

function usCompany() {
  return {
    companyId: 'company:test-us',
    displayName: 'Test US Equity',
    country: 'US',
    primaryListing: { symbol: 'TEST', mic: 'XNYS', exchange: 'New York Stock Exchange' },
  };
}

function licensedUsQuote({ quoteAt, checkedAt, currentPrice = 10, previousClose = 9.8 }) {
  const company = usCompany();
  return canonicalizeMarketSnapshot({
    companyId: company.companyId,
    symbol: 'TEST',
    currency: 'USD',
    source: 'Finnhub US quote',
    sourceUrl: 'https://finnhub.io/api/v1/quote',
    sourceQuality: 'PRIMARY_LICENSED',
    generatedAt: checkedAt,
    quoteAt,
    quoteTimestampVerified: true,
    currentPrice,
    previousClose,
    usable: true,
    stale: false,
  }, company, { generatedAt: checkedAt, maxCanonicalQuoteAgeHours: 6 });
}

test('official Euronext quote is eligible for valuation and decisions when fresh during the core session', () => {
  const company = {
    companyId: 'company:allwyn-ag',
    displayName: 'Allwyn',
    country: 'GR',
    primaryListing: { symbol: 'ALWN', mic: 'XATH', exchange: 'Euronext Athens' },
  };
  const quote = canonicalizeMarketSnapshot({
    companyId: company.companyId,
    symbol: 'ALWN',
    currency: 'EUR',
    source: 'Euronext Athens official delayed quote',
    sourceUrl: 'https://athens.euronext.com/en/market-data/instruments/stocks/ALWN/related',
    sourceQuality: 'PRIMARY_EXCHANGE',
    generatedAt,
    quoteAt: '2026-08-04T11:45:00.000Z',
    quoteTimestampVerified: true,
    advertisedDelayMinutes: 15,
    currentPrice: 13.64,
    previousClose: 13.45,
    usable: true,
    stale: false,
  }, company, { generatedAt });

  assert.equal(quote.appSymbol, 'ALWN.GR');
  assert.equal(quote.quoteContract.valuationEligible, true);
  assert.equal(quote.quoteContract.analysisReferenceEligible, true);
  assert.equal(quote.quoteContract.executionFreshnessEligible, true);
  assert.equal(quote.quoteContract.decisionEligible, true);
  assert.equal(quote.quoteContract.dayChangeEligible, true);
  assert.equal(quote.usable, true);
});

test('Yahoo Athens fallback is information-only and never decision eligible', () => {
  const company = {
    companyId: 'company:crediabank',
    displayName: 'CrediaBank',
    country: 'GR',
    primaryListing: { symbol: 'CREDIA', mic: 'XATH', exchange: 'Euronext Athens' },
  };
  const quote = canonicalizeMarketSnapshot({
    companyId: company.companyId,
    symbol: 'CREDIA',
    currency: 'EUR',
    source: 'Yahoo Finance Chart fallback',
    sourceUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/CREDIA.AT',
    sourceQuality: 'SECONDARY_FALLBACK',
    generatedAt,
    quoteAt: '2026-08-04T11:55:00.000Z',
    quoteTimestampVerified: true,
    currentPrice: 0.925,
    previousClose: 0.924,
    usable: true,
    stale: false,
  }, company, { generatedAt });

  assert.equal(quote.quoteContract.valuationEligible, false);
  assert.equal(quote.quoteContract.analysisReferenceEligible, false);
  assert.equal(quote.quoteContract.decisionEligible, false);
  assert.equal(quote.usable, false);
  assert.equal(quote.quoteContract.publicStatus, 'FALLBACK_NOT_VERIFIED');
});

test('last verified US close remains analysis and valuation grade before the next core session, never execution grade', () => {
  const quote = licensedUsQuote({
    quoteAt: '2026-08-03T20:00:00.000Z',
    checkedAt: '2026-08-04T12:00:00.000Z',
  });

  assert.equal(quote.stale, false);
  assert.equal(quote.quoteContract.valuationEligible, true);
  assert.equal(quote.quoteContract.analysisReferenceEligible, true);
  assert.equal(quote.quoteContract.executionFreshnessEligible, false);
  assert.equal(quote.quoteContract.decisionEligible, false);
  assert.equal(quote.quoteContract.freshnessModel, 'CLOSED_MARKET_LAST_VERIFIED_CLOSE');
  assert.equal(quote.quoteContract.marketSessionState, 'PRE_OPEN');
  assert.ok(quote.quoteContract.diagnosticCodes.includes('QUOTE_CLOSED_MARKET_LAST_CLOSE'));
  assert.ok(quote.quoteContract.diagnosticCodes.includes('QUOTE_EXECUTION_MARKET_CLOSED'));
});

test('Friday verified close remains analysis-grade on Saturday', () => {
  const quote = licensedUsQuote({
    quoteAt: '2026-08-07T20:00:00.000Z',
    checkedAt: '2026-08-08T13:45:00.000Z',
  });

  assert.equal(quote.quoteContract.marketSessionState, 'WEEKEND');
  assert.equal(quote.quoteContract.valuationEligible, true);
  assert.equal(quote.quoteContract.analysisReferenceEligible, true);
  assert.equal(quote.quoteContract.executionFreshnessEligible, false);
  assert.equal(quote.quoteContract.freshnessModel, 'CLOSED_MARKET_LAST_VERIFIED_CLOSE');
});

test('an older close is rejected when a normal weekday session has intervened', () => {
  const quote = licensedUsQuote({
    quoteAt: '2026-08-06T20:00:00.000Z',
    checkedAt: '2026-08-08T13:45:00.000Z',
  });

  assert.equal(quote.stale, true);
  assert.equal(quote.quoteContract.valuationEligible, false);
  assert.equal(quote.quoteContract.analysisReferenceEligible, false);
  assert.equal(quote.quoteContract.executionFreshnessEligible, false);
  assert.ok(quote.quoteContract.diagnosticCodes.includes('QUOTE_STALE'));
});

test('prior close is not carried into a regular core session when it is older than the strict freshness window', () => {
  const quote = licensedUsQuote({
    quoteAt: '2026-08-07T20:00:00.000Z',
    checkedAt: '2026-08-10T15:00:00.000Z',
  });

  assert.equal(quote.quoteContract.marketSessionState, 'CORE_OPEN_EXPECTED');
  assert.equal(quote.stale, true);
  assert.equal(quote.quoteContract.valuationEligible, false);
  assert.equal(quote.quoteContract.analysisReferenceEligible, false);
  assert.equal(quote.quoteContract.executionFreshnessEligible, false);
});

test('fresh verified quote during the US core session remains execution-grade', () => {
  const quote = licensedUsQuote({
    quoteAt: '2026-08-10T15:00:00.000Z',
    checkedAt: '2026-08-10T15:02:00.000Z',
  });

  assert.equal(quote.quoteContract.marketSessionState, 'CORE_OPEN_EXPECTED');
  assert.equal(quote.quoteContract.valuationEligible, true);
  assert.equal(quote.quoteContract.analysisReferenceEligible, true);
  assert.equal(quote.quoteContract.executionFreshnessEligible, true);
  assert.equal(quote.quoteContract.decisionEligible, true);
  assert.equal(quote.quoteContract.freshnessModel, 'VERIFIED_TIMESTAMP');
});

test('registry publishes one canonical quote per app symbol', () => {
  const registry = buildCanonicalQuoteRegistry([
    {
      appSymbol: 'SPCE.US',
      companyId: 'company:virgin-galactic-holdings',
      companyName: 'Virgin Galactic',
      currentPrice: 2.82,
      previousClose: 2.55,
      currency: 'USD',
      quoteAt: '2026-08-04T11:58:00.000Z',
      generatedAt,
      source: 'Finnhub US quote',
      quoteContract: { valuationEligible: true, decisionEligible: true },
    },
  ]);
  assert.equal(registry['SPCE.US'].price, 2.82);
  assert.equal(registry['SPCE.US'].quoteContract.decisionEligible, true);
});
