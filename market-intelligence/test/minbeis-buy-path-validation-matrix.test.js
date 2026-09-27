import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFinalAction } from '../src/final-action-policy.js';
import { reconcileOpportunityPurchaseDecisions } from '../src/opportunity-purchase-reconciliation.js';
import { buildMinbeisDecision, MINBEIS_ACTIONS } from '../src/minbeis-decision-layer.js';

const NOW = '2026-08-10T14:00:00.000Z';

function dossier(overrides = {}) {
  const companyId = 'company:buy-matrix';
  const base = {
    dossierId: 'dossier:buy-matrix:1',
    companyId,
    companyName: 'BUY Matrix Company',
    symbol: 'MATRIX',
    assetClass: 'EQUITY',
    listing: { symbol: 'MATRIX', exchange: 'NYSE', mic: 'XNYS', currency: 'USD' },
    integrityContractVersion: 1,
    listingIntegrity: { activeTradingVerified: true, lifecycleStatus: 'ACTIVE', verifiedAt: NOW },
    generatedAt: '2026-08-10T13:30:00.000Z',
    status: 'REVIEW_READY',
    category: 'FUNDAMENTAL_BASELINE',
    proposedAction: 'CONSIDER_BUY',
    referencePrice: {
      value: 100,
      currency: 'USD',
      nativeCurrency: 'USD',
      timestamp: '2026-08-10T13:45:00.000Z',
      source: 'Verified market feed',
      companyId,
      appSymbol: 'MATRIX',
      sourceApproved: true,
      timestampVerified: true,
      purpose: 'ANALYSIS_REFERENCE',
      freshnessModel: 'VERIFIED_TIMESTAMP',
      analysisReferenceEligible: true,
      executionFreshnessEligible: true,
      decisionEligible: true,
    },
    evidence: [
      { evidenceId: 'a', companyIds: [companyId] },
      { evidenceId: 'b', companyIds: [companyId] },
    ],
    reviewDate: '2026-09-10',
    readiness: { publishable: true, blockers: [] },
    metrics: {
      fundamentals: { metricsReady: true },
      fundamentalRisk: { metricsReady: true, riskScore: 35, flags: [] },
      market: {
        latestTimestamp: Math.floor(new Date('2026-08-10T13:45:00.000Z').getTime() / 1000),
        trend: { distanceFromSma50Pct: 5, distanceFromSma200Pct: 9 },
        liquidity: { score: 85 },
        relativeStrength: { excessReturnPct: 11 },
        risk: { flags: [] },
        dataQuality: { sourceReady: true, crossCheckReady: true, benchmarkReady: true },
        readiness: { marketMetricsReady: true },
      },
      crossCheck: { recommendationReady: true, contradictionCount: 0 },
    },
  };
  return {
    ...base,
    ...overrides,
    referencePrice: { ...base.referencePrice, ...(overrides.referencePrice || {}) },
    metrics: {
      ...base.metrics,
      ...(overrides.metrics || {}),
      fundamentalRisk: { ...base.metrics.fundamentalRisk, ...(overrides.metrics?.fundamentalRisk || {}) },
      market: {
        ...base.metrics.market,
        ...(overrides.metrics?.market || {}),
        trend: { ...base.metrics.market.trend, ...(overrides.metrics?.market?.trend || {}) },
        liquidity: { ...base.metrics.market.liquidity, ...(overrides.metrics?.market?.liquidity || {}) },
        relativeStrength: { ...base.metrics.market.relativeStrength, ...(overrides.metrics?.market?.relativeStrength || {}) },
        risk: { ...base.metrics.market.risk, ...(overrides.metrics?.market?.risk || {}) },
        dataQuality: { ...base.metrics.market.dataQuality, ...(overrides.metrics?.market?.dataQuality || {}) },
        readiness: { ...base.metrics.market.readiness, ...(overrides.metrics?.market?.readiness || {}) },
      },
      crossCheck: { ...base.metrics.crossCheck, ...(overrides.metrics?.crossCheck || {}) },
    },
  };
}

function strictAction(input = dossier()) {
  return evaluateFinalAction(input, { now: NOW });
}

function assertBuy(input, message) {
  const result = strictAction(input);
  assert.equal(result.status, 'FINAL', message);
  assert.equal(result.marketAction, 'BUY_NOW', message);
  assert.equal(result.nonHolderAction, 'BUY_NOW', message);
  return result;
}

function assertNoBuy(input, message) {
  const result = strictAction(input);
  assert.notEqual(result.marketAction, 'BUY_NOW', message);
  assert.notEqual(result.nonHolderAction, 'BUY_NOW', message);
  return result;
}

function opportunity({ score = 82, tier = 'HIGH_PRIORITY_CANDIDATE' } = {}) {
  return {
    ranking: {
      items: [{
        rank: 1,
        instrumentId: 'company:buy-matrix',
        displayName: 'BUY Matrix Company',
        assetClass: 'EQUITY',
        tier,
        opportunityScore: score,
        confidenceScore: 95,
      }],
    },
  };
}

test('positive path remains reachable with the current strict policy', () => {
  const result = assertBuy();
  assert.ok(result.confidenceScore >= 80);
  assert.ok(result.dataQualityScore >= 85);
  assert.deepEqual(result.reasons, ['BUY_GATES_CONFIRMED']);
});

test('fundamental-risk boundary is explicit: 55 passes, 56 does not', () => {
  assertBuy(dossier({ metrics: { fundamentalRisk: { riskScore: 55 } } }), 'risk 55 should pass');
  const blocked = assertNoBuy(dossier({ metrics: { fundamentalRisk: { riskScore: 56 } } }), 'risk 56 should not pass');
  assert.ok(blocked.reasons.includes('BUY_SETUP_NOT_CONFIRMED'));
});

test('liquidity boundary is explicit: 65 passes, 64 does not', () => {
  assertBuy(dossier({ metrics: { market: { liquidity: { score: 65 } } } }), 'liquidity 65 should pass');
  assertNoBuy(dossier({ metrics: { market: { liquidity: { score: 64 } } } }), 'liquidity 64 should not pass');
});

test('positive relative-strength boundary is strict', () => {
  assertBuy(dossier({ metrics: { market: { relativeStrength: { excessReturnPct: 0.01 } } } }), 'positive relative strength should pass');
  assertNoBuy(dossier({ metrics: { market: { relativeStrength: { excessReturnPct: 0 } } } }), 'zero relative strength should not pass');
});

test('SMA50 boundary is strict', () => {
  assertBuy(dossier({ metrics: { market: { trend: { distanceFromSma50Pct: 0.01 } } } }), 'positive SMA50 distance should pass');
  assertNoBuy(dossier({ metrics: { market: { trend: { distanceFromSma50Pct: 0 } } } }), 'zero SMA50 distance should not pass');
});

test('SMA200 tolerance boundary is strict: above -3 passes, -3 does not', () => {
  assertBuy(dossier({ metrics: { market: { trend: { distanceFromSma200Pct: -2.99 } } } }), 'SMA200 above -3 should pass');
  assertNoBuy(dossier({ metrics: { market: { trend: { distanceFromSma200Pct: -3 } } } }), 'SMA200 at -3 should not pass');
});

test('immediate price-age boundary is explicit: two hours passes, older does not', () => {
  assertBuy(dossier({ referencePrice: { timestamp: '2026-08-10T12:00:00.000Z' } }), 'two-hour-old price should pass');
  const older = assertNoBuy(dossier({ referencePrice: { timestamp: '2026-08-10T11:59:59.000Z' } }), 'older-than-two-hour price should not pass');
  assert.equal(older.urgency, 'NORMAL');
});

test('severe risk and non-execution-grade price can never become BUY', () => {
  const severe = assertNoBuy(dossier({
    metrics: { fundamentalRisk: { riskScore: 95, flags: ['CASH_RUNWAY_UNDER_ONE_YEAR'] } },
  }));
  assert.equal(severe.marketAction, 'AVOID');

  const stale = assertNoBuy(dossier({
    referencePrice: { decisionEligible: false, executionFreshnessEligible: false },
  }));
  assert.equal(stale.status, 'BLOCKED');
});

test('strict opportunity reconciliation reaches BUY_CONFIRMED and MINBEIS BUY_PROBE', () => {
  const reconciliation = reconcileOpportunityPurchaseDecisions(opportunity(), [dossier()], { now: NOW });
  const purchase = reconciliation.decisions[0];
  assert.equal(purchase.status, 'BUY_CONFIRMED');
  assert.equal(purchase.buyNowEligible, true);

  const decision = buildMinbeisDecision({
    finalAction: purchase.strictAction,
    opportunityPurchase: purchase,
    hasPosition: false,
  });
  assert.equal(decision.action, MINBEIS_ACTIONS.BUY_PROBE);
  assert.equal(decision.allocationPct, 0.5);
  assert.equal(decision.humanApprovalRequired, true);
  assert.equal(decision.automaticBrokerOrder, false);
});

test('exceptional confirmed opportunity reaches BUY_STARTER but BUY_CORE stays disabled in v1', () => {
  const reconciliation = reconcileOpportunityPurchaseDecisions(
    opportunity({ score: 91, tier: 'SUPER_OPPORTUNITY_CANDIDATE' }),
    [dossier()],
    { now: NOW },
  );
  const purchase = reconciliation.decisions[0];
  assert.equal(purchase.status, 'BUY_CONFIRMED');

  const decision = buildMinbeisDecision({
    finalAction: purchase.strictAction,
    opportunityPurchase: purchase,
    hasPosition: false,
  });
  assert.equal(decision.action, MINBEIS_ACTIONS.BUY_STARTER);
  assert.equal(decision.allocationPct, 1.0);
  assert.notEqual(decision.action, MINBEIS_ACTIONS.BUY_CORE);
  assert.equal(decision.automaticBrokerOrder, false);
});
