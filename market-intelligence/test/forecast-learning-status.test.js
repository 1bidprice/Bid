import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecastLearningStatus, evaluateForecastStability } from '../src/forecast-learning-status.js';

function liveRecord(index, { horizon = 'day1', assetClass = 'EQUITY', matured = true, probability = null, outcome = null } = {}) {
  const resolvedProbability = probability ?? (index % 2 ? 0.95 : 0.05);
  const resolvedOutcome = outcome ?? (index % 2 ? 1 : 0);
  const forecastAt = new Date(Date.UTC(2026, 0, 1 + index)).toISOString();
  return {
    forecastId: `forecast:${horizon}:${index}`,
    validationMode: 'LIVE_SHADOW_OOS',
    assetClass,
    horizon,
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    status: matured ? 'MATURED' : 'OPEN',
    rawProbabilityPositive: resolvedProbability,
    positiveOutcome: matured ? resolvedOutcome : null,
  };
}

test('learning status exposes progress and blockers even before the first live outcome matures', () => {
  const records = Array.from({ length: 25 }, (_, index) => liveRecord(index, { matured: false }));
  const status = buildForecastLearningStatus({ records, generatedAt: '2026-08-11T00:00:00.000Z' });
  assert.equal(status.status, 'RESEARCH_ONLY');
  assert.equal(status.decisionIntegrationEnabled, false);
  assert.equal(status.forecastMayInfluenceFinalAction, false);
  assert.equal(status.liveOosRecordCount, 25);
  assert.equal(status.openCount, 25);
  assert.equal(status.maturedCount, 0);
  assert.equal(status.groups.length, 1);
  assert.equal(status.groups[0].promotionSampleProgressPct, 0);
  assert.equal(status.groups[0].remainingMaturedSamplesToPromotionFloor, 200);
  assert.ok(status.groups[0].promotionGate.blockers.includes('OOS_SAMPLE_TOO_SMALL_FOR_PROMOTION'));
  assert.ok(status.groups[0].promotionGate.blockers.includes('STABILITY_OOS_SAMPLE_TOO_SMALL'));
});

test('strong calibrated live OOS history is still blocked from decision integration until stability also passes', () => {
  const records = Array.from({ length: 220 }, (_, index) => liveRecord(index));
  for (let index = 0; index < 70; index += 1) {
    records[index] = liveRecord(index, {
      probability: index % 2 ? 0.95 : 0.05,
      outcome: index % 2 ? 0 : 1,
    });
  }
  const status = buildForecastLearningStatus({ records });
  const group = status.groups[0];
  assert.equal(group.calibration.status, 'OOS_METRICS_READY');
  assert.equal(group.maturedCount, 220);
  assert.equal(group.stability.status, 'UNSTABLE');
  assert.equal(group.promotionGate.promotionGateEligible, false);
  assert.equal(group.promotionGate.forecastMayInfluenceFinalAction, false);
  assert.equal(group.promotionGate.decisionIntegrationEnabled, false);
  assert.ok(group.promotionGate.blockers.includes('PROBABILISTIC_SKILL_NOT_STABLE_ACROSS_SUBPERIODS'));
});

test('stable skilled live OOS group becomes only a promotion candidate and never auto-enables final-action influence', () => {
  const records = Array.from({ length: 240 }, (_, index) => liveRecord(index));
  const status = buildForecastLearningStatus({ records });
  const group = status.groups[0];
  assert.equal(group.calibration.status, 'OOS_METRICS_READY');
  assert.ok(group.calibration.skillVsBaseRatePct > 5);
  assert.ok(group.calibration.expectedCalibrationError <= 0.08);
  assert.equal(group.stability.status, 'STABILITY_READY');
  assert.equal(group.promotionGate.status, 'PROMOTION_CANDIDATE');
  assert.equal(group.promotionGate.promotionGateEligible, true);
  assert.equal(group.promotionGate.forecastMayInfluenceFinalAction, false);
  assert.equal(group.promotionGate.decisionIntegrationEnabled, false);
  assert.equal(status.status, 'PROMOTION_CANDIDATES_EXIST');
  assert.ok(status.globalBlockers.includes('DECISION_ENGINE_INTEGRATION_NOT_ENABLED'));
});

test('learning status never mixes WALK_FORWARD_OOS or IN_SAMPLE records into the live promotion sample', () => {
  const records = [
    ...Array.from({ length: 20 }, (_, index) => liveRecord(index)),
    ...Array.from({ length: 500 }, (_, index) => ({
      ...liveRecord(index + 1000),
      forecastId: `walk:${index}`,
      validationMode: 'WALK_FORWARD_OOS',
    })),
    ...Array.from({ length: 500 }, (_, index) => ({
      ...liveRecord(index + 2000),
      forecastId: `in:${index}`,
      validationMode: 'IN_SAMPLE',
    })),
  ];
  const status = buildForecastLearningStatus({ records });
  assert.equal(status.liveOosRecordCount, 20);
  assert.equal(status.maturedCount, 20);
  assert.equal(status.groups[0].maturedCount, 20);
  assert.equal(status.groups[0].promotionGate.promotionGateEligible, false);
});

test('stability is chronological and requires non-negative skill in every contiguous subperiod', () => {
  const records = Array.from({ length: 180 }, (_, index) => liveRecord(index));
  const stable = evaluateForecastStability(records, { minimumStabilitySample: 150, minimumSubperiodSample: 40 });
  assert.equal(stable.status, 'STABILITY_READY');
  assert.equal(stable.subperiods.length, 3);
  assert.ok(stable.subperiods.every((period) => period.status === 'STABLE'));

  const broken = records.map((record, index) => index < 60 ? { ...record, positiveOutcome: record.positiveOutcome === 1 ? 0 : 1 } : record);
  const unstable = evaluateForecastStability(broken, { minimumStabilitySample: 150, minimumSubperiodSample: 40 });
  assert.equal(unstable.status, 'UNSTABLE');
  assert.equal(unstable.subperiods[0].status, 'UNSTABLE');
  assert.ok(unstable.blockers.includes('PROBABILISTIC_SKILL_NOT_STABLE_ACROSS_SUBPERIODS'));
});

test('malformed matured binary outcomes are excluded and block promotion instead of being coerced', () => {
  const valid = Array.from({ length: 220 }, (_, index) => liveRecord(index));
  const malformedOne = { ...liveRecord(500), forecastId: 'malformed:string-one', positiveOutcome: '1' };
  const malformedZero = { ...liveRecord(501), forecastId: 'malformed:string-zero', positiveOutcome: '0' };
  const malformedNull = { ...liveRecord(502), forecastId: 'malformed:null', positiveOutcome: null };
  const status = buildForecastLearningStatus({ records: [...valid, malformedOne, malformedZero, malformedNull] });
  const group = status.groups[0];
  assert.equal(group.maturedCount, 220);
  assert.equal(group.invalidMaturedOutcomeCount, 3);
  assert.equal(status.maturedCount, 220);
  assert.equal(status.invalidMaturedOutcomeCount, 3);
  assert.equal(group.promotionGate.promotionGateEligible, false);
  assert.ok(group.promotionGate.blockers.includes('INVALID_MATURED_BINARY_OUTCOME_RECORDS_EXCLUDED'));
});
