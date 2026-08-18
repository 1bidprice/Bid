import {
  HISTORICAL_MARKET_PREQUENTIAL_STACK_CONTRACT,
  buildHistoricalMarketFactorPrequentialStackPredictions,
} from './forecast-historical-market-prequential-stack.js';
import { forecastDateKey } from './forecast-oos-sample-independence.js';

export const HISTORICAL_MARKET_ADAPTIVE_PRIOR_SHRINKAGE_VERSION = '2026-08-14.2';
export const HISTORICAL_MARKET_ADAPTIVE_PRIOR_SHRINKAGE_CONTRACT = 'PREQUENTIAL_HISTORICAL_PATTERN_MARKET_FACTOR_ADAPTIVE_PRIOR_SHRINKAGE_V1';

const BETA_ALPHA = 1;
const BETA_BETA = 1;
const SUPPORT_MULTIPLIERS = Object.freeze([1, 2, 4, 8]);

function strictNumber(value) {
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

function lineageKey(prediction = {}) {
  return [
    prediction.historicalPatternPolicyVersion || 'NO_PATTERN_VERSION',
    prediction.historicalMarketFactorPolicyVersion || 'NO_MARKET_FACTOR_VERSION',
    prediction.assetClass || 'UNKNOWN',
    prediction.horizon || 'UNKNOWN',
    prediction.regimeKey || 'NO_REGIME',
  ].join('|');
}

function supportFloorGrid(minimumTrainingSample) {
  const base = Math.max(20, Math.floor(Number(minimumTrainingSample || 60)));
  return SUPPORT_MULTIPLIERS.map((multiplier) => base * multiplier);
}

function trainingBaseRate(prediction) {
  const positiveCount = Math.max(0, Number(prediction?.ensembleTrainingPositiveCount || 0));
  const negativeCount = Math.max(0, Number(prediction?.ensembleTrainingNegativeCount || 0));
  const sampleSize = positiveCount + negativeCount;
  return {
    positiveCount,
    negativeCount,
    sampleSize,
    probability: (positiveCount + BETA_ALPHA) / (sampleSize + BETA_ALPHA + BETA_BETA),
  };
}

function probabilityForSupportFloor(prediction, supportFloor) {
  const baseRate = trainingBaseRate(prediction);
  const scalarProbability = strictNumber(prediction?.ensembleResearchProbabilityPositive);
  if (scalarProbability === null) return null;
  const reliabilityWeight = baseRate.sampleSize / (baseRate.sampleSize + supportFloor);
  const probability = baseRate.probability + reliabilityWeight * (scalarProbability - baseRate.probability);
  return {
    probability: clamp(probability, 1e-4, 1 - 1e-4),
    baseRate: baseRate.probability,
    reliabilityWeight,
  };
}

function outcomeKnownMs(prediction) {
  return timestampMs(prediction?.realisedOutcome?.timestamp || prediction?.outcomeKnownAt);
}

function brierScoreForFloor(history, supportFloor) {
  let sum = 0;
  for (const prediction of history) {
    const candidate = probabilityForSupportFloor(prediction, supportFloor);
    if (!candidate || (prediction.positiveOutcome !== 0 && prediction.positiveOutcome !== 1)) return null;
    const error = candidate.probability - prediction.positiveOutcome;
    sum += error * error;
  }
  return history.length ? sum / history.length : null;
}

function chooseSupportFloor(history, grid) {
  let bestFloor = grid[0];
  let bestBrier = null;
  for (const supportFloor of grid) {
    const brier = brierScoreForFloor(history, supportFloor);
    if (brier === null) continue;
    if (bestBrier === null || brier < bestBrier - 1e-12 || (Math.abs(brier - bestBrier) <= 1e-12 && supportFloor > bestFloor)) {
      bestFloor = supportFloor;
      bestBrier = brier;
    }
  }
  return { supportFloor: bestFloor, brierScore: bestBrier };
}

function selectionForTarget(lineage, targets, grid, minimumSelectionSample, minimumSelectionClassCount) {
  const cutoffMs = Math.min(...targets.map((prediction) => timestampMs(prediction.forecastAt)).filter(Number.isFinite));
  if (!Number.isFinite(cutoffMs)) {
    return {
      status: 'ADAPTIVE_PRIOR_SHRINKAGE_WARMUP_DEFAULT',
      supportFloor: grid[0],
      selectionSampleSize: 0,
      selectionPositiveCount: 0,
      selectionNegativeCount: 0,
      selectionLatestOutcomeAt: null,
      selectedBrierScore: null,
    };
  }
  const history = lineage.filter((prediction) => {
    const knownAt = outcomeKnownMs(prediction);
    return knownAt !== null && knownAt < cutoffMs;
  });
  const positiveCount = history.filter((prediction) => prediction.positiveOutcome === 1).length;
  const negativeCount = history.length - positiveCount;
  const latestOutcomeMs = history.reduce((latest, prediction) => Math.max(latest, outcomeKnownMs(prediction) || 0), 0);
  const ready = history.length >= minimumSelectionSample
    && positiveCount >= minimumSelectionClassCount
    && negativeCount >= minimumSelectionClassCount;
  if (!ready) {
    return {
      status: 'ADAPTIVE_PRIOR_SHRINKAGE_WARMUP_DEFAULT',
      supportFloor: grid[0],
      selectionSampleSize: history.length,
      selectionPositiveCount: positiveCount,
      selectionNegativeCount: negativeCount,
      selectionLatestOutcomeAt: latestOutcomeMs ? new Date(latestOutcomeMs).toISOString() : null,
      selectedBrierScore: null,
    };
  }
  const selected = chooseSupportFloor(history, grid);
  return {
    status: 'ADAPTIVE_PRIOR_SHRINKAGE_SELECTION_READY',
    supportFloor: selected.supportFloor,
    selectionSampleSize: history.length,
    selectionPositiveCount: positiveCount,
    selectionNegativeCount: negativeCount,
    selectionLatestOutcomeAt: latestOutcomeMs ? new Date(latestOutcomeMs).toISOString() : null,
    selectedBrierScore: round(selected.brierScore),
  };
}

function selectedPrediction(prediction, selection, grid) {
  const candidate = probabilityForSupportFloor(prediction, selection.supportFloor);
  if (!candidate) throw new Error('Adaptive prior shrinkage requires finite scalar probability');
  return {
    ...prediction,
    ensembleResearchProbabilityPositive: round(candidate.probability),
    ensembleFeatureMode: 'ADAPTIVE_PRIOR_SHRUNK_SCALAR',
    ensembleTrainingBaseRatePositive: round(candidate.baseRate),
    ensembleSupportReliabilityWeight: round(candidate.reliabilityWeight),
    ensemblePriorShrinkageBetaAlpha: BETA_ALPHA,
    ensemblePriorShrinkageBetaBeta: BETA_BETA,
    ensemblePriorShrinkageSupportFloor: selection.supportFloor,
    ensembleAdaptiveSupportFloorGrid: [...grid],
    ensembleAdaptiveSelectionStatus: selection.status,
    ensembleAdaptiveSelectionSampleSize: selection.selectionSampleSize,
    ensembleAdaptiveSelectionPositiveCount: selection.selectionPositiveCount,
    ensembleAdaptiveSelectionNegativeCount: selection.selectionNegativeCount,
    ensembleAdaptiveSelectionLatestOutcomeAt: selection.selectionLatestOutcomeAt,
    ensembleAdaptiveSelectedHistoricalBrierScore: selection.selectedBrierScore,
  };
}

export function buildHistoricalMarketAdaptivePriorShrunkPrequentialStackFromScalar(scalar = {}) {
  if (scalar?.contract !== HISTORICAL_MARKET_PREQUENTIAL_STACK_CONTRACT) {
    throw new Error('Adaptive prior shrinkage requires canonical scalar prequential stack');
  }
  const inputPredictions = Array.isArray(scalar.predictions) ? scalar.predictions : [];
  const grid = supportFloorGrid(scalar.minimumTrainingSample);
  const minimumSelectionSample = Math.max(20, Math.floor(Number(scalar.minimumTrainingSample || 60)));
  const minimumSelectionClassCount = Math.max(5, Math.floor(Number(scalar.minimumTrainingClassCount || 15)));
  const selections = new Map();
  const lineageGroups = new Map();

  for (const prediction of inputPredictions) {
    const key = lineageKey(prediction);
    const items = lineageGroups.get(key) || [];
    items.push(prediction);
    lineageGroups.set(key, items);
  }

  for (const lineage of lineageGroups.values()) {
    const dateGroups = new Map();
    for (const prediction of lineage) {
      const date = forecastDateKey(prediction);
      if (!date) continue;
      const items = dateGroups.get(date) || [];
      items.push(prediction);
      dateGroups.set(date, items);
    }
    const orderedDates = [...dateGroups.keys()].sort();
    for (const date of orderedDates) {
      const targets = dateGroups.get(date) || [];
      const selection = selectionForTarget(lineage, targets, grid, minimumSelectionSample, minimumSelectionClassCount);
      for (const target of targets) selections.set(target, selection);
    }
  }

  const supportFloorSelectionCounts = new Map();
  const predictions = inputPredictions.map((prediction) => {
    const selection = selections.get(prediction) || {
      status: 'ADAPTIVE_PRIOR_SHRINKAGE_WARMUP_DEFAULT',
      supportFloor: grid[0],
      selectionSampleSize: 0,
      selectionPositiveCount: 0,
      selectionNegativeCount: 0,
      selectionLatestOutcomeAt: null,
      selectedBrierScore: null,
    };
    const selected = selectedPrediction(prediction, selection, grid);
    supportFloorSelectionCounts.set(
      selected.ensemblePriorShrinkageSupportFloor,
      (supportFloorSelectionCounts.get(selected.ensemblePriorShrinkageSupportFloor) || 0) + 1,
    );
    return selected;
  });
  const selectionReadyPredictionCount = predictions.filter((prediction) => prediction.ensembleAdaptiveSelectionStatus === 'ADAPTIVE_PRIOR_SHRINKAGE_SELECTION_READY').length;

  return {
    ...scalar,
    contract: HISTORICAL_MARKET_ADAPTIVE_PRIOR_SHRINKAGE_CONTRACT,
    policyVersion: HISTORICAL_MARKET_ADAPTIVE_PRIOR_SHRINKAGE_VERSION,
    featureMode: 'ADAPTIVE_PRIOR_SHRUNK_SCALAR',
    featureOrder: ['PATTERN_LOGIT', 'HISTORICAL_MARKET_FACTOR_SCORE', 'TRAINING_ONLY_BASE_RATE_SHRINKAGE', 'PREQUENTIAL_BRIER_SELECTED_SUPPORT_FLOOR'],
    predictions,
    predictionCount: predictions.length,
    adaptiveSupportFloorGrid: [...grid],
    adaptiveSupportFloorSelectionCounts: [...supportFloorSelectionCounts.entries()]
      .map(([supportFloor, predictionCount]) => ({ supportFloor, predictionCount }))
      .sort((left, right) => left.supportFloor - right.supportFloor),
    adaptiveSelectionMinimumSample: minimumSelectionSample,
    adaptiveSelectionMinimumClassCount: minimumSelectionClassCount,
    adaptiveSelectionReadyPredictionCount: selectionReadyPredictionCount,
    adaptiveSelectionWarmupPredictionCount: predictions.length - selectionReadyPredictionCount,
    latestModel: scalar.latestModel ? {
      ...scalar.latestModel,
      contract: HISTORICAL_MARKET_ADAPTIVE_PRIOR_SHRINKAGE_CONTRACT,
      featureMode: 'ADAPTIVE_PRIOR_SHRUNK_SCALAR',
      adaptivePriorShrinkage: {
        betaAlpha: BETA_ALPHA,
        betaBeta: BETA_BETA,
        supportFloorGrid: [...grid],
        selectionMinimumSample: minimumSelectionSample,
        selectionMinimumClassCount: minimumSelectionClassCount,
        selectionObjective: 'BRIER_SCORE',
        tieBreak: 'PREFER_STRONGER_SHRINKAGE',
      },
    } : null,
    antiLeakRule: scalar.antiLeakRule,
    priorShrinkageRule: 'TARGET_PROBABILITY_SHRUNK_TOWARD_BETA_1_1_BASE_RATE_COMPUTED_ONLY_FROM_TARGET_MODEL_TRAINING_OUTCOMES_REALIZED_STRICTLY_BEFORE_TARGET_FORECAST_TIME',
    adaptiveSelectionRule: 'SUPPORT_FLOOR_SELECTED_BY_MINIMUM_BRIER_ON_SAME_LINEAGE_PRIOR_OOS_PREDICTIONS_WITH_OUTCOMES_REALIZED_STRICTLY_BEFORE_TARGET_FORECAST_TIME_TIES_PREFER_STRONGER_SHRINKAGE',
    adaptiveSelectionObjective: 'BRIER_SCORE',
    adaptiveTieBreak: 'PREFER_STRONGER_SHRINKAGE',
    historicalResearchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

export function buildHistoricalMarketAdaptivePriorShrunkPrequentialStackPredictions(records = [], options = {}) {
  const scalar = buildHistoricalMarketFactorPrequentialStackPredictions(records, options);
  return buildHistoricalMarketAdaptivePriorShrunkPrequentialStackFromScalar(scalar);
}
