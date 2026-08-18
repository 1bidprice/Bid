import { buildHistoricalMarketFactorPrequentialStackPredictions } from './forecast-historical-market-prequential-stack.js';

export const PROSPECTIVE_FROZEN_STACK_BRIDGE_CONTRACT = 'PROSPECTIVE_FROZEN_V1829_STACK_BRIDGE_V1';
export const PROSPECTIVE_FROZEN_STACK_BRIDGE_VERSION = '2026-08-16.1';
export const PROSPECTIVE_FROZEN_STACK_MODEL_SOURCE_COMMIT = '0e13074f1e8d89c5f52f3825c07203f0e62f20a8';

const MINIMUM_TRAINING_SAMPLE = 60;
const MINIMUM_TRAINING_CLASS_COUNT = 15;
const L2_PENALTY = 0.08;
const LEARNING_RATE = 0.06;
const MAX_ITERATIONS = 320;
const GRADIENT_TOLERANCE = 1e-7;
const BETA_ALPHA = 1;
const BETA_BETA = 1;
const SUPPORT_GRID = Object.freeze([60, 120, 240, 480]);

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timestampMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 8) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-clamp(value, -30, 30)));
}

function logit(probability) {
  const bounded = clamp(probability, 1e-4, 1 - 1e-4);
  return clamp(Math.log(bounded / (1 - bounded)), -6, 6);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function domainContributionValue(record, domain) {
  const contributions = Array.isArray(record?.historicalMarketFactorSnapshot?.domainContributions)
    ? record.historicalMarketFactorSnapshot.domainContributions
    : [];
  const item = contributions.find((entry) => entry?.domain === domain);
  const value = finite(item?.value);
  return value !== null && value >= -1 && value <= 1 ? value : null;
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

function trainingRecordEligible(record, featureMode) {
  const forecastAt = timestampMs(record?.forecastAt);
  const outcomeAt = timestampMs(record?.realisedOutcome?.timestamp || record?.outcomeKnownAt);
  const patternProbability = finite(record?.rawProbabilityPositive);
  const common = record?.validationMode === 'WALK_FORWARD_OOS'
    && record?.evidenceClass === 'HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH'
    && record?.status === 'MATURED'
    && typeof record?.historicalPatternPolicyVersion === 'string'
    && typeof record?.historicalMarketFactorPolicyVersion === 'string'
    && record?.historicalMarketFactorStatus === 'HISTORICAL_MARKET_FACTOR_READY'
    && typeof record?.assetClass === 'string'
    && typeof record?.horizon === 'string'
    && typeof record?.regimeKey === 'string'
    && patternProbability !== null && patternProbability >= 0 && patternProbability <= 1
    && (record?.positiveOutcome === 0 || record?.positiveOutcome === 1)
    && forecastAt !== null && outcomeAt !== null && outcomeAt > forecastAt;
  if (!common) return false;
  if (featureMode === 'DOMAIN_SEPARATED') {
    return domainContributionValue(record, 'MOMENTUM') !== null && domainContributionValue(record, 'RISK') !== null;
  }
  const factor = finite(record?.historicalMarketFactorScore);
  return factor !== null && factor >= -1 && factor <= 1;
}

function targetEligible(target, featureMode) {
  const forecastAt = timestampMs(target?.forecastAt);
  const probability = finite(target?.rawProbabilityPositive);
  const common = forecastAt !== null
    && typeof target?.historicalPatternPolicyVersion === 'string'
    && typeof target?.historicalMarketFactorPolicyVersion === 'string'
    && target?.historicalMarketFactorStatus === 'HISTORICAL_MARKET_FACTOR_READY'
    && typeof target?.assetClass === 'string'
    && typeof target?.horizon === 'string'
    && typeof target?.regimeKey === 'string'
    && probability !== null && probability >= 0 && probability <= 1;
  if (!common) return false;
  if (featureMode === 'DOMAIN_SEPARATED') {
    return domainContributionValue(target, 'MOMENTUM') !== null && domainContributionValue(target, 'RISK') !== null;
  }
  const factor = finite(target?.historicalMarketFactorScore);
  return factor !== null && factor >= -1 && factor <= 1;
}

function featureSpec(featureMode) {
  if (featureMode === 'DOMAIN_SEPARATED') {
    return {
      featureMode,
      initialCoefficients: [0, 1, 0, 0],
      values: (record) => [
        1,
        logit(Number(record.rawProbabilityPositive)),
        domainContributionValue(record, 'MOMENTUM'),
        domainContributionValue(record, 'RISK'),
      ],
      coefficientObject: (coefficients) => ({
        intercept: round(coefficients[0]),
        patternLogit: round(coefficients[1]),
        historicalMomentumScore: round(coefficients[2]),
        historicalRiskScore: round(coefficients[3]),
      }),
    };
  }
  return {
    featureMode: 'SCALAR',
    initialCoefficients: [0, 1, 0],
    values: (record) => [1, logit(Number(record.rawProbabilityPositive)), Number(record.historicalMarketFactorScore)],
    coefficientObject: (coefficients) => ({
      intercept: round(coefficients[0]),
      patternLogit: round(coefficients[1]),
      historicalMarketFactorScore: round(coefficients[2]),
    }),
  };
}

function fit(training, spec) {
  const coefficients = [...spec.initialCoefficients];
  let iterations = 0;
  for (; iterations < MAX_ITERATIONS; iterations += 1) {
    const gradient = Array(coefficients.length).fill(0);
    for (const record of training) {
      const x = spec.values(record);
      const probability = sigmoid(dot(coefficients, x));
      const error = probability - record.positiveOutcome;
      for (let index = 0; index < gradient.length; index += 1) gradient[index] += error * x[index];
    }
    const scale = 1 / training.length;
    gradient[0] *= scale;
    for (let index = 1; index < gradient.length; index += 1) gradient[index] = gradient[index] * scale + L2_PENALTY * coefficients[index];
    const maxGradient = Math.max(...gradient.map((value) => Math.abs(value)));
    for (let index = 0; index < coefficients.length; index += 1) coefficients[index] -= LEARNING_RATE * gradient[index];
    if (maxGradient <= GRADIENT_TOLERANCE) break;
  }
  return {
    coefficientVector: coefficients.map((value) => round(value)),
    coefficients: spec.coefficientObject(coefficients),
    iterations: iterations + 1,
  };
}

function trainingForTarget(records, target, featureMode) {
  const cutoff = timestampMs(target?.forecastAt);
  const key = lineageKey(target);
  return (Array.isArray(records) ? records : [])
    .filter((record) => trainingRecordEligible(record, featureMode))
    .filter((record) => lineageKey(record) === key)
    .filter((record) => {
      const outcomeAt = timestampMs(record?.realisedOutcome?.timestamp || record?.outcomeKnownAt);
      return cutoff !== null && outcomeAt !== null && outcomeAt < cutoff;
    });
}

function withheld(modelVariant, target, reason, training = []) {
  return {
    modelVariant,
    status: 'WITHHELD',
    probabilityPositive: null,
    withheldReason: reason,
    trainingSampleSize: training.length,
    trainingPositiveCount: training.filter((record) => record.positiveOutcome === 1).length,
    trainingNegativeCount: training.filter((record) => record.positiveOutcome === 0).length,
    trainingLatestOutcomeAt: null,
    featureAsOf: target?.forecastAt || null,
    modelSourceCommit: PROSPECTIVE_FROZEN_STACK_MODEL_SOURCE_COMMIT,
  };
}

function scalarOrDomainPrediction(records, target, featureMode, modelVariant) {
  if (!targetEligible(target, featureMode)) return withheld(modelVariant, target, 'TARGET_FEATURE_LINEAGE_NOT_READY');
  const training = trainingForTarget(records, target, featureMode);
  const positives = training.filter((record) => record.positiveOutcome === 1).length;
  const negatives = training.length - positives;
  if (training.length < MINIMUM_TRAINING_SAMPLE || positives < MINIMUM_TRAINING_CLASS_COUNT || negatives < MINIMUM_TRAINING_CLASS_COUNT) {
    return withheld(modelVariant, target, 'FROZEN_STACK_INSUFFICIENT_PREOUTCOME_TRAINING', training);
  }
  const spec = featureSpec(featureMode);
  const model = fit(training, spec);
  const probability = sigmoid(dot(model.coefficientVector, spec.values(target)));
  const latestOutcome = training.reduce((latest, record) => Math.max(latest, timestampMs(record?.realisedOutcome?.timestamp || record?.outcomeKnownAt) || 0), 0);
  return {
    modelVariant,
    status: 'FORECAST_AVAILABLE',
    probabilityPositive: round(probability),
    withheldReason: null,
    trainingSampleSize: training.length,
    trainingPositiveCount: positives,
    trainingNegativeCount: negatives,
    trainingLatestOutcomeAt: latestOutcome ? new Date(latestOutcome).toISOString() : null,
    featureAsOf: target.forecastAt,
    coefficients: model.coefficients,
    modelIterations: model.iterations,
    l2Penalty: L2_PENALTY,
    modelSourceCommit: PROSPECTIVE_FROZEN_STACK_MODEL_SOURCE_COMMIT,
  };
}

function shrinkScalar(scalar, supportFloor, modelVariant, extra = {}) {
  if (scalar.status !== 'FORECAST_AVAILABLE') return { ...scalar, modelVariant };
  const n = scalar.trainingSampleSize;
  const baseRate = (scalar.trainingPositiveCount + BETA_ALPHA) / (n + BETA_ALPHA + BETA_BETA);
  const reliabilityWeight = n / (n + supportFloor);
  const probability = baseRate + reliabilityWeight * (scalar.probabilityPositive - baseRate);
  return {
    ...scalar,
    modelVariant,
    probabilityPositive: round(clamp(probability, 1e-4, 1 - 1e-4)),
    trainingBaseRatePositive: round(baseRate),
    supportReliabilityWeight: round(reliabilityWeight),
    priorShrinkageBetaAlpha: BETA_ALPHA,
    priorShrinkageBetaBeta: BETA_BETA,
    supportFloor,
    ...extra,
  };
}

function brierForFloor(predictions, floor) {
  if (!predictions.length) return null;
  let sum = 0;
  for (const prediction of predictions) {
    if (prediction.positiveOutcome !== 0 && prediction.positiveOutcome !== 1) return null;
    const n = Number(prediction.ensembleTrainingPositiveCount || 0) + Number(prediction.ensembleTrainingNegativeCount || 0);
    const baseRate = (Number(prediction.ensembleTrainingPositiveCount || 0) + BETA_ALPHA) / (n + BETA_ALPHA + BETA_BETA);
    const weight = n / (n + floor);
    const candidate = baseRate + weight * (Number(prediction.ensembleResearchProbabilityPositive) - baseRate);
    const error = candidate - prediction.positiveOutcome;
    sum += error * error;
  }
  return sum / predictions.length;
}

function adaptiveSupportSelection(records, target) {
  const historicalScalar = buildHistoricalMarketFactorPrequentialStackPredictions(records, {
    ensembleMinimumTrainingSample: MINIMUM_TRAINING_SAMPLE,
    ensembleMinimumTrainingClassCount: MINIMUM_TRAINING_CLASS_COUNT,
    ensembleL2Penalty: L2_PENALTY,
    ensembleLearningRate: LEARNING_RATE,
    ensembleMaxIterations: MAX_ITERATIONS,
    ensembleGradientTolerance: GRADIENT_TOLERANCE,
  });
  const cutoff = timestampMs(target?.forecastAt);
  const key = lineageKey(target);
  const history = (historicalScalar.predictions || []).filter((prediction) => {
    const outcomeAt = timestampMs(prediction?.realisedOutcome?.timestamp || prediction?.outcomeKnownAt);
    return lineageKey(prediction) === key && cutoff !== null && outcomeAt !== null && outcomeAt < cutoff;
  });
  const positives = history.filter((prediction) => prediction.positiveOutcome === 1).length;
  const negatives = history.length - positives;
  const ready = history.length >= MINIMUM_TRAINING_SAMPLE && positives >= MINIMUM_TRAINING_CLASS_COUNT && negatives >= MINIMUM_TRAINING_CLASS_COUNT;
  if (!ready) {
    return {
      status: 'ADAPTIVE_PRIOR_SHRINKAGE_WARMUP_DEFAULT',
      supportFloor: SUPPORT_GRID[0],
      selectionSampleSize: history.length,
      selectionPositiveCount: positives,
      selectionNegativeCount: negatives,
      selectedHistoricalBrierScore: null,
    };
  }
  let bestFloor = SUPPORT_GRID[0];
  let bestBrier = null;
  for (const floor of SUPPORT_GRID) {
    const brier = brierForFloor(history, floor);
    if (brier === null) continue;
    if (bestBrier === null || brier < bestBrier - 1e-12 || (Math.abs(brier - bestBrier) <= 1e-12 && floor > bestFloor)) {
      bestFloor = floor;
      bestBrier = brier;
    }
  }
  return {
    status: 'ADAPTIVE_PRIOR_SHRINKAGE_SELECTION_READY',
    supportFloor: bestFloor,
    selectionSampleSize: history.length,
    selectionPositiveCount: positives,
    selectionNegativeCount: negatives,
    selectedHistoricalBrierScore: round(bestBrier),
  };
}

export function buildProspectiveFrozenStackPredictions(records = [], target = {}) {
  const scalar = scalarOrDomainPrediction(records, target, 'SCALAR', 'SCALAR_MARKET_FACTOR');
  const domain = scalarOrDomainPrediction(records, target, 'DOMAIN_SEPARATED', 'DOMAIN_SEPARATED_MARKET_FACTOR');
  const prior = shrinkScalar(scalar, MINIMUM_TRAINING_SAMPLE, 'PRIOR_SHRUNK_SCALAR_MARKET_FACTOR');
  const adaptiveSelection = scalar.status === 'FORECAST_AVAILABLE'
    ? adaptiveSupportSelection(records, target)
    : { status: 'ADAPTIVE_PRIOR_SHRINKAGE_NOT_AVAILABLE', supportFloor: SUPPORT_GRID[0], selectionSampleSize: 0, selectionPositiveCount: 0, selectionNegativeCount: 0, selectedHistoricalBrierScore: null };
  const adaptive = shrinkScalar(scalar, adaptiveSelection.supportFloor, 'ADAPTIVE_PRIOR_SHRUNK_SCALAR_MARKET_FACTOR', {
    adaptiveSupportFloorGrid: [...SUPPORT_GRID],
    adaptiveSelectionStatus: adaptiveSelection.status,
    adaptiveSelectionSampleSize: adaptiveSelection.selectionSampleSize,
    adaptiveSelectionPositiveCount: adaptiveSelection.selectionPositiveCount,
    adaptiveSelectionNegativeCount: adaptiveSelection.selectionNegativeCount,
    adaptiveSelectedHistoricalBrierScore: adaptiveSelection.selectedHistoricalBrierScore,
  });

  return {
    contract: PROSPECTIVE_FROZEN_STACK_BRIDGE_CONTRACT,
    policyVersion: PROSPECTIVE_FROZEN_STACK_BRIDGE_VERSION,
    modelSourceCommit: PROSPECTIVE_FROZEN_STACK_MODEL_SOURCE_COMMIT,
    targetLineageKey: lineageKey(target),
    forecastAt: target?.forecastAt || null,
    predictions: [scalar, domain, prior, adaptive],
    modelVariantCount: 4,
    outcomeFieldsRequiredFromTarget: false,
    targetOutcomeUsed: false,
    prospectiveResearchOnly: true,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}
