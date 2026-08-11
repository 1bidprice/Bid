import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecastFactorLearningStatus, evaluateFactorScoreTemporalStability } from '../src/forecast-factor-learning-status.js';

const SCORE_LEVELS = [-0.9, -0.7, -0.5, -0.3, -0.1, 0.1, 0.3, 0.5, 0.7, 0.9];

function factorRecord(index, options = {}) {
  const score = options.score ?? SCORE_LEVELS[index % SCORE_LEVELS.length];
  const positive = options.invert ? score < 0 : score > 0;
  const outcome = options.outcome ?? (positive ? 1 : 0);
  const realisedReturnPct = options.realisedReturnPct ?? (options.invert ? -score * 10 : score * 10);
  const forecastAt = new Date(Date.UTC(2026, 0, 1 + index)).toISOString();
  return {
    forecastId: `factor:${options.version || 'factor-v1'}:${options.horizon || 'month1'}:${index}`,
    validationMode: options.validationMode || 'LIVE_SHADOW_OOS',
    factorScorePolicyVersion: options.noLineage ? null : options.version || 'factor-v1',
    factorScoreStatus: options.factorScoreStatus || 'LATENT_SCORE_READY',
    latentFactorScore: options.noScore ? null : score,
    rawLatentFactorScore: options.noScore ? null : score,
    assetClass: options.assetClass || 'EQUITY',
    horizon: options.horizon || 'month1',
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    status: options.open ? 'OPEN' : 'MATURED',
    positiveOutcome: options.open ? null : outcome,
    realisedOutcome: options.open ? null : { realisedReturnPct },
  };
}

function deepKeys(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    output.push(key);
    deepKeys(child, output);
  }
  return output;
}

test('pre-factor and non-live records never enter factor OOS learning status', () => {
  const records = [
    ...Array.from({ length: 100 }, (_, index) => factorRecord(index, { noLineage: true })),
    ...Array.from({ length: 100 }, (_, index) => factorRecord(index + 100, { validationMode: 'WALK_FORWARD_OOS' })),
    ...Array.from({ length: 100 }, (_, index) => factorRecord(index + 200, { validationMode: 'IN_SAMPLE' })),
  ];
  const status = buildForecastFactorLearningStatus({ records });
  assert.equal(status.status, 'NO_FACTOR_OOS_LINEAGE');
  assert.equal(status.lineageRecordCount, 0);
  assert.equal(status.groupCount, 0);
  assert.equal(status.decisionIntegrationEnabled, false);
});

test('different factor model versions are evaluated as separate OOS groups and are never pooled', () => {
  const records = [
    ...Array.from({ length: 120 }, (_, index) => factorRecord(index, { version: 'factor-v1' })),
    ...Array.from({ length: 120 }, (_, index) => factorRecord(index + 120, { version: 'factor-v2' })),
  ];
  const status = buildForecastFactorLearningStatus({ records });
  assert.equal(status.lineageRecordCount, 240);
  assert.equal(status.groupCount, 2);
  assert.deepEqual(status.groups.map((group) => group.factorScorePolicyVersion), ['factor-v1', 'factor-v2']);
  assert.ok(status.groups.every((group) => group.lineageRecordCount === 120));
});

test('factor lineage without a usable latent score is tracked as coverage but never becomes a discrimination sample', () => {
  const records = Array.from({ length: 80 }, (_, index) => factorRecord(index, {
    noScore: true,
    factorScoreStatus: 'RESEARCH_SCORE_BLOCKED',
  }));
  const status = buildForecastFactorLearningStatus({ records });
  const group = status.groups[0];
  assert.equal(group.lineageRecordCount, 80);
  assert.equal(group.scoreReadyRecordCount, 0);
  assert.equal(group.scoreBlockedOrUnavailableRecordCount, 80);
  assert.equal(group.maturedScoredCount, 0);
  assert.equal(group.status, 'INSUFFICIENT_OOS_HISTORY');
  assert.ok(group.blockers.includes('FACTOR_MATURED_OOS_SAMPLE_TOO_SMALL'));
});

test('strong OOS score ordering passes AUC, tail spreads, bin ordering and temporal stability but remains research-only', () => {
  const records = Array.from({ length: 240 }, (_, index) => factorRecord(index));
  const status = buildForecastFactorLearningStatus({ records });
  const group = status.groups[0];
  assert.equal(group.status, 'PROMOTION_CANDIDATE');
  assert.ok(group.discrimination.rocAuc >= 0.99);
  assert.ok(group.discrimination.topBottom.positiveRateSpread >= 0.9);
  assert.ok(group.discrimination.topBottom.realisedReturnSpreadPct > 0);
  assert.ok(group.discrimination.scoreOrdering.populatedBinCount >= 3);
  assert.equal(group.discrimination.scoreOrdering.monotonicInversionCount, 0);
  assert.equal(group.stability.status, 'STABILITY_READY');
  assert.equal(status.status, 'PROMOTION_CANDIDATES_EXIST');
  assert.equal(status.probabilityCalibrationEnabled, false);
  assert.equal(status.decisionIntegrationEnabled, false);
  assert.equal(status.forecastMayInfluenceFinalAction, false);
  assert.ok(status.globalBlockers.includes('FACTOR_PROBABILITY_MAPPING_NOT_CALIBRATED'));
});

test('inverted latent score fails discrimination rather than being cosmetically promoted', () => {
  const records = Array.from({ length: 240 }, (_, index) => factorRecord(index, { invert: true }));
  const group = buildForecastFactorLearningStatus({ records }).groups[0];
  assert.equal(group.status, 'DISCRIMINATION_NOT_READY');
  assert.ok(group.discrimination.rocAuc <= 0.01);
  assert.ok(group.discrimination.topBottom.positiveRateSpread < 0);
  assert.ok(group.blockers.includes('FACTOR_ROC_AUC_TOO_LOW'));
  assert.ok(group.blockers.includes('FACTOR_TOP_BOTTOM_OUTCOME_SPREAD_TOO_SMALL'));
  assert.equal(group.decisionIntegrationEnabled, false);
});

test('model that works only in later regimes fails chronological temporal stability even with abundant OOS samples', () => {
  const records = Array.from({ length: 240 }, (_, index) => factorRecord(index, { invert: index < 80 }));
  const stability = evaluateFactorScoreTemporalStability(records);
  assert.equal(stability.status, 'UNSTABLE');
  assert.equal(stability.subperiods.length, 3);
  assert.equal(stability.subperiods[0].status, 'UNSTABLE');
  assert.ok(stability.subperiods.slice(1).every((period) => period.status === 'STABLE'));
  assert.ok(stability.blockers.includes('FACTOR_DISCRIMINATION_NOT_STABLE_ACROSS_SUBPERIODS'));

  const group = buildForecastFactorLearningStatus({ records }).groups[0];
  assert.equal(group.status, 'DISCRIMINATION_NOT_READY');
  assert.ok(group.blockers.includes('FACTOR_DISCRIMINATION_NOT_STABLE_ACROSS_SUBPERIODS'));
});

test('open scored records contribute to lineage coverage but cannot leak future outcomes into discrimination', () => {
  const records = [
    ...Array.from({ length: 180 }, (_, index) => factorRecord(index)),
    ...Array.from({ length: 100 }, (_, index) => factorRecord(index + 180, { open: true })),
  ];
  const group = buildForecastFactorLearningStatus({ records }).groups[0];
  assert.equal(group.lineageRecordCount, 280);
  assert.equal(group.scoreReadyRecordCount, 280);
  assert.equal(group.openScoredCount, 100);
  assert.equal(group.maturedScoredCount, 180);
  assert.equal(group.status, 'INSUFFICIENT_OOS_HISTORY');
  assert.equal(group.remainingMaturedSamplesToFloor, 20);
});

test('factor learning status never produces a probability mapping or silently enables decision integration', () => {
  const status = buildForecastFactorLearningStatus({ records: Array.from({ length: 240 }, (_, index) => factorRecord(index)) });
  const keys = deepKeys(status);
  assert.equal(status.probabilityCalibrationEnabled, false);
  assert.equal(status.decisionIntegrationEnabled, false);
  assert.equal(status.forecastMayInfluenceFinalAction, false);
  assert.equal(keys.includes('calibratedProbability'), false);
  assert.equal(keys.includes('probabilityPositive'), false);
  assert.equal(keys.includes('probabilityMapping'), false);
  assert.ok(status.groups.every((group) => group.probabilityCalibrationEnabled === false && group.decisionIntegrationEnabled === false));
});
