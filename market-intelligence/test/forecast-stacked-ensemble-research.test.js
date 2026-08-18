import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildForecastStackedEnsembleResearchStatus,
  buildPrequentialStackPredictions,
} from '../src/forecast-stacked-ensemble-research.js';

const SCORES = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];

function isoPlusDays(base, days) {
  return new Date(new Date(base).getTime() + days * 86400000).toISOString();
}

function classification(index, forecastAt, concentrated = false) {
  const cik = String((index % 20) + 1).padStart(10, '0');
  const major = concentrated ? '10' : String(10 + (index % 10)).padStart(2, '0');
  return {
    contract: 'FORECAST_TIME_CLASSIFICATION_SNAPSHOT_V1',
    policyVersion: '2026-08-11.1',
    companyId: `company:${index % 20}`,
    instrumentId: `instrument:${index % 20}`,
    sourceAuthority: 'SEC_EDGAR_SUBMISSIONS',
    sourceUrl: `https://data.sec.gov/submissions/CIK${cik}.json`,
    sourceDocumentId: `CIK${cik}`,
    capturedAt: forecastAt,
    taxonomy: 'SEC_SIC',
    code: `${major}00`,
    description: `Synthetic SIC ${major}`,
    inferenceUsed: false,
    decisionImpact: 'NONE',
  };
}

function record(index, options = {}) {
  const factorScore = options.factorScore ?? SCORES[index % SCORES.length];
  const forecastAt = new Date(Date.UTC(2024, 0, 1 + index)).toISOString();
  const outcomePositive = options.outcome ?? (options.invert ? factorScore < 0 : factorScore > 0 ? 1 : 0);
  const realisedReturnPct = options.realisedReturnPct ?? (outcomePositive ? 5 : -5);
  const outcomeDelayDays = options.outcomeDelayDays ?? 22;
  const companyIndex = options.companyIndex ?? index % 20;
  const base = {
    forecastId: `stack:${options.patternVersion || 'pattern-v1'}:${options.factorVersion || 'factor-v1'}:${options.horizon || 'month1'}:${index}:${options.suffix || ''}`,
    validationMode: options.validationMode || 'LIVE_SHADOW_OOS',
    historicalPatternPolicyVersion: options.patternVersion || 'pattern-v1',
    factorScorePolicyVersion: options.factorVersion || 'factor-v1',
    companyId: `company:${companyIndex}`,
    instrumentId: `instrument:${companyIndex}`,
    symbol: `SYM${companyIndex}`,
    listing: { symbol: `SYM${companyIndex}`, mic: 'XNAS', currency: 'USD' },
    assetClass: options.assetClass || 'EQUITY',
    horizon: options.horizon || 'month1',
    tradingDays: options.tradingDays || 21,
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    referencePrice: { value: 100, timestamp: forecastAt, currency: 'USD', source: 'synthetic' },
    rawProbabilityPositive: options.patternProbability ?? 0.5,
    latentFactorScore: factorScore,
    factorScoreStatus: 'LATENT_SCORE_READY',
    status: options.open ? 'OPEN' : 'MATURED',
    positiveOutcome: options.open ? null : outcomePositive,
    realisedOutcome: options.open ? null : {
      timestamp: isoPlusDays(forecastAt, outcomeDelayDays),
      close: 100 * (1 + realisedReturnPct / 100),
      realisedReturnPct,
    },
    classificationSnapshot: options.noClassification ? null : classification(index, forecastAt, options.concentratedTaxonomy === true),
    decisionImpact: 'NONE',
  };
  return base;
}

function strongRecords(count = 420, options = {}) {
  return Array.from({ length: count }, (_, index) => record(index, options));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('stack input rejects string, null and post-forecast-invalid outcomes instead of coercing them', () => {
  const valid = record(0);
  const stringProbability = { ...record(1), rawProbabilityPositive: '0.5' };
  const stringFactor = { ...record(2), latentFactorScore: '0.3' };
  const stringOutcome = { ...record(3), positiveOutcome: '1' };
  const preForecastOutcome = clone(record(4));
  preForecastOutcome.realisedOutcome.timestamp = isoPlusDays(preForecastOutcome.forecastAt, -1);
  const result = buildPrequentialStackPredictions([valid, stringProbability, stringFactor, stringOutcome, preForecastOutcome]);
  assert.equal(result.eligibleRecordCount, 1);
  assert.equal(result.predictionCount, 0);
});

test('prequential stack emits no target prediction until enough already-realised training outcomes exist', () => {
  const records = Array.from({ length: 80 }, (_, index) => record(index, { outcomeDelayDays: 100 }));
  const result = buildPrequentialStackPredictions(records, { ensembleMinimumTrainingSample: 20, ensembleMinimumTrainingClassCount: 5 });
  assert.equal(result.predictionCount, 0);
  assert.equal(result.antiLeakRule, 'TRAIN_ONLY_ON_OUTCOMES_REALIZED_STRICTLY_BEFORE_TARGET_FORECAST_TIME');
});

test('prequential training never uses an outcome that was realised after the target forecast time', () => {
  const records = strongRecords(140);
  const result = buildPrequentialStackPredictions(records, { ensembleMinimumTrainingSample: 30, ensembleMinimumTrainingClassCount: 8 });
  assert.ok(result.predictionCount > 0);
  for (const prediction of result.predictions) {
    assert.ok(Date.parse(prediction.ensembleTrainingLatestOutcomeAt) < Date.parse(prediction.forecastAt));
  }
});

test('strong incremental factor signal can make the stack research-ready while remaining authority-free', () => {
  const status = buildForecastStackedEnsembleResearchStatus({ records: strongRecords() });
  assert.equal(status.readyGroupCount, 1);
  const group = status.groups[0];
  assert.equal(group.status, 'ENSEMBLE_RESEARCH_READY');
  assert.ok(group.prequentialPredictionCount >= 200);
  assert.ok(group.improvement.relativeBrierImprovementPct >= 3);
  assert.ok(group.improvement.logLossImprovement >= 0);
  assert.equal(group.sampleIndependence.status, 'INDEPENDENCE_READY');
  assert.equal(group.outcomeWindowIndependence.status, 'WINDOW_INDEPENDENCE_READY');
  assert.equal(group.instrumentConcentration.status, 'INSTRUMENT_DIVERSIFICATION_READY');
  assert.equal(group.taxonomyConcentration.status, 'TAXONOMY_DIVERSIFICATION_READY');
  assert.equal(group.temporalStability.status, 'STABILITY_READY');
  assert.equal(status.automaticModelPromotionEnabled, false);
  assert.equal(status.probabilityCalibrationEnabled, false);
  assert.equal(status.decisionIntegrationEnabled, false);
  assert.equal(status.forecastMayInfluenceFinalAction, false);
  assert.equal(status.finalActionEligible, false);
  assert.equal(status.decisionImpact, 'NONE');
});

test('an ensemble with no incremental factor signal cannot claim superiority over the raw pattern baseline', () => {
  const records = Array.from({ length: 420 }, (_, index) => record(index, {
    factorScore: 0,
    outcome: index % 2,
    patternProbability: 0.5,
  }));
  const group = buildForecastStackedEnsembleResearchStatus({ records }).groups[0];
  assert.notEqual(group.status, 'ENSEMBLE_RESEARCH_READY');
  assert.ok(group.blockers.includes('ENSEMBLE_BRIER_IMPROVEMENT_TOO_SMALL'));
});

test('pattern versions, factor versions and horizons are never pooled into one stack', () => {
  const records = [
    ...Array.from({ length: 90 }, (_, index) => record(index, { patternVersion: 'pattern-a', factorVersion: 'factor-a', horizon: 'month1' })),
    ...Array.from({ length: 90 }, (_, index) => record(index + 200, { patternVersion: 'pattern-b', factorVersion: 'factor-a', horizon: 'month1' })),
    ...Array.from({ length: 90 }, (_, index) => record(index + 400, { patternVersion: 'pattern-a', factorVersion: 'factor-b', horizon: 'month3', tradingDays: 63 })),
  ];
  const status = buildForecastStackedEnsembleResearchStatus({ records });
  assert.equal(status.groupCount, 3);
  assert.equal(new Set(status.groups.map((group) => `${group.historicalPatternPolicyVersion}|${group.factorScorePolicyVersion}|${group.horizon}`)).size, 3);
});

test('taxonomy concentration blocks apparent ensemble skill even when dates and instruments are diversified', () => {
  const group = buildForecastStackedEnsembleResearchStatus({ records: strongRecords(420, { concentratedTaxonomy: true }) }).groups[0];
  assert.notEqual(group.status, 'ENSEMBLE_RESEARCH_READY');
  assert.equal(group.taxonomyConcentration.status, 'TAXONOMY_DIVERSIFICATION_NOT_READY');
  assert.ok(group.blockers.includes('OOS_NATIVE_CLUSTER_CONCENTRATION_TOO_HIGH') || group.blockers.includes('OOS_EFFECTIVE_NATIVE_CLUSTER_COUNT_TOO_SMALL'));
});

test('ensemble improvement that reverses in the latest chronological regime fails temporal stability', () => {
  const records = Array.from({ length: 420 }, (_, index) => record(index, { invert: index >= 280 }));
  const group = buildForecastStackedEnsembleResearchStatus({ records }).groups[0];
  assert.notEqual(group.status, 'ENSEMBLE_RESEARCH_READY');
  assert.equal(group.temporalStability.status, 'UNSTABLE');
  assert.ok(group.blockers.includes('ENSEMBLE_IMPROVEMENT_NOT_STABLE_ACROSS_SUBPERIODS'));
});

test('stacked research output never emits trade authority or automatic probability promotion', () => {
  const status = buildForecastStackedEnsembleResearchStatus({ records: strongRecords() });
  const serialized = JSON.stringify(status);
  assert.equal(status.automaticModelPromotionEnabled, false);
  assert.equal(status.probabilityCalibrationEnabled, false);
  assert.equal(status.decisionIntegrationEnabled, false);
  assert.equal(status.forecastMayInfluenceFinalAction, false);
  assert.equal(status.finalActionEligible, false);
  assert.equal(serialized.includes('BUY_NOW'), false);
  assert.equal(serialized.includes('SELL_NOW'), false);
  assert.equal(serialized.includes('automaticBrokerOrder'), false);
});
