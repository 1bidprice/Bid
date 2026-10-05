import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMinbeisSimpleBaselineChallenger } from '../src/minbeis-challenger-evaluation.js';

function row(i, minbeisEntry, baselineEntry, realised) {
  return {
    decisionId: 'd' + i,
    decisionAt: `2026-${String((i % 6) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}T16:00:00Z`,
    instrumentId: 'company:' + (i % 12),
    action: minbeisEntry ? 'BUY_PROBE' : 'WATCH',
    simpleBaselineSnapshot: { status: 'READY', action: baselineEntry ? 'ENTRY' : 'NO_TRADE' },
    horizons: { '30': { status: 'MATURED', realisedReturnPct: realised } },
  };
}

test('challenger comparison stays blocked with insufficient prospective evidence', () => {
  const result = evaluateMinbeisSimpleBaselineChallenger([row(1, true, false, 5)]);
  assert.equal(result.status, 'INSUFFICIENT_PROSPECTIVE_EVIDENCE');
  assert.equal(result.automaticPromotionAllowed, false);
  assert.equal(result.requiresWalkForwardValidation, true);
});

test('challenger becomes evidence-ready only after sample and diversity floors', () => {
  const records = Array.from({ length: 120 }, (_, i) => row(i, i % 2 === 0, i % 3 === 0, i % 2 === 0 ? 6 : -2));
  const result = evaluateMinbeisSimpleBaselineChallenger(records, {
    minimumSample: 100,
    minimumDistinctDates: 20,
    minimumDistinctInstruments: 10,
    minimumEntriesPerModel: 20,
  });
  assert.equal(result.status, 'EVIDENCE_READY');
  assert.equal(result.comparableDecisionCount, 120);
  assert.ok(result.minbeisEntryCount >= 20);
  assert.ok(result.baselineEntryCount >= 20);
  assert.equal(result.automaticPromotionAllowed, false);
});

test('shadow return comparison gives no-trade opportunities zero strategy return', () => {
  const records = [
    row(1, true, false, 10),
    row(2, false, true, -10),
  ];
  const result = evaluateMinbeisSimpleBaselineChallenger(records, {
    minimumSample: 20,
    minimumDistinctDates: 5,
    minimumDistinctInstruments: 5,
    minimumEntriesPerModel: 5,
  });
  assert.equal(result.minbeisAverageShadowReturnPct, 5);
  assert.equal(result.baselineAverageShadowReturnPct, -5);
});
