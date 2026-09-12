import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecastFactorLearningStatus, evaluateFactorScoreTemporalStability } from '../src/forecast-factor-learning-status.js';

const SCORE_LEVELS = [-0.9, -0.7, -0.5, -0.3, -0.1, 0.1, 0.3, 0.5, 0.7, 0.9];

function classificationSnapshot(index, companyId, instrumentId, forecastAt) {
  const majorGroups = ['10', '20', '30', '40', '50', '60'];
  const code = majorGroups[index % majorGroups.length] + '00';
  const cik = String((index % 20) + 1).padStart(10, '0');
  return {
    contract: 'FORECAST_TIME_CLASSIFICATION_SNAPSHOT_V1',
    policyVersion: '2026-08-11.1',
    companyId,
    instrumentId,
    sourceAuthority: 'SEC_EDGAR_SUBMISSIONS',
    sourceUrl: 'https://data.sec.gov/submissions/CIK' + cik + '.json',
    sourceDocumentId: 'CIK' + cik,
    capturedAt: forecastAt,
    taxonomy: 'SEC_SIC',
    code,
    description: 'Synthetic SIC ' + code,
    inferenceUsed: false,
    decisionImpact: 'NONE',
  };
}

function factorRecord(index, options = {}) {
  const score = options.score ?? SCORE_LEVELS[index % SCORE_LEVELS.length];
  const positive = options.invert ? score < 0 : score > 0;
  const outcome = options.outcome ?? (positive ? 1 : 0);
  const realisedReturnPct = options.realisedReturnPct ?? (options.invert ? -score * 10 : score * 10);
  const forecastAt = new Date(Date.UTC(2000, 0, 1) + index * 30 * 86_400_000).toISOString();
  const tradingDays = Number(options.tradingDays || 21);
  const outcomeAt = new Date(new Date(forecastAt).getTime() + tradingDays * 86_400_000).toISOString();
  const companyId = options.companyId || 'company:' + (index % 20);
  const instrumentId = options.instrumentId || 'instrument:' + (index % 20);
  return {
    forecastId: 'factor:' + (options.version || 'factor-v1') + ':' + (options.horizon || 'month1') + ':' + index,
    companyId,
    instrumentId,
    classificationSnapshot: classificationSnapshot(index, companyId, instrumentId, forecastAt),
    validationMode: options.validationMode || 'LIVE_SHADOW_OOS',
    factorScorePolicyVersion: options.noLineage ? null : options.version || 'factor-v1',
    factorScoreStatus: options.factorScoreStatus || 'LATENT_SCORE_READY',
    latentFactorScore: options.noScore ? null : score,
    rawLatentFactorScore: options.noScore ? null : score,
    assetClass: options.assetClass || 'EQUITY',
    horizon: options.horizon || 'month1',
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    tradingDays,
    referencePrice: { timestamp: forecastAt },
    status: options.open ? 'OPEN' : 'MATURED',
    positiveOutcome: options.open ? null : outcome,
    realisedOutcome: options.open ? null : { timestamp: outcomeAt, realisedReturnPct },
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

test('malformed matured factor outcomes are excluded and block promotion rather than being coerced', () => {
  const valid = Array.from({ length: 220 }, (_, index) => factorRecord(index));
  const malformedOne = { ...factorRecord(500), forecastId: 'factor:malformed:one', positiveOutcome: '1' };
  const malformedZero = { ...factorRecord(501), forecastId: 'factor:malformed:zero', positiveOutcome: '0' };
  const malformedNull = { ...factorRecord(502), forecastId: 'factor:malformed:null', positiveOutcome: null };
  const status = buildForecastFactorLearningStatus({ records: [...valid, malformedOne, malformedZero, malformedNull] });
  const group = status.groups[0];
  assert.equal(group.maturedScoredCount, 220);
  assert.equal(group.invalidMaturedOutcomeCount, 3);
  assert.equal(status.maturedScoredCount, 220);
  assert.equal(status.invalidMaturedOutcomeCount, 3);
  assert.notEqual(group.status, 'PROMOTION_CANDIDATE');
  assert.ok(group.blockers.includes('INVALID_MATURED_BINARY_OUTCOME_RECORDS_EXCLUDED'));
});
