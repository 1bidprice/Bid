import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFinalAction } from '../src/final-action-policy.js';

const NOW = '2026-08-08T12:00:00.000Z';

function dossier(decisionBasis = 'FUNDAMENTAL_BASELINE') {
  const companyId = 'company:test:baseline';
  return {
    companyId,
    companyName: 'Baseline Test Company',
    assetClass: 'EQUITY',
    listing: { symbol: 'BASE', exchange: 'NYSE', mic: 'XNYS', currency: 'USD' },
    integrityContractVersion: 1,
    listingIntegrity: { activeTradingVerified: true, lifecycleStatus: 'ACTIVE', verifiedAt: NOW },
    status: 'REVIEW_READY',
    generatedAt: NOW,
    reviewDate: '2026-09-30',
    readiness: { publishable: true },
    decisionBasis,
    proposedAction: 'HOLD',
    referencePrice: {
      value: 20,
      currency: 'USD',
      nativeCurrency: 'USD',
      timestamp: '2026-08-06T20:00:00.000Z',
      source: 'Licensed historical market data',
      companyId,
      appSymbol: 'BASE',
      sourceApproved: true,
      timestampVerified: false,
      purpose: 'HISTORICAL_REFERENCE',
      analysisReferenceEligible: true,
      executionFreshnessEligible: false,
      decisionEligible: false,
      freshnessModel: 'HISTORICAL_CLOSE',
    },
    evidence: [
      { evidenceId: 'evidence:f', companyIds: [companyId] },
      { evidenceId: 'evidence:m', companyIds: [companyId] },
    ],
    metrics: {
      crossCheck: { recommendationReady: false, contradictionCount: 0 },
      decisionCorroboration: { ready: decisionBasis === 'FUNDAMENTAL_BASELINE' },
      fundamentals: { metricsReady: true },
      fundamentalRisk: { metricsReady: true, riskScore: 35, flags: [] },
      market: {
        readiness: {
          priceHistoryReady: true,
          liquidityReady: true,
          relativeStrengthReady: true,
          sourceReady: true,
          crossCheckReady: true,
          benchmarkReady: true,
          marketMetricsReady: true,
        },
        dataQuality: {
          sourceReady: true,
          crossCheckReady: true,
          benchmarkReady: true,
          historySource: 'LICENSED_MARKET_DATA',
          benchmarkSource: 'LICENSED_MARKET_DATA',
        },
        latestTimestamp: 1786132800,
        liquidity: { score: 80 },
        relativeStrength: { excessReturnPct: 4 },
        trend: { distanceFromSma50Pct: 3, distanceFromSma200Pct: 5 },
        risk: { flags: [] },
      },
    },
  };
}

test('fundamental baseline can be FINAL HOLD with an analysis-grade close even when the event cross-check is not ready', () => {
  const result = evaluateFinalAction(dossier(), { now: NOW });
  assert.equal(result.status, 'FINAL', JSON.stringify(result, null, 2));
  assert.equal(result.marketAction, 'HOLD');
  assert.equal(result.holderAction, 'HOLD');
  assert.equal(result.nonHolderAction, 'WATCH');
  assert.equal(result.freshness.executionFreshnessEligible, false);
  assert.ok(!result.blockers.includes('CROSS_CHECK_NOT_READY'));
  assert.ok(!result.blockers.includes('REFERENCE_PRICE_STALE'));
  assert.ok(!result.blockers.includes('MARKET_HISTORY_SOURCE_NOT_READY'));
  assert.ok(!result.blockers.includes('MARKET_HISTORY_NOT_CROSSCHECKED'));
  assert.ok(!result.blockers.includes('MARKET_BENCHMARK_NOT_READY'));
});

test('event-driven dossier remains blocked when its actual event claim lacks independent corroboration', () => {
  const result = evaluateFinalAction(dossier('EVENT_DRIVEN'), { now: NOW });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.includes('CROSS_CHECK_NOT_READY'));
  assert.equal(result.marketAction, 'WATCH');
});
