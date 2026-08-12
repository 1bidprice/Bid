import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAndMergeRecentHistory } from '../src/history-freshness-recovery.js';

function candle(day, rawClose) {
  const timestamp = Math.floor(new Date(`${day}T20:00:00.000Z`).getTime() / 1000);
  return { timestamp, rawClose, close: rawClose, adjustedClose: rawClose, open: rawClose, high: rawClose, low: rawClose, volume: 1_000_000 };
}

function series(days, symbol = 'ABC') {
  return {
    format: 'investor-control-market-series',
    version: 2,
    symbol,
    providerSymbol: symbol,
    source: 'Yahoo Finance Chart',
    sourceQuality: 'SECONDARY_VALIDATED',
    usable: true,
    candles: days.map(([day, close]) => candle(day, close)),
  };
}

test('validated recent history merges only after sufficient matching overlap and reaches required session', () => {
  const base = series([
    ['2026-08-03', 10], ['2026-08-04', 10.1], ['2026-08-05', 10.2], ['2026-08-06', 10.3],
    ['2026-08-07', 10.4], ['2026-08-08', 10.5], ['2026-08-09', 10.6], ['2026-08-10', 10.7],
  ]);
  const recent = series([
    ['2026-08-05', 10.2], ['2026-08-06', 10.3], ['2026-08-07', 10.4], ['2026-08-08', 10.5],
    ['2026-08-09', 10.6], ['2026-08-10', 10.7], ['2026-08-11', 10.8],
  ]);

  const result = validateAndMergeRecentHistory(base, recent, { requiredLatestDate: '2026-08-11' });
  assert.equal(result.status, 'RECOVERY_READY');
  assert.equal(result.ready, true);
  assert.equal(result.overlapCount, 6);
  assert.equal(result.maximumOverlapRawCloseDeviationPct, 0);
  assert.equal(result.series.candles.length, 9);
  assert.equal(result.series.freshnessRecovery.recoveredLatestDate, '2026-08-11');
  assert.equal(result.series.freshnessRecovery.decisionImpact, 'MARKET_HISTORY_FRESHNESS_ONLY');
});

test('recent history is rejected when overlapping raw closes disagree beyond strict tolerance', () => {
  const base = series([
    ['2026-08-03', 10], ['2026-08-04', 10.1], ['2026-08-05', 10.2], ['2026-08-06', 10.3],
    ['2026-08-07', 10.4], ['2026-08-08', 10.5], ['2026-08-09', 10.6], ['2026-08-10', 10.7],
  ]);
  const recent = series([
    ['2026-08-05', 10.2], ['2026-08-06', 10.3], ['2026-08-07', 10.4], ['2026-08-08', 11.0],
    ['2026-08-09', 10.6], ['2026-08-10', 10.7], ['2026-08-11', 10.8],
  ]);

  const result = validateAndMergeRecentHistory(base, recent, { requiredLatestDate: '2026-08-11' });
  assert.equal(result.ready, false);
  assert.equal(result.status, 'RECOVERY_REJECTED');
  assert.ok(result.blockers.includes('HISTORY_RECOVERY_OVERLAP_PRICE_MISMATCH'));
  assert.equal(result.series, null);
});

test('recent history is rejected when it does not reach the benchmark completed session', () => {
  const base = series([
    ['2026-08-03', 10], ['2026-08-04', 10.1], ['2026-08-05', 10.2], ['2026-08-06', 10.3],
    ['2026-08-07', 10.4], ['2026-08-08', 10.5], ['2026-08-09', 10.6], ['2026-08-10', 10.7],
  ]);
  const recent = series([
    ['2026-08-05', 10.2], ['2026-08-06', 10.3], ['2026-08-07', 10.4], ['2026-08-08', 10.5],
    ['2026-08-09', 10.6], ['2026-08-10', 10.7],
  ]);

  const result = validateAndMergeRecentHistory(base, recent, { requiredLatestDate: '2026-08-11' });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('HISTORY_RECOVERY_TARGET_SESSION_NOT_REACHED'));
  assert.ok(result.blockers.includes('HISTORY_RECOVERY_NO_NEWER_COMPLETED_SESSION'));
});
