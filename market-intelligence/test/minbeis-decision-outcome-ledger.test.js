import test from 'node:test';
import assert from 'node:assert/strict';
import { createMinbeisDecisionOutcomeRecord, evaluateMinbeisDecisionOutcome, summarizeMinbeisDecisionOutcomes } from '../src/minbeis-decision-outcome-ledger.js';

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
