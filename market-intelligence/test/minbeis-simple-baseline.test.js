import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMinbeisSimpleBaselineSnapshot, summarizeMinbeisBaselineComparison } from '../src/minbeis-simple-baseline.js';

function risingSeries(count = 100) {
  const base = Date.parse('2026-01-01T16:00:00Z') / 1000;
  return {
    candles: Array.from({ length: count }, (_, index) => ({
      timestamp: base + index * 86400,
      close: 100 + (index * 0.5),
      volume: 1000 + index * 10,
    })),
  };
}

test('simple baseline is preregistered, shadow-only and uses only data at or before decision time', () => {
  const series = risingSeries(100);
  const decisionAt = new Date(series.candles[80].timestamp * 1000).toISOString();
  const snapshot = buildMinbeisSimpleBaselineSnapshot(series, decisionAt);
  assert.equal(snapshot.status, 'READY');
  assert.equal(snapshot.action, 'ENTRY');
  assert.equal(snapshot.decisionImpact, 'NONE');
  assert.equal(snapshot.finalActionEligible, false);
  assert.ok(new Date(snapshot.marketAsOf) <= new Date(decisionAt));
});

test('short history fails closed instead of inventing a baseline signal', () => {
  const series = risingSeries(40);
  const decisionAt = new Date(series.candles.at(-1).timestamp * 1000).toISOString();
  const snapshot = buildMinbeisSimpleBaselineSnapshot(series, decisionAt);
  assert.equal(snapshot.status, 'NOT_READY');
  assert.equal(snapshot.action, null);
  assert.ok(snapshot.blockers.includes('BASELINE_HISTORY_TOO_SHORT'));
});

test('baseline comparison refuses a performance conclusion before enough prospective outcomes mature', () => {
  const summary = summarizeMinbeisBaselineComparison([
    {
      action: 'BUY_PROBE',
      simpleBaselineSnapshot: { status: 'READY', action: 'ENTRY' },
      horizons: { '7': { status: 'MATURED' } },
    },
  ]);
  assert.equal(summary.minimumEvidenceMet, false);
  assert.equal(summary.conclusion, 'INSUFFICIENT_PROSPECTIVE_SAMPLE');
});
