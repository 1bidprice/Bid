import test from 'node:test';
import assert from 'node:assert/strict';
import { runMinbeisHistoricalEventReplay } from '../src/minbeis-historical-replay-runner.js';

function series(count = 120) {
  const base = Date.parse('2026-01-01T16:00:00Z') / 1000;
  return {
    candles: Array.from({ length: count }, (_, index) => ({
      timestamp: base + index * 86_400,
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100 + index,
      volume: 1000 + index,
    })),
  };
}

function event(overrides = {}) {
  return {
    eventArchiveId: 'event:test',
    companyId: 'company:test',
    companyName: 'Test plc',
    symbol: 'TEST',
    eventType: 'EARNINGS',
    category: 'RESULTS',
    role: 'LEAD_CLAIM',
    statement: 'Revenue exceeded expectations.',
    evidenceIds: ['e1'],
    supportingEvidence: [{
      evidenceId: 'e1',
      sourceName: 'Issuer',
      publishedAt: '2026-01-20T10:00:00Z',
      contentHash: 'abc',
    }],
    availabilityAt: '2026-01-20T10:00:00Z',
    replayEligible: true,
    blockers: [],
    ...overrides,
  };
}

test('runner creates compact look-ahead-safe replay result with future outcomes separated', () => {
  const result = runMinbeisHistoricalEventReplay({
    generatedAt: '2026-06-01T00:00:00Z',
    eventArchiveRecords: [event()],
    historicalSeriesByCompany: new Map([['company:test', series()]]),
    horizons: [5, 21, 63],
  });
  assert.equal(result.replayReadyCount, 1);
  assert.equal(result.blockedCount, 0);
  assert.equal(result.results[0].eventType, 'EARNINGS');
  assert.equal(result.results[0].separationContract.futureOutcomeVisibleToDecision, false);
  assert.equal(result.rawDecisionInputsPersisted, false);
  assert.ok(result.results[0].marketObservationCount > 0);
  assert.ok(result.results[0].outcomes['21'].realisedReturnPct > 0);
});

test('runner blocks events without historical market series', () => {
  const result = runMinbeisHistoricalEventReplay({
    eventArchiveRecords: [event()],
    historicalSeriesByCompany: new Map(),
  });
  assert.equal(result.replayAttemptCount, 0);
  assert.equal(result.blockedCount, 1);
  assert.ok(result.blocked[0].blockers.includes('HISTORICAL_MARKET_SERIES_REQUIRED'));
});

test('runner does not replay archive records that failed event-time integrity', () => {
  const result = runMinbeisHistoricalEventReplay({
    eventArchiveRecords: [event({ replayEligible: false, blockers: ['EVENT_SUPPORTING_EVIDENCE_UNDATED'] })],
    historicalSeriesByCompany: new Map([['company:test', series()]]),
  });
  assert.equal(result.replayReadyCount, 0);
  assert.equal(result.blockedCount, 1);
  assert.ok(result.blocked[0].blockers.includes('EVENT_SUPPORTING_EVIDENCE_UNDATED'));
});
