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
    generatedAt: '2026-07-27T13:30:00.000Z',
    status: 'REVIEW_READY',
    category: 'QUALITY_COMPOUNDER',
    proposedAction: 'CONSIDER_BUY',
    referencePrice: {
      value: 100,
      currency: 'USD',
      timestamp: '2026-07-27T13:45:00.000Z',
      source: 'Test feed',
    },
    evidence: [{ evidenceId: 'a' }, { evidenceId: 'b' }],
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

test('autonomous policy emits BUY_NOW only when all freshness, evidence, risk, trend and liquidity gates pass', () => {
  const result = evaluateFinalAction(dossier(), { now: NOW });
  assert.equal(result.status, 'FINAL');
  assert.equal(result.marketAction, 'BUY_NOW');
  assert.equal(result.nonHolderAction, 'BUY_NOW');
  assert.equal(result.holderAction, 'HOLD');
  assert.equal(result.urgency, 'IMMEDIATE');
  assert.ok(result.confidenceScore >= 80);
  assert.equal(result.execution.automaticBrokerOrder, false);
});

test('severe fundamental risk produces AVOID for non-holders and SELL_NOW for holders', () => {
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
