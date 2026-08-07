import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeMarketSnapshot } from '../src/canonical-market-quote.js';
import { buildResearchDossier } from '../src/research-dossier.js';
import { evaluateFinalAction } from '../src/final-action-policy.js';

const now = '2026-08-07T12:00:00.000Z';

function athensCompany() {
  return {
    companyId: 'company:allwyn-ag',
    displayName: 'Allwyn',
    country: 'GR',
    currency: 'EUR',
    primaryListing: { symbol: 'ALWN', mic: 'XATH', exchange: 'Euronext Athens' },
  };
}

function officialDelayedQuote() {
  return canonicalizeMarketSnapshot({
    companyId: 'company:allwyn-ag',
    companyName: 'Allwyn',
    symbol: 'ALWN',
    currency: 'EUR',
    source: 'Euronext Athens delayed market data',
    sourceUrl: 'https://athens.euronext.com/en/market-data/instruments/stocks/ALWN/related',
    sourceQuality: 'OFFICIAL_DELAYED',
    advertisedDelayMinutes: 15,
    generatedAt: now,
    quoteAt: now,
    quoteTimestampVerified: false,
    currentPrice: 13.425,
    previousClose: 13.29,
    usable: true,
    stale: false,
  }, athensCompany(), { generatedAt: now });
}

test('official delayed Athens quote is analysis-grade but never execution-grade without a verified quote timestamp', () => {
  const quote = officialDelayedQuote();
  assert.equal(quote.quoteContract.valuationEligible, true);
  assert.equal(quote.quoteContract.analysisReferenceEligible, true);
  assert.equal(quote.quoteContract.executionFreshnessEligible, false);
  assert.equal(quote.quoteContract.decisionEligible, false);
  assert.equal(quote.quoteContract.freshnessModel, 'OFFICIAL_BOUNDED_DELAY_ANALYSIS_ONLY');
  assert.ok(quote.quoteContract.diagnosticCodes.includes('QUOTE_ANALYSIS_REFERENCE_ONLY'));
});

test('research dossier uses the current official delayed quote as analysis reference instead of an older historical close', () => {
  const quote = officialDelayedQuote();
  const dossier = buildResearchDossier({
    company: athensCompany(),
    generatedAt: now,
    marketSnapshot: quote,
    historicalMarketMetrics: {
      latestClose: 13.29,
      latestTimestamp: Date.parse('2026-08-06T15:00:00.000Z') / 1000,
    },
    evidence: [],
  });

  assert.equal(dossier.referencePrice.value, 13.425);
  assert.equal(dossier.referencePrice.purpose, 'ANALYSIS_REFERENCE');
  assert.equal(dossier.referencePrice.executionFreshnessEligible, false);
  assert.equal(dossier.referencePrice.freshnessModel, 'OFFICIAL_BOUNDED_DELAY_ANALYSIS_ONLY');
});

function completeDossier(executionFreshnessEligible) {
  const timestamp = now;
  return {
    generatedAt: timestamp,
    status: 'REVIEW_READY',
    readiness: { publishable: true },
    proposedAction: 'CONSIDER_BUY',
    referencePrice: {
      value: 10,
      currency: 'EUR',
      timestamp,
      source: 'Test market source',
      purpose: 'ANALYSIS_REFERENCE',
      analysisReferenceEligible: true,
      decisionEligible: executionFreshnessEligible,
      freshnessModel: executionFreshnessEligible ? 'VERIFIED_TIMESTAMP' : 'OFFICIAL_BOUNDED_DELAY_ANALYSIS_ONLY',
      executionFreshnessEligible,
    },
    reviewDate: '2026-08-08',
    evidence: [{ id: 'a' }, { id: 'b' }],
    metrics: {
      crossCheck: { recommendationReady: true, contradictionCount: 0 },
      fundamentals: { metricsReady: true },
      fundamentalRisk: { metricsReady: true, riskScore: 20, flags: [] },
      market: {
        readiness: { marketMetricsReady: true },
        dataQuality: { sourceReady: true, crossCheckReady: true, benchmarkReady: true },
        latestTimestamp: Date.parse(timestamp) / 1000,
        liquidity: { score: 80 },
        relativeStrength: { excessReturnPct: 8 },
        trend: { distanceFromSma50Pct: 5, distanceFromSma200Pct: 3 },
        risk: { flags: [] },
      },
    },
  };
}

test('BUY_NOW is impossible when the evidence is complete but the price is analysis-only', () => {
  const result = evaluateFinalAction(completeDossier(false), { now });
  assert.equal(result.status, 'FINAL');
  assert.equal(result.marketAction, 'WATCH');
  assert.equal(result.nonHolderAction, 'DO_NOT_BUY');
  assert.equal(result.freshness.executionFreshnessEligible, false);
  assert.ok(result.reasons.includes('EXECUTION_PRICE_NOT_VERIFIED'));
});

test('BUY_NOW remains available when all evidence and execution-grade freshness gates are satisfied', () => {
  const result = evaluateFinalAction(completeDossier(true), { now });
  assert.equal(result.status, 'FINAL');
  assert.equal(result.marketAction, 'BUY_NOW');
  assert.equal(result.nonHolderAction, 'BUY_NOW');
  assert.equal(result.freshness.executionFreshnessEligible, true);
});
