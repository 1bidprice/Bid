import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORICAL_MARKET_PREQUENTIAL_STACK_CONTRACT } from '../src/forecast-historical-market-prequential-stack.js';
import {
  HISTORICAL_MARKET_ADAPTIVE_PRIOR_SHRINKAGE_CONTRACT,
  buildHistoricalMarketAdaptivePriorShrunkPrequentialStackFromScalar,
} from '../src/forecast-historical-market-adaptive-prior-shrinkage.js';

const DAY_MS = 86_400_000;
const START_MS = Date.UTC(2024, 0, 2, 10);

function scalarPrediction(index, options = {}) {
  const forecastMs = START_MS + index * DAY_MS;
  const outcomeMs = options.outcomeMs ?? (forecastMs + 6 * 3_600_000);
  return {
    forecastId: options.forecastId || `adaptive:${index}`,
    instrumentId: `instrument:${index % 10}`,
    companyId: `instrument:${index % 10}`,
    assetClass: 'EQUITY',
    horizon: 'week1',
    tradingDays: 5,
    forecastAt: new Date(forecastMs).toISOString(),
    forecastSampleDate: new Date(forecastMs).toISOString().slice(0, 10),
    outcomeKnownAt: new Date(outcomeMs).toISOString(),
    realisedOutcome: { timestamp: new Date(outcomeMs).toISOString() },
    positiveOutcome: options.positiveOutcome ?? (index % 2),
    historicalPatternPolicyVersion: 'pattern-v1',
    historicalMarketFactorPolicyVersion: 'factor-v1',
    historicalMarketFactorScore: 0.4,
    regimeKey: 'RISK_ON|BULL_TREND|LOW_VOLATILITY|POSITIVE_MOMENTUM',
    baselinePatternProbabilityPositive: 0.9,
    ensembleResearchProbabilityPositive: options.probability ?? 0.9,
    ensembleFeatureMode: 'SCALAR',
    ensembleTrainingSampleSize: 20,
    ensembleTrainingPositiveCount: 10,
    ensembleTrainingNegativeCount: 10,
    ensembleTrainingLatestOutcomeAt: new Date(forecastMs - DAY_MS).toISOString(),
    validationMode: 'WALK_FORWARD_OOS',
    evidenceClass: 'HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH',
    historicalResearchOnly: true,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

function scalarStack(predictions) {
  return {
    contract: HISTORICAL_MARKET_PREQUENTIAL_STACK_CONTRACT,
    policyVersion: 'scalar-v1',
    sourceEvidenceClass: 'HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH',
    sourceValidationMode: 'WALK_FORWARD_OOS',
    eligibleRecordCount: predictions.length,
    rejectedRecordCount: 0,
    predictionCount: predictions.length,
    skippedInsufficientTrainingCount: 0,
    modelFitCount: predictions.length,
    latestModel: null,
    predictions,
    minimumTrainingSample: 20,
    minimumTrainingClassCount: 5,
    featureMode: 'SCALAR',
    featureOrder: ['PATTERN_LOGIT', 'HISTORICAL_MARKET_FACTOR_SCORE'],
    antiLeakRule: 'WITHIN_SAME_PATTERN_FACTOR_ASSET_HORIZON_REGIME_LINEAGE_TRAIN_ONLY_ON_OUTCOMES_REALIZED_STRICTLY_BEFORE_TARGET_FORECAST_TIME',
    liveShadowRecordsAccepted: false,
    historicalResearchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

test('adaptive shrinkage uses fixed powers-of-two support grid and warmup default', () => {
  const predictions = Array.from({ length: 10 }, (_, index) => scalarPrediction(index));
  const result = buildHistoricalMarketAdaptivePriorShrunkPrequentialStackFromScalar(scalarStack(predictions));
  assert.equal(result.contract, HISTORICAL_MARKET_ADAPTIVE_PRIOR_SHRINKAGE_CONTRACT);
  assert.deepEqual(result.adaptiveSupportFloorGrid, [20, 40, 80, 160]);
  assert.equal(result.predictions[0].ensembleAdaptiveSelectionStatus, 'ADAPTIVE_PRIOR_SHRINKAGE_WARMUP_DEFAULT');
  assert.equal(result.predictions[0].ensemblePriorShrinkageSupportFloor, 20);
  assert.equal(result.adaptiveSelectionObjective, 'BRIER_SCORE');
  assert.equal(result.adaptiveTieBreak, 'PREFER_STRONGER_SHRINKAGE');
  assert.equal(
    result.adaptiveSupportFloorSelectionCounts.reduce((sum, item) => sum + item.predictionCount, 0),
    result.predictionCount,
  );
});

test('adaptive shrinkage selects support only from prior realised OOS outcomes in the same lineage', () => {
  const predictions = Array.from({ length: 41 }, (_, index) => scalarPrediction(index, {
    positiveOutcome: index % 2,
    probability: 0.9,
  }));
  const target = predictions.at(-1);
  const result = buildHistoricalMarketAdaptivePriorShrunkPrequentialStackFromScalar(scalarStack(predictions));
  const selected = result.predictions.find((prediction) => prediction.forecastId === target.forecastId);

  assert.ok(selected);
  assert.equal(selected.ensembleAdaptiveSelectionStatus, 'ADAPTIVE_PRIOR_SHRINKAGE_SELECTION_READY');
  assert.equal(selected.ensembleAdaptiveSelectionSampleSize, 40);
  assert.equal(selected.ensembleAdaptiveSelectionPositiveCount, 20);
  assert.equal(selected.ensembleAdaptiveSelectionNegativeCount, 20);
  assert.equal(selected.ensemblePriorShrinkageSupportFloor, 160);
  assert.ok(Date.parse(selected.ensembleAdaptiveSelectionLatestOutcomeAt) < Date.parse(selected.forecastAt));
  assert.ok(selected.ensembleResearchProbabilityPositive < 0.9);
});

test('target outcome cannot influence its own adaptive support selection', () => {
  const base = Array.from({ length: 41 }, (_, index) => scalarPrediction(index, { positiveOutcome: index % 2, probability: 0.9 }));
  const targetIndex = base.length - 1;
  const withNegativeTarget = base.map((prediction, index) => index === targetIndex ? { ...prediction, positiveOutcome: 0 } : prediction);
  const withPositiveTarget = base.map((prediction, index) => index === targetIndex ? { ...prediction, positiveOutcome: 1 } : prediction);

  const negative = buildHistoricalMarketAdaptivePriorShrunkPrequentialStackFromScalar(scalarStack(withNegativeTarget)).predictions.at(-1);
  const positive = buildHistoricalMarketAdaptivePriorShrunkPrequentialStackFromScalar(scalarStack(withPositiveTarget)).predictions.at(-1);

  assert.equal(negative.ensemblePriorShrinkageSupportFloor, positive.ensemblePriorShrinkageSupportFloor);
  assert.equal(negative.ensembleAdaptiveSelectedHistoricalBrierScore, positive.ensembleAdaptiveSelectedHistoricalBrierScore);
  assert.equal(negative.ensembleResearchProbabilityPositive, positive.ensembleResearchProbabilityPositive);
});

test('earlier forecast with outcome known after target is excluded from adaptive selection history', () => {
  const predictions = Array.from({ length: 42 }, (_, index) => scalarPrediction(index, { positiveOutcome: index % 2, probability: 0.9 }));
  const target = predictions.at(-1);
  const delayedOutcomeMs = Date.parse(target.forecastAt) + DAY_MS;
  predictions[5] = scalarPrediction(5, {
    forecastId: predictions[5].forecastId,
    positiveOutcome: predictions[5].positiveOutcome,
    probability: 0.9,
    outcomeMs: delayedOutcomeMs,
  });

  const result = buildHistoricalMarketAdaptivePriorShrunkPrequentialStackFromScalar(scalarStack(predictions));
  const selected = result.predictions.at(-1);
  assert.equal(selected.ensembleAdaptiveSelectionSampleSize, 40);
  assert.ok(Date.parse(selected.ensembleAdaptiveSelectionLatestOutcomeAt) < Date.parse(selected.forecastAt));
});

test('duplicate forecast ids cannot overwrite adaptive selections for other prediction objects', () => {
  const predictions = Array.from({ length: 41 }, (_, index) => scalarPrediction(index, {
    forecastId: 'duplicate-id',
    positiveOutcome: index % 2,
    probability: 0.9,
  }));
  const result = buildHistoricalMarketAdaptivePriorShrunkPrequentialStackFromScalar(scalarStack(predictions));

  assert.equal(result.predictions[0].ensembleAdaptiveSelectionStatus, 'ADAPTIVE_PRIOR_SHRINKAGE_WARMUP_DEFAULT');
  assert.equal(result.predictions[0].ensemblePriorShrinkageSupportFloor, 20);
  assert.equal(result.predictions.at(-1).ensembleAdaptiveSelectionStatus, 'ADAPTIVE_PRIOR_SHRINKAGE_SELECTION_READY');
  assert.equal(result.predictions.at(-1).ensemblePriorShrinkageSupportFloor, 160);
});

test('adaptive support-floor usage counts are bounded to the registered grid and sum to all predictions', () => {
  const predictions = Array.from({ length: 55 }, (_, index) => scalarPrediction(index, {
    positiveOutcome: index % 2,
    probability: index % 3 === 0 ? 0.9 : 0.7,
  }));
  const result = buildHistoricalMarketAdaptivePriorShrunkPrequentialStackFromScalar(scalarStack(predictions));
  const grid = new Set(result.adaptiveSupportFloorGrid);
  assert.ok(result.adaptiveSupportFloorSelectionCounts.every((item) => grid.has(item.supportFloor)));
  assert.equal(
    result.adaptiveSupportFloorSelectionCounts.reduce((sum, item) => sum + item.predictionCount, 0),
    result.predictionCount,
  );
});

test('adaptive shrinkage stays research-only and exports no authority', () => {
  const predictions = Array.from({ length: 41 }, (_, index) => scalarPrediction(index));
  const result = buildHistoricalMarketAdaptivePriorShrunkPrequentialStackFromScalar(scalarStack(predictions));
  assert.equal(result.historicalResearchOnly, true);
  assert.equal(result.automaticModelPromotionEnabled, false);
  assert.equal(result.probabilityCalibrationEnabled, false);
  assert.equal(result.decisionIntegrationEnabled, false);
  assert.equal(result.forecastMayInfluenceFinalAction, false);
  assert.equal(result.brokerExecutionEligible, false);
  assert.equal(result.decisionImpact, 'NONE');
  assert.ok(result.adaptiveSelectionRule.includes('OUTCOMES_REALIZED_STRICTLY_BEFORE_TARGET_FORECAST_TIME'));
});
