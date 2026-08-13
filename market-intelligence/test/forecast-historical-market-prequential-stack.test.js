import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORICAL_MARKET_PREQUENTIAL_STACK_CONTRACT,
  buildHistoricalMarketFactorPrequentialStackPredictions,
} from '../src/forecast-historical-market-prequential-stack.js';

const DAY_MS = 86_400_000;
const START_MS = Date.UTC(2022, 0, 3);

function historicalRecord(index, options = {}) {
  const forecastMs = START_MS + index * DAY_MS;
  const outcomeDelayDays = Number(options.outcomeDelayDays ?? 2);
  const outcomeMs = options.outcomeMs ?? (forecastMs + outcomeDelayDays * DAY_MS);
  const positiveOutcome = options.positiveOutcome ?? (index % 2);
  const factorScore = options.factorScore ?? (positiveOutcome === 1 ? 0.9 : -0.9);
  return {
    forecastId: options.forecastId || `historical:${options.regimeKey || 'R1'}:${index}`,
    validationMode: options.validationMode || 'WALK_FORWARD_OOS',
    evidenceClass: options.evidenceClass || 'HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH',
    status: options.status || 'MATURED',
    historicalPatternPolicyVersion: options.patternVersion || 'pattern-v1',
    historicalMarketFactorPolicyVersion: options.factorVersion || 'market-factor-v1',
    historicalMarketFactorStatus: options.factorStatus || 'HISTORICAL_MARKET_FACTOR_READY',
    instrumentId: options.instrumentId || `instrument:${index % 12}`,
    companyId: options.instrumentId || `instrument:${index % 12}`,
    assetClass: options.assetClass || 'EQUITY',
    horizon: options.horizon || 'week1',
    tradingDays: 5,
    regimeKey: options.regimeKey || 'RISK_ON|BULL_TREND|LOW_VOLATILITY|POSITIVE_MOMENTUM',
    forecastAt: new Date(forecastMs).toISOString(),
    forecastSampleDate: new Date(forecastMs).toISOString().slice(0, 10),
    outcomeKnownAt: new Date(outcomeMs).toISOString(),
    realisedOutcome: { timestamp: new Date(outcomeMs).toISOString() },
    rawProbabilityPositive: options.rawProbabilityPositive ?? 0.5,
    historicalMarketFactorScore: factorScore,
    positiveOutcome,
  };
}

function records(count, options = {}) {
  return Array.from({ length: count }, (_, index) => historicalRecord(index, options));
}

test('historical prequential stack accepts only WALK_FORWARD_OOS historical market-factor lineage', () => {
  const historical = records(80);
  const live = records(10).map((record, index) => ({
    ...record,
    forecastId: `live:${index}`,
    validationMode: 'LIVE_SHADOW_OOS',
    factorScorePolicyVersion: 'live-factor-v1',
    latentFactorScore: record.historicalMarketFactorScore,
  }));
  const result = buildHistoricalMarketFactorPrequentialStackPredictions([...historical, ...live], {
    ensembleMinimumTrainingSample: 20,
    ensembleMinimumTrainingClassCount: 5,
  });

  assert.equal(result.contract, HISTORICAL_MARKET_PREQUENTIAL_STACK_CONTRACT);
  assert.equal(result.eligibleRecordCount, historical.length);
  assert.equal(result.rejectedRecordCount, live.length);
  assert.equal(result.liveShadowRecordsAccepted, false);
  assert.ok(result.predictionCount > 0);
  assert.ok(result.predictions.every((prediction) => prediction.validationMode === 'WALK_FORWARD_OOS'));
  assert.ok(result.predictions.every((prediction) => prediction.evidenceClass === 'HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH'));
});

test('target and future outcomes can never enter their own historical prequential training set', () => {
  const input = records(90, { outcomeDelayDays: 3 });
  const result = buildHistoricalMarketFactorPrequentialStackPredictions(input, {
    ensembleMinimumTrainingSample: 20,
    ensembleMinimumTrainingClassCount: 5,
  });
  assert.ok(result.predictionCount > 0);

  for (const prediction of result.predictions) {
    assert.ok(Date.parse(prediction.ensembleTrainingLatestOutcomeAt) < Date.parse(prediction.forecastAt));
    assert.ok(prediction.ensembleTrainingSampleSize < input.filter((record) => Date.parse(record.forecastAt) <= Date.parse(prediction.forecastAt)).length);
  }
});

test('outcome known after a target forecast is excluded even when its forecast happened much earlier', () => {
  const input = records(100);
  const target = input[70];
  const delayed = {
    ...input[10],
    forecastId: 'historical:delayed-outcome',
    outcomeKnownAt: new Date(Date.parse(target.forecastAt) + 5 * DAY_MS).toISOString(),
    realisedOutcome: { timestamp: new Date(Date.parse(target.forecastAt) + 5 * DAY_MS).toISOString() },
  };
  input[10] = delayed;

  const result = buildHistoricalMarketFactorPrequentialStackPredictions(input, {
    ensembleMinimumTrainingSample: 20,
    ensembleMinimumTrainingClassCount: 5,
  });
  const targetPrediction = result.predictions.find((prediction) => prediction.forecastId === target.forecastId);
  assert.ok(targetPrediction);
  assert.ok(Date.parse(targetPrediction.ensembleTrainingLatestOutcomeAt) < Date.parse(targetPrediction.forecastAt));
  const expectedTraining = input.filter((record) => Date.parse(record.realisedOutcome.timestamp) < Date.parse(target.forecastAt)).length;
  assert.equal(targetPrediction.ensembleTrainingSampleSize, expectedTraining);
});

test('pattern factor version horizon asset class and regime lineages are never pooled', () => {
  const base = records(90);
  const otherRegime = records(30, { regimeKey: 'RISK_OFF|BEAR_TREND|HIGH_VOLATILITY|NEGATIVE_MOMENTUM' });
  const otherFactor = records(30, { factorVersion: 'market-factor-v2' });
  const otherHorizon = records(30, { horizon: 'month1' });
  const result = buildHistoricalMarketFactorPrequentialStackPredictions([...base, ...otherRegime, ...otherFactor, ...otherHorizon], {
    ensembleMinimumTrainingSample: 20,
    ensembleMinimumTrainingClassCount: 5,
  });

  assert.ok(result.modelFitCount > 0);
  const firstBasePrediction = result.predictions.find((prediction) => prediction.regimeKey === base[0].regimeKey && prediction.horizon === 'week1' && prediction.historicalMarketFactorPolicyVersion === 'market-factor-v1');
  assert.ok(firstBasePrediction);
  assert.ok(firstBasePrediction.ensembleTrainingSampleSize <= base.length);
});

test('strong historical market factor can move probability away from an uninformative raw pattern baseline', () => {
  const input = records(160).map((record, index) => ({
    ...record,
    rawProbabilityPositive: 0.5,
    positiveOutcome: index % 2,
    historicalMarketFactorScore: index % 2 ? 1 : -1,
  }));
  const result = buildHistoricalMarketFactorPrequentialStackPredictions(input, {
    ensembleMinimumTrainingSample: 30,
    ensembleMinimumTrainingClassCount: 10,
    ensembleL2Penalty: 0.02,
  });
  assert.ok(result.predictionCount > 80);
  const positives = result.predictions.filter((prediction) => prediction.positiveOutcome === 1);
  const negatives = result.predictions.filter((prediction) => prediction.positiveOutcome === 0);
  const positiveMean = positives.reduce((sum, item) => sum + item.ensembleResearchProbabilityPositive, 0) / positives.length;
  const negativeMean = negatives.reduce((sum, item) => sum + item.ensembleResearchProbabilityPositive, 0) / negatives.length;
  assert.ok(positiveMean > 0.65);
  assert.ok(negativeMean < 0.35);
  assert.ok(positiveMean > negativeMean);
});

test('historical prequential predictions remain compact research-only and authority-free', () => {
  const result = buildHistoricalMarketFactorPrequentialStackPredictions(records(90), {
    ensembleMinimumTrainingSample: 20,
    ensembleMinimumTrainingClassCount: 5,
  });
  const serialized = JSON.stringify(result);
  assert.equal(result.historicalResearchOnly, true);
  assert.equal(result.automaticModelPromotionEnabled, false);
  assert.equal(result.probabilityCalibrationEnabled, false);
  assert.equal(result.decisionIntegrationEnabled, false);
  assert.equal(result.forecastMayInfluenceFinalAction, false);
  assert.equal(result.brokerExecutionEligible, false);
  assert.equal(result.decisionImpact, 'NONE');
  assert.equal(serialized.includes('LIVE_SHADOW_OOS'), false);
  assert.equal(serialized.includes('"latentFactorScore"'), false);
  assert.equal(serialized.includes('"candles"'), false);
});
