import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanonicalQuoteRegistry,
  canonicalizeMarketSnapshot,
} from '../src/canonical-market-quote.js';

const generatedAt = '2026-08-04T12:00:00.000Z';

test('official Euronext quote is eligible for valuation and decisions when fresh', () => {
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
  assert.equal(quote.quoteContract.decisionEligible, false);
  assert.equal(quote.usable, false);
  assert.equal(quote.quoteContract.publicStatus, 'FALLBACK_NOT_VERIFIED');
});

test('stale licensed quote is blocked even when the provider is approved', () => {
  const company = {
    companyId: 'company:virgin-galactic-holdings',
    displayName: 'Virgin Galactic',
    country: 'US',
    primaryListing: { symbol: 'SPCE', mic: 'XNYS', exchange: 'New York Stock Exchange' },
  };
  const quote = canonicalizeMarketSnapshot({
    companyId: company.companyId,
    symbol: 'SPCE',
    currency: 'USD',
    source: 'Finnhub US quote',
    sourceUrl: 'https://finnhub.io/api/v1/quote',
    sourceQuality: 'PRIMARY_LICENSED',
    generatedAt,
    quoteAt: '2026-08-03T20:00:00.000Z',
    quoteTimestampVerified: true,
    currentPrice: 2.82,
    previousClose: 2.55,
    usable: true,
    stale: false,
  }, company, { generatedAt, maxCanonicalQuoteAgeHours: 6 });

  assert.equal(quote.quoteContract.valuationEligible, false);
  assert.equal(quote.quoteContract.decisionEligible, false);
  assert.ok(quote.quoteContract.diagnosticCodes.includes('QUOTE_STALE'));
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
