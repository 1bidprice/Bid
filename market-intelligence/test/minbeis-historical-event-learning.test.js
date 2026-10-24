import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMinbeisHistoricalEventLearning } from '../src/minbeis-historical-event-learning.js';

function row(i, eventType = 'EARNINGS', ret = 5) {
  return {
    replayStatus: 'REPLAY_INPUT_READY',
    companyId: 'company:' + (i % 6),
    eventType,
    category: 'RESULTS',
    role: 'LEAD_CLAIM',
    availabilityAt: `2026-01-${String((i % 20) + 1).padStart(2, '0')}T10:00:00Z`,
    outcomes: {
      '21': {
        realisedReturnPct: ret,
        maxFavorableExcursionPct: ret + 3,
        maxAdverseExcursionPct: -2,
      },
    },
  };
}

test('event learning becomes evidence-ready only with adequate sample and diversity', () => {
  const replayRun = { results: Array.from({ length: 24 }, (_, i) => row(i)) };
  const result = buildMinbeisHistoricalEventLearning(replayRun, {
    minimumSample: 20,
    minimumCompanies: 5,
    minimumDates: 10,
  });
  const cohort = result.horizons['21'].cohorts.eventType.find((x) => x.key === 'EARNINGS');
  assert.equal(cohort.evidenceReady, true);
  assert.equal(cohort.sampleSize, 24);
  assert.equal(cohort.positiveReturnRatePct, 100);
  assert.equal(result.automaticDecisionImpactAllowed, false);
});

test('small historical event cohorts remain blocked from evidence-ready use', () => {
  const replayRun = { results: [row(1), row(2)] };
  const result = buildMinbeisHistoricalEventLearning(replayRun);
  const cohort = result.horizons['21'].cohorts.eventType[0];
  assert.equal(cohort.evidenceReady, false);
  assert.ok(cohort.blockers.includes('EVENT_COHORT_SAMPLE_TOO_SMALL'));
});

test('event learning remains descriptive across mixed outcomes', () => {
  const replayRun = { results: [
    ...Array.from({ length: 12 }, (_, i) => row(i, 'EARNINGS', 10)),
    ...Array.from({ length: 12 }, (_, i) => row(i + 12, 'EARNINGS', -5)),
  ] };
  const result = buildMinbeisHistoricalEventLearning(replayRun, {
    minimumSample: 20,
    minimumCompanies: 5,
    minimumDates: 10,
  });
  const cohort = result.horizons['21'].cohorts.eventType[0];
  assert.equal(cohort.positiveReturnRatePct, 50);
  assert.equal(cohort.averageReturnPct, 2.5);
  assert.match(result.interpretation, /do not establish causality/i);
});
