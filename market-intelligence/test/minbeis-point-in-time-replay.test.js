import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMinbeisPointInTimeReplaySample,
  filterEvidenceKnownByAsOf,
  sliceMarketSeriesKnownByAsOf,
} from '../src/minbeis-point-in-time-replay.js';

function candles(count = 100) {
  const base = Date.parse('2026-01-01T16:00:00Z') / 1000;
  return Array.from({ length: count }, (_, index) => ({
    timestamp: base + index * 86_400,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1000 + index,
  }));
}

test('replay excludes evidence published after as-of and blocks undated evidence', () => {
  const result = filterEvidenceKnownByAsOf([
    { id: 'old', publishedAt: '2026-01-05T10:00:00Z' },
    { id: 'future', publishedAt: '2026-02-01T10:00:00Z' },
    { id: 'unknown' },
  ], '2026-01-20T16:00:00Z');
  assert.deepEqual(result.known.map((x) => x.id), ['old']);
  assert.deepEqual(result.future.map((x) => x.id), ['future']);
  assert.deepEqual(result.undated.map((x) => x.id), ['unknown']);
  assert.equal(result.strictReplayEligible, false);
});

test('market decision input is truncated at replay as-of', () => {
  const series = candles(40);
  const result = sliceMarketSeriesKnownByAsOf(series, '2026-01-20T23:00:00Z');
  assert.equal(result.candles.length, 20);
  assert.ok(result.candles.every((x) => x.timestamp <= Date.parse('2026-01-20T23:00:00Z') / 1000));
});

test('future outcomes are separated from immutable decision input', () => {
  const series = candles(100);
  const sample = buildMinbeisPointInTimeReplaySample({
    asOf: '2026-01-20T23:00:00Z',
    instrumentId: 'company:test',
    symbol: 'TEST',
    evidence: [
      { id: 'e1', sourceName: 'Issuer', publishedAt: '2026-01-10T09:00:00Z', title: 'Known event', contentHash: 'abc' },
      { id: 'e2', sourceName: 'Issuer', publishedAt: '2026-02-10T09:00:00Z', title: 'Future event', contentHash: 'def' },
    ],
    events: [
      { eventId: 'c1', eventType: 'EARNINGS', statement: 'Known event', evidenceIds: ['e1'] },
      { eventId: 'c2', eventType: 'GUIDANCE', statement: 'Future event', evidenceIds: ['e2'] },
    ],
    marketSeries: { candles: series },
    horizons: [5, 21],
  });
  assert.equal(sample.status, 'REPLAY_INPUT_READY');
  assert.equal(sample.decisionInput.evidence.length, 1);
  assert.equal(sample.decisionInput.events.length, 1);
  assert.equal(sample.excludedFutureEvidenceCount, 1);
  assert.equal(sample.separationContract.futureOutcomeVisibleToDecision, false);
  assert.equal(sample.separationContract.postAsOfEvidenceVisibleToDecision, false);
  assert.equal(sample.outcomeEvaluation['5'].realisedReturnPct > 0, true);
  assert.ok(sample.decisionInput.marketHistory.length < series.length);
  assert.match(sample.decisionInputHash, /^[a-f0-9]{64}$/);
});

test('event without a defensible availability time blocks strict replay', () => {
  const sample = buildMinbeisPointInTimeReplaySample({
    asOf: '2026-01-20T23:00:00Z',
    evidence: [],
    events: [{ eventId: 'unknown', eventType: 'RUMOUR', statement: 'No time' }],
    marketSeries: { candles: candles(50) },
  });
  assert.equal(sample.status, 'BLOCKED');
  assert.ok(sample.blockers.includes('UNDATED_EVENT_CANNOT_BE_USED_IN_STRICT_REPLAY'));
});
