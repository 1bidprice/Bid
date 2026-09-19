import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileOpportunityPurchaseDecisions } from '../src/opportunity-purchase-reconciliation.js';

const NOW = '2026-08-10T14:00:00.000Z';

function opportunity(tier = 'HIGH_PRIORITY_CANDIDATE') {
  return {
    ranking: {
      items: [{
        rank: 1,
        instrumentId: 'company:test',
        displayName: 'Test Opportunity',
        assetClass: 'EQUITY',
        tier,
        opportunityScore: tier === 'SUPER_OPPORTUNITY_CANDIDATE' ? 91 : 80,
        confidenceScore: 92,
      }],
    },
  };
}

function dossier(overrides = {}) {
  const companyId = 'company:test';
  const base = {
    dossierId: 'dossier:test:1',
    companyId,
    companyName: 'Test Opportunity',
    symbol: 'TEST',
    assetClass: 'EQUITY',
    listing: { symbol: 'TEST', exchange: 'NYSE', mic: 'XNYS', currency: 'USD' },
    integrityContractVersion: 1,
    listingIntegrity: { activeTradingVerified: true, lifecycleStatus: 'ACTIVE', verifiedAt: NOW },
    generatedAt: '2026-08-10T13:30:00.000Z',
    status: 'REVIEW_READY',
    category: 'FUNDAMENTAL_BASELINE',
    proposedAction: 'HOLD',
    referencePrice: {
      value: 100,
      currency: 'USD',
      nativeCurrency: 'USD',
      timestamp: '2026-08-10T13:45:00.000Z',
      source: 'Verified market feed',
      companyId,
      appSymbol: 'TEST',
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
      fundamentalRisk: { metricsReady: true, riskScore: 30, flags: [] },
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
  return { ...base, ...overrides };
}

test('high-priority opportunity can become BUY_CONFIRMED only through the existing strict BUY_NOW policy', () => {
  const result = reconcileOpportunityPurchaseDecisions(opportunity(), [dossier()], { now: NOW });
  assert.equal(result.candidateCount, 1);
  assert.equal(result.counts.BUY_CONFIRMED, 1);
  const decision = result.decisions[0];
  assert.equal(decision.status, 'BUY_CONFIRMED');
  assert.equal(decision.buyNowEligible, true);
  assert.equal(decision.strictAction.marketAction, 'BUY_NOW');
  assert.equal(decision.strictAction.nonHolderAction, 'BUY_NOW');
  assert.equal(decision.automaticBrokerOrder, false);
  assert.equal(decision.nextGate, 'USER_EXECUTION_ONLY');
});

test('opportunity remains WAIT when valuation/quality are interesting but strict trend entry gates are not confirmed', () => {
  const weak = dossier({
    metrics: {
      ...dossier().metrics,
      market: {
        ...dossier().metrics.market,
        trend: { distanceFromSma50Pct: -4, distanceFromSma200Pct: 3 },
        relativeStrength: { excessReturnPct: -12 },
      },
    },
  });
  const result = reconcileOpportunityPurchaseDecisions(opportunity(), [weak], { now: NOW });
  const decision = result.decisions[0];
  assert.equal(decision.status, 'WAIT_FOR_ENTRY_CONFIRMATION');
  assert.equal(decision.buyNowEligible, false);
  assert.equal(decision.strictAction.marketAction, 'WATCH');
  assert.equal(decision.strictAction.nonHolderAction, 'DO_NOT_BUY');
  assert.ok(decision.whyNotBuyNow.includes('BUY_SETUP_NOT_CONFIRMED'));
});

test('severe risk rejects the opportunity even when the hunter ranked it highly', () => {
  const risky = dossier({
    metrics: {
      ...dossier().metrics,
      fundamentalRisk: { metricsReady: true, riskScore: 95, flags: ['CASH_RUNWAY_UNDER_ONE_YEAR'] },
    },
  });
  const result = reconcileOpportunityPurchaseDecisions(opportunity('SUPER_OPPORTUNITY_CANDIDATE'), [risky], { now: NOW });
  const decision = result.decisions[0];
  assert.equal(decision.status, 'REJECTED');
  assert.equal(decision.buyNowEligible, false);
  assert.equal(decision.strictAction.nonHolderAction, 'AVOID');
  assert.ok(decision.whyNotBuyNow.includes('CASH_RUNWAY_UNDER_ONE_YEAR'));
});

test('lower opportunity tiers never enter the strict buy-nomination lane', () => {
  const result = reconcileOpportunityPurchaseDecisions(opportunity('WATCHLIST_CANDIDATE'), [dossier()], { now: NOW });
  assert.equal(result.candidateCount, 0);
  assert.equal(result.decisions.length, 0);
});
