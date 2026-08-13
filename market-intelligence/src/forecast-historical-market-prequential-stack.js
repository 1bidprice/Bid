import { forecastDateKey } from './forecast-oos-sample-independence.js';

export const HISTORICAL_MARKET_PREQUENTIAL_STACK_VERSION = '2026-08-13.1';
export const HISTORICAL_MARKET_PREQUENTIAL_STACK_CONTRACT = 'PREQUENTIAL_HISTORICAL_PATTERN_MARKET_FACTOR_STACK_V1';

function strictNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function binaryOutcome(value) {
  return value === 0 || value === 1;
}

function timestampMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function sigmoid(value) {
  const bounded = clamp(value, -30, 30);
  return 1 / (1 + Math.exp(-bounded));
}

function logit(probability) {
  const bounded = clamp(probability, 1e-4, 1 - 1e-4);
  return clamp(Math.log(bounded / (1 - bounded)), -6, 6);
}

function isHistoricalLineageRecord(record) {
  return record?.validationMode === 'WALK_FORWARD_OOS' &&
    record?.evidenceClass === 'HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH' &&
    typeof record?.historicalPatternPolicyVersion === 'string' && record.historicalPatternPolicyVersion.trim().length > 0 &&
    typeof record?.historicalMarketFactorPolicyVersion === 'string' && record.historicalMarketFactorPolicyVersion.trim().length > 0 &&
    record?.historicalMarketFactorStatus === 'HISTORICAL_MARKET_FACTOR_READY' &&
    typeof record?.assetClass === 'string' && record.assetClass.trim().length > 0 &&
    typeof record?.horizon === 'string' && record.horizon.trim().length > 0;
}

function eligibleHistoricalMaturedRecord(record) {
  if (!isHistoricalLineageRecord(record) || record?.status !== 'MATURED') return false;
  const patternProbability = strictNumber(record?.rawProbabilityPositive);
  const marketFactorScore = strictNumber(record?.historicalMarketFactorScore);
  const forecastAt = timestampMs(record?.forecastAt);
  const outcomeAt = timestampMs(record?.realisedOutcome?.timestamp || record?.outcomeKnownAt);
  return patternProbability !== null && patternProbability >= 0 && patternProbability <= 1 &&
    marketFactorScore !== null && marketFactorScore >= -1 && marketFactorScore <= 1 &&
    binaryOutcome(record?.positiveOutcome) &&
    forecastAt !== null && outcomeAt !== null && outcomeAt > forecastAt;
}

function features(record) {
  return [
    1,
    logit(Number(record.rawProbabilityPositive)),
    Number(record.historicalMarketFactorScore),
  ];
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function fitLogisticStack(trainingRecords, options = {}) {
  const l2 = Math.max(0, Number(options.ensembleL2Penalty ?? 0.08));
  const learningRate = Math.max(0.001, Math.min(0.2, Number(options.ensembleLearningRate ?? 0.06)));
  const maxIterations = Math.max(50, Math.min(1200, Math.floor(Number(options.ensembleMaxIterations ?? 320))));
  const tolerance = Math.max(1e-9, Number(options.ensembleGradientTolerance ?? 1e-7));
  const coefficients = [0, 1, 0];

  let iterations = 0;
  for (; iterations < maxIterations; iterations += 1) {
    const gradient = [0, 0, 0];
    for (const record of trainingRecords) {
      const x = features(record);
      const probability = sigmoid(dot(coefficients, x));
      const error = probability - record.positiveOutcome;
      gradient[0] += error;
      gradient[1] += error * x[1];
      gradient[2] += error * x[2];
    }
    const scale = 1 / trainingRecords.length;
    gradient[0] *= scale;
    gradient[1] = gradient[1] * scale + l2 * coefficients[1];
    gradient[2] = gradient[2] * scale + l2 * coefficients[2];
    const maxGradient = Math.max(...gradient.map((value) => Math.abs(value)));
    for (let index = 0; index < coefficients.length; index += 1) coefficients[index] -= learningRate * gradient[index];
    if (maxGradient <= tolerance) break;
  }

  return {
    contract: HISTORICAL_MARKET_PREQUENTIAL_STACK_CONTRACT,
    featureOrder: ['INTERCEPT', 'PATTERN_LOGIT', 'HISTORICAL_MARKET_FACTOR_SCORE'],
    coefficients: {
      intercept: round(coefficients[0], 8),
      patternLogit: round(coefficients[1], 8),
      historicalMarketFactorScore: round(coefficients[2], 8),
    },
    l2Penalty: l2,
    iterations: iterations + 1,
    trainingSampleSize: trainingRecords.length,
    trainingPositiveCount: trainingRecords.filter((record) => record.positiveOutcome === 1).length,
    trainingNegativeCount: trainingRecords.filter((record) => record.positiveOutcome === 0).length,
  };
}

function modelProbability(model, record) {
  const coefficients = [
    model.coefficients.intercept,
    model.coefficients.patternLogit,
    model.coefficients.historicalMarketFactorScore,
  ];
  return sigmoid(dot(coefficients, features(record)));
}

function dateGroups(records = []) {
  const groups = new Map();
  for (const record of records) {
    const date = forecastDateKey(record);
    if (!date) continue;
    const items = groups.get(date) || [];
    items.push(record);
    groups.set(date, items);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function lineageKey(record = {}) {
  return [
    record.historicalPatternPolicyVersion || 'NO_PATTERN_VERSION',
    record.historicalMarketFactorPolicyVersion || 'NO_MARKET_FACTOR_VERSION',
    record.assetClass || 'UNKNOWN',
    record.horizon || 'UNKNOWN',
    record.regimeKey || 'NO_REGIME',
  ].join('|');
}

function compactPrediction(target, probability, training, model) {
  const latestOutcomeMs = training.reduce((latest, record) => Math.max(
    latest,
    timestampMs(record?.realisedOutcome?.timestamp || record?.outcomeKnownAt) || 0,
  ), 0);
  return {
    forecastId: target.forecastId || null,
    instrumentId: target.instrumentId || target.companyId || null,
    companyId: target.companyId || target.instrumentId || null,
    assetClass: target.assetClass || 'UNKNOWN',
    horizon: target.horizon || null,
    tradingDays: target.tradingDays || null,
    forecastAt: target.forecastAt || null,
    forecastSampleDate: target.forecastSampleDate || forecastDateKey(target),
    outcomeKnownAt: target.outcomeKnownAt || target.realisedOutcome?.timestamp || null,
    realisedOutcome: target.realisedOutcome ? { timestamp: target.realisedOutcome.timestamp } : null,
    positiveOutcome: target.positiveOutcome,
    historicalPatternPolicyVersion: target.historicalPatternPolicyVersion || null,
    historicalMarketFactorPolicyVersion: target.historicalMarketFactorPolicyVersion || null,
    historicalMarketFactorScore: target.historicalMarketFactorScore,
    regimeKey: target.regimeKey || null,
    baselinePatternProbabilityPositive: target.rawProbabilityPositive,
    ensembleResearchProbabilityPositive: round(probability, 8),
    ensembleTrainingSampleSize: training.length,
    ensembleTrainingPositiveCount: model.trainingPositiveCount,
    ensembleTrainingNegativeCount: model.trainingNegativeCount,
    ensembleTrainingLatestOutcomeAt: latestOutcomeMs ? new Date(latestOutcomeMs).toISOString() : null,
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

export function buildHistoricalMarketFactorPrequentialStackPredictions(records = [], options = {}) {
  const input = Array.isArray(records) ? records : [];
  const eligible = input.filter(eligibleHistoricalMaturedRecord);
  const minimumTrainingSample = Math.max(20, Number(options.ensembleMinimumTrainingSample ?? 60));
  const minimumTrainingClassCount = Math.max(5, Number(options.ensembleMinimumTrainingClassCount ?? 15));
  const predictions = [];
  let skippedInsufficientTrainingCount = 0;
  let modelFitCount = 0;
  let latestModel = null;

  const lineageGroups = new Map();
  for (const record of eligible) {
    const key = lineageKey(record);
    const items = lineageGroups.get(key) || [];
    items.push(record);
    lineageGroups.set(key, items);
  }

  for (const lineage of lineageGroups.values()) {
    for (const [forecastDate, targets] of dateGroups(lineage)) {
      const cutoffMs = Math.min(...targets.map((record) => timestampMs(record.forecastAt)).filter(Number.isFinite));
      if (!Number.isFinite(cutoffMs)) {
        skippedInsufficientTrainingCount += targets.length;
        continue;
      }
      const training = lineage.filter((record) => {
        const outcomeAt = timestampMs(record?.realisedOutcome?.timestamp || record?.outcomeKnownAt);
        return outcomeAt !== null && outcomeAt < cutoffMs;
      });
      const positiveCount = training.filter((record) => record.positiveOutcome === 1).length;
      const negativeCount = training.length - positiveCount;
      if (training.length < minimumTrainingSample || positiveCount < minimumTrainingClassCount || negativeCount < minimumTrainingClassCount) {
        skippedInsufficientTrainingCount += targets.length;
        continue;
      }

      const model = fitLogisticStack(training, options);
      latestModel = {
        ...model,
        trainedBefore: new Date(cutoffMs).toISOString(),
        targetForecastDate: forecastDate,
      };
      modelFitCount += 1;
      for (const target of targets) {
        predictions.push(compactPrediction(target, modelProbability(model, target), training, model));
      }
    }
  }

  predictions.sort((left, right) => `${left.forecastAt}|${left.instrumentId}|${left.horizon}`.localeCompare(`${right.forecastAt}|${right.instrumentId}|${right.horizon}`));
  return {
    contract: HISTORICAL_MARKET_PREQUENTIAL_STACK_CONTRACT,
    policyVersion: HISTORICAL_MARKET_PREQUENTIAL_STACK_VERSION,
    sourceEvidenceClass: 'HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH',
    sourceValidationMode: 'WALK_FORWARD_OOS',
    eligibleRecordCount: eligible.length,
    rejectedRecordCount: input.length - eligible.length,
    predictionCount: predictions.length,
    skippedInsufficientTrainingCount,
    modelFitCount,
    latestModel,
    predictions,
    minimumTrainingSample,
    minimumTrainingClassCount,
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
