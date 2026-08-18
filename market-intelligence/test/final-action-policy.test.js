import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAutonomousPublicationPolicy, evaluateFinalAction } from '../src/final-action-policy.js';

const NOW = '2026-07-27T14:00:00.000Z';

function dossier(overrides = {}) {
  return {
    dossierId: 'dossier:test:1',
    companyId: 'company:test',
    companyName: 'Test Company',
    listing: { symbol: 'TEST', exchange: 'NYSE', mic: 'XNYS' },
    integrityContractVersion: 1,
    listingIntegrity: { activeTradingVerified: true, lifecycleStatus: 'ACTIVE', verifiedAt: NOW },
    generatedAt: '2026-07-27T13:30:00.000Z',
    status: 'REVIEW_READY',
    category: 'QUALITY_COMPOUNDER',
    proposedAction: 'CONSIDER_BUY',
    referencePrice: {
      value: 100,
      currency: 'USD',
      timestamp: '2026-07-27T13:45:00.000Z',
      source: 'Test feed',
      companyId: 'company:test',
      appSymbol: 'TEST',
      sourceApproved: true,
      timestampVerified: true,
      purpose: 'ANALYSIS_REFERENCE',
      freshnessModel: 'VERIFIED_TIMESTAMP',
      analysisReferenceEligible: true,
      executionFreshnessEligible: true,
      decisionEligible: true,
    },
    evidence: [{ evidenceId: 'a', companyIds: ['company:test'] }, { evidenceId: 'b', companyIds: ['company:test'] }],
    reviewDate: '2026-08-27',
    readiness: { publishable: true, blockers: [] },
    metrics: {
      fundamentals: { metricsReady: true },
      fundamentalRisk: { metricsReady: true, riskScore: 35, flags: [] },
      market: {
        latestTimestamp: Math.floor(new Date('2026-07-27T00:00:00.000Z').getTime() / 1000),
        trend: { distanceFromSma50Pct: 4, distanceFromSma200Pct: 8 },
        liquidity: { score: 80 },
        relativeStrength: { excessReturnPct: 12 },
        risk: { flags: [] },
        dataQuality: { sourceReady: true, crossCheckReady: true, benchmarkReady: true },
        readiness: { marketMetricsReady: true },
      },
      crossCheck: { recommendationReady: true, contradictionCount: 0 },
    },
    ...overrides,
  };
}

test('BUY_NOW requires complete entity, listing, evidence, price, freshness, risk, trend and liquidity integrity', () => {
  const result = evaluateFinalAction(dossier(), { now: NOW });
  assert.equal(result.status, 'FINAL');
  assert.equal(result.marketAction, 'BUY_NOW');
  assert.equal(result.nonHolderAction, 'BUY_NOW');
  assert.equal(result.holderAction, 'HOLD');
  assert.equal(result.urgency, 'IMMEDIATE');
  assert.ok(result.confidenceScore >= 80);
  assert.equal(result.integrity.passed, true);
  assert.equal(result.freshness.executionFreshnessEligible, true);
  assert.equal(result.execution.automaticBrokerOrder, false);
});

test('severe fundamental risk produces AVOID for non-holders and SELL_NOW for holders when execution-grade freshness is verified', () => {
  const input = dossier({
    proposedAction: 'CONSIDER_REDUCE',
    metrics: {
      ...dossier().metrics,
      fundamentalRisk: {
        metricsReady: true,
        riskScore: 95,
        flags: ['CASH_RUNWAY_UNDER_ONE_YEAR', 'SEVERE_DILUTION'],
      },
    },
  });
  const result = evaluateFinalAction(input, { now: NOW });
  assert.equal(result.status, 'FINAL');
  assert.equal(result.marketAction, 'AVOID');
  assert.equal(result.holderAction, 'SELL_NOW');
  assert.equal(result.nonHolderAction, 'AVOID');
});

test('stale or incomplete dossier is blocked and cannot escape as a directional action', () => {
  const input = dossier({
    status: 'DRAFT_RESEARCH',
    readiness: { publishable: false, blockers: ['FUNDAMENTALS_REQUIRED'] },
    referencePrice: null,
  });
  const result = evaluateFinalAction(input, { now: NOW });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.marketAction, 'WATCH');
  assert.ok(result.blockers.includes('DOSSIER_NOT_PUBLISHABLE'));
  assert.ok(result.blockers.includes('REFERENCE_PRICE_REQUIRED'));
});

test('unverified historical source blocks a directional action', () => {
  const input = dossier({
    metrics: {
      ...dossier().metrics,
      market: {
        ...dossier().metrics.market,
        dataQuality: { sourceReady: true, crossCheckReady: false, benchmarkReady: true },
      },
    },
  });
  const result = evaluateFinalAction(input, { now: NOW });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.marketAction, 'WATCH');
  assert.ok(result.blockers.includes('MARKET_HISTORY_NOT_CROSSCHECKED'));
});

test('non-decision-grade price can never support an immediate buy', () => {
  const input = dossier({ referencePrice: { ...dossier().referencePrice, decisionEligible: false, executionFreshnessEligible: false } });
  const result = evaluateFinalAction(input, { now: NOW });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.marketAction, 'WATCH');
  assert.ok(result.blockers.includes('REFERENCE_PRICE_NOT_DECISION_ELIGIBLE'));
  assert.ok(result.blockers.includes('REFERENCE_PRICE_NOT_EXECUTION_ELIGIBLE'));
  assert.ok(result.dataQualityScore <= 79);
  assert.ok(result.confidenceScore <= 79);
  assert.equal(result.confidenceMeaning, 'POLICY_COMPLETENESS_HEURISTIC_NOT_PROBABILITY');
});

test('cross-company evidence contamination blocks the recommendation', () => {
  const input = dossier({ evidence: [{ evidenceId: 'a', companyIds: ['company:other'] }, { evidenceId: 'b', companyIds: ['company:test'] }] });
  const result = evaluateFinalAction(input, { now: NOW });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.marketAction, 'WATCH');
  assert.ok(result.blockers.includes('EVIDENCE_ENTITY_MISMATCH'));
});

test('evidence without entity provenance blocks the recommendation', () => {
  const input = dossier({ evidence: [{ evidenceId: 'a' }, { evidenceId: 'b', companyIds: ['company:test'] }] });
  const result = evaluateFinalAction(input, { now: NOW });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.includes('EVIDENCE_ENTITY_UNVERIFIED'));
});

test('inactive or delisted listing can never produce BUY_NOW', () => {
  const unverified = evaluateFinalAction(dossier({ listingIntegrity: { activeTradingVerified: false, lifecycleStatus: null } }), { now: NOW });
  assert.equal(unverified.status, 'BLOCKED');
  assert.equal(unverified.marketAction, 'WATCH');
  assert.ok(unverified.blockers.includes('ACTIVE_LISTING_NOT_VERIFIED'));

  const delisted = evaluateFinalAction(dossier({ listingIntegrity: { activeTradingVerified: true, lifecycleStatus: 'DELISTED' } }), { now: NOW });
  assert.equal(delisted.status, 'BLOCKED');
  assert.equal(delisted.marketAction, 'WATCH');
  assert.ok(delisted.blockers.includes('LISTING_NOT_ACTIVE'));
});

test('reference-price symbol must identify the same listing', () => {
  const result = evaluateFinalAction(dossier({ referencePrice: { ...dossier().referencePrice, appSymbol: 'WRONG' } }), { now: NOW });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.marketAction, 'WATCH');
  assert.ok(result.blockers.includes('LISTING_IDENTITY_MISMATCH'));
});

test('only a final non-WATCH action is automatically published', () => {
  const [published] = applyAutonomousPublicationPolicy([dossier()], { now: NOW });
  assert.equal(published.status, 'PUBLISHED');
  assert.equal(published.publicationMode, 'AUTOMATED_POLICY');
  assert.equal(published.finalAction.marketAction, 'BUY_NOW');

  const [blocked] = applyAutonomousPublicationPolicy([
    dossier({ status: 'DRAFT_RESEARCH', readiness: { publishable: false, blockers: ['FUNDAMENTALS_REQUIRED'] } }),
  ], { now: NOW });
  assert.equal(blocked.status, 'DRAFT_RESEARCH');
  assert.equal(blocked.publicationMode, null);
  assert.equal(blocked.finalAction.status, 'BLOCKED');
});
