import test from 'node:test';
import assert from 'node:assert/strict';
import { createMinbeisDecisionOutcomeRecord, evaluateMinbeisDecisionOutcome, mergeMinbeisDecisionOutcomeLedger, summarizeMinbeisDecisionOutcomes } from '../src/minbeis-decision-outcome-ledger.js';

function series(count, start = 100, daily = 1) {
  const base = new Date('2026-01-01T16:00:00Z').getTime();
  return Array.from({ length: count }, (_, index) => ({ timestamp: new Date(base + index * 86_400_000).toISOString(), close: start + index * daily }));
}

test('MINBEIS outcome record matures 7/30/90 horizons when data exists', () => {
  const record = createMinbeisDecisionOutcomeRecord({ instrumentId: 'company:test', symbol: 'TEST', action: 'BUY_PROBE', allocationPct: 0.5, decisionAt: '2026-01-01T16:00:00Z', referencePrice: 100, benchmarkSymbol: 'BENCH' });
  const evaluated = evaluateMinbeisDecisionOutcome(record, series(100, 100, 1), series(100, 200, 1));
  assert.equal(evaluated.horizons['7'].status, 'MATURED');
  assert.equal(evaluated.horizons['30'].status, 'MATURED');
  assert.equal(evaluated.horizons['90'].status, 'MATURED');
  assert.equal(evaluated.horizons['7'].realisedReturnPct, 7);
});

test('summary reports observed buy hit rate with explicit caution', () => {
  const record = createMinbeisDecisionOutcomeRecord({ instrumentId: 'company:test', symbol: 'TEST', action: 'BUY_PROBE', allocationPct: 0.5, decisionAt: '2026-01-01T16:00:00Z', referencePrice: 100 });
  const evaluated = evaluateMinbeisDecisionOutcome(record, series(100, 100, 1));
  const summary = summarizeMinbeisDecisionOutcomes([evaluated]);
  assert.equal(summary.horizons['7'].positiveBuyRatePct, 100);
  assert.match(summary.caution, /not a promise/i);
});


test('baseline snapshot remains immutable when outcome records merge and mature', () => {
  const original = createMinbeisDecisionOutcomeRecord({
    instrumentId: 'company:test',
    symbol: 'TEST',
    action: 'BUY_PROBE',
    allocationPct: 0.5,
    decisionAt: '2026-01-01T16:00:00Z',
    referencePrice: 100,
    simpleBaselineSnapshot: {
      status: 'READY',
      action: 'NO_TRADE',
      capturedAt: '2026-01-01T16:00:00Z',
      decisionImpact: 'NONE',
      finalActionEligible: false,
    },
  });
  const tamperedIncoming = {
    ...original,
    simpleBaselineSnapshot: {
      status: 'READY',
      action: 'ENTRY',
      capturedAt: '2026-01-01T16:00:00Z',
      decisionImpact: 'NONE',
      finalActionEligible: false,
    },
    horizons: {
      ...original.horizons,
      '7': { ...original.horizons['7'], status: 'MATURED', realisedReturnPct: 3 },
    },
  };
  const [merged] = mergeMinbeisDecisionOutcomeLedger([original], [tamperedIncoming]);
  assert.equal(merged.simpleBaselineSnapshot.action, 'NO_TRADE');
  assert.equal(merged.horizons['7'].status, 'MATURED');
});


test('context snapshot is hashed and remains immutable when records merge', () => {
  const original = createMinbeisDecisionOutcomeRecord({
    instrumentId: 'company:test',
    symbol: 'TEST',
    action: 'WATCH',
    decisionAt: '2026-01-01T16:00:00Z',
    referencePrice: 100,
    decisionReason: 'FINAL_POLICY_WATCH',
    sourcePolicyVersion: 'policy:test',
    contextSnapshot: {
      decision: { action: 'WATCH', confidenceScore: 72 },
      research: { leadEventType: 'EARNINGS' },
    },
  });
  assert.match(original.contextHash, /^[a-f0-9]{64}$/);
  assert.equal(original.contextSnapshot.decision.action, 'WATCH');

  const tampered = {
    ...original,
    contextSnapshot: { decision: { action: 'BUY_CORE', confidenceScore: 99 } },
    contextHash: 'tampered',
  };
  const [merged] = mergeMinbeisDecisionOutcomeLedger([original], [tampered]);
  assert.equal(merged.contextSnapshot.decision.action, 'WATCH');
  assert.equal(merged.contextHash, original.contextHash);
});

test('matured outcome records favorable and adverse excursions from decision price', () => {
  const original = createMinbeisDecisionOutcomeRecord({
    instrumentId: 'company:test',
    symbol: 'TEST',
    action: 'HOLD',
    decisionAt: '2026-01-01T16:00:00Z',
    referencePrice: 100,
  });
  const prices = series(100, 100, 1);
  prices[3].close = 90;
  prices[5].close = 112;
  const evaluated = evaluateMinbeisDecisionOutcome(original, prices);
  assert.equal(evaluated.horizons['7'].status, 'MATURED');
  assert.equal(evaluated.horizons['7'].maxAdverseExcursionPct, -10);
  assert.equal(evaluated.horizons['7'].maxFavorableExcursionPct, 12);
});
