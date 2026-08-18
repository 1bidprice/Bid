import { evaluateOosSampleIndependence, splitChronologicalDateBlocks, forecastDateKey } from './forecast-oos-sample-independence.js';
import { evaluateOosOutcomeWindowIndependence } from './forecast-oos-outcome-window-independence.js';
import { evaluateOosInstrumentConcentration } from './forecast-oos-instrument-concentration.js';
import { evaluateOosTaxonomyConcentration } from './forecast-oos-taxonomy-concentration.js';

export const FORECAST_STACKED_ENSEMBLE_RESEARCH_VERSION = '2026-08-12.1';
export const FORECAST_STACKED_ENSEMBLE_CONTRACT = 'PREQUENTIAL_PATTERN_FACTOR_STACK_V1';

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

function isLineageRecord(record) {
  return record?.validationMode === 'LIVE_SHADOW_OOS' &&
    typeof record?.historicalPatternPolicyVersion === 'string' && record.historicalPatternPolicyVersion.trim().length > 0 &&
    typeof record?.factorScorePolicyVersion === 'string' && record.factorScorePolicyVersion.trim().length > 0 &&
    typeof record?.assetClass === 'string' && record.assetClass.trim().length > 0 &&
    typeof record?.horizon === 'string' && record.horizon.trim().length > 0;
}

function eligibleMaturedRecord(record) {
  if (!isLineageRecord(record) || record?.status !== 'MATURED') return false;
  const patternProbability = strictNumber(record?.rawProbabilityPositive);
  const factorScore = strictNumber(record?.latentFactorScore);
  const forecastAt = timestampMs(record?.forecastAt);
  const outcomeAt = timestampMs(record?.realisedOutcome?.timestamp);
  return patternProbability !== null && patternProbability >= 0 && patternProbability <= 1 &&
    factorScore !== null && factorScore >= -1 && factorScore <= 1 &&
    binaryOutcome(record?.positiveOutcome) &&
    forecastAt !== null && outcomeAt !== null && outcomeAt > forecastAt;
}

function groupKey(record = {}) {
  return [
    record.historicalPatternPolicyVersion || 'NO_PATTERN_VERSION',
    record.factorScorePolicyVersion || 'NO_FACTOR_VERSION',
    record.assetClass || 'UNKNOWN',
    record.horizon || 'UNKNOWN',
  ].join('|');
}

function features(record) {
  return [
    1,
    logit(Number(record.rawProbabilityPositive)),
    Number(record.latentFactorScore),
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
    for (let index = 0; index < coefficients.length; index += 1) {
      coefficients[index] -= learningRate * gradient[index];
    }
    if (maxGradient <= tolerance) break;
  }

  return {
    contract: FORECAST_STACKED_ENSEMBLE_CONTRACT,
    featureOrder: ['INTERCEPT', 'PATTERN_LOGIT', 'LATENT_FACTOR_SCORE'],
    coefficients: {
      intercept: round(coefficients[0], 8),
      patternLogit: round(coefficients[1], 8),
      latentFactorScore: round(coefficients[2], 8),
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
    model.coefficients.latentFactorScore,
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

export function buildPrequentialStackPredictions(records = [], options = {}) {
  const eligible = (Array.isArray(records) ? records : []).filter(eligibleMaturedRecord);
  const minimumTrainingSample = Math.max(20, Number(options.ensembleMinimumTrainingSample ?? 60));
  const minimumTrainingClassCount = Math.max(5, Number(options.ensembleMinimumTrainingClassCount ?? 15));
  const predictions = [];
  let skippedInsufficientTrainingCount = 0;
  let modelFitCount = 0;
  let latestModel = null;

  for (const [forecastDate, targets] of dateGroups(eligible)) {
    const cutoffMs = Math.min(...targets.map((record) => timestampMs(record.forecastAt)).filter(Number.isFinite));
    if (!Number.isFinite(cutoffMs)) {
      skippedInsufficientTrainingCount += targets.length;
      continue;
    }
    const training = eligible.filter((record) => timestampMs(record?.realisedOutcome?.timestamp) < cutoffMs);
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
      predictions.push({
        ...target,
        baselinePatternProbabilityPositive: target.rawProbabilityPositive,
        ensembleResearchProbabilityPositive: round(modelProbability(model, target), 8),
        ensembleTrainingSampleSize: training.length,
        ensembleTrainingLatestOutcomeAt: training.reduce((latest, record) => {
          const current = timestampMs(record?.realisedOutcome?.timestamp);
          return current > latest ? current : latest;
        }, 0) ? new Date(training.reduce((latest, record) => Math.max(latest, timestampMs(record?.realisedOutcome?.timestamp) || 0), 0)).toISOString() : null,
      });
    }
  }

  return {
    contract: FORECAST_STACKED_ENSEMBLE_CONTRACT,
    policyVersion: FORECAST_STACKED_ENSEMBLE_RESEARCH_VERSION,
    eligibleRecordCount: eligible.length,
    predictionCount: predictions.length,
    skippedInsufficientTrainingCount,
    modelFitCount,
    latestModel,
    predictions,
    minimumTrainingSample,
    minimumTrainingClassCount,
    antiLeakRule: 'TRAIN_ONLY_ON_OUTCOMES_REALIZED_STRICTLY_BEFORE_TARGET_FORECAST_TIME',
  };
}

function probabilityMetrics(records = [], probabilityField, binCount = 10) {
  const valid = records.filter((record) => {
    const probability = strictNumber(record?.[probabilityField]);
    return probability !== null && probability >= 0 && probability <= 1 && binaryOutcome(record?.positiveOutcome);
  });
  if (!valid.length) {
    return {
      sampleSize: 0,
      brierScore: null,
      logLoss: null,
      expectedCalibrationError: null,
      baseRate: null,
      naiveBrierScore: null,
      skillVsBaseRatePct: null,
    };
  }
  const epsilon = 1e-9;
  const baseRate = valid.reduce((sum, record) => sum + record.positiveOutcome, 0) / valid.length;
  const brier = valid.reduce((sum, record) => sum + ((record[probabilityField] - record.positiveOutcome) ** 2), 0) / valid.length;
  const logLoss = -valid.reduce((sum, record) => {
    const p = clamp(record[probabilityField], epsilon, 1 - epsilon);
    return sum + record.positiveOutcome * Math.log(p) + (1 - record.positiveOutcome) * Math.log(1 - p);
  }, 0) / valid.length;
  const naiveBrier = valid.reduce((sum, record) => sum + ((baseRate - record.positiveOutcome) ** 2), 0) / valid.length;
  const bins = Array.from({ length: Math.max(4, binCount) }, () => ({ count: 0, probabilitySum: 0, outcomeSum: 0 }));
  for (const record of valid) {
    const index = Math.min(bins.length - 1, Math.floor(record[probabilityField] * bins.length));
    bins[index].count += 1;
    bins[index].probabilitySum += record[probabilityField];
    bins[index].outcomeSum += record.positiveOutcome;
  }
  const ece = bins.reduce((sum, bin) => {
    if (!bin.count) return sum;
    const meanForecast = bin.probabilitySum / bin.count;
    const empiricalRate = bin.outcomeSum / bin.count;
    return sum + (bin.count / valid.length) * Math.abs(meanForecast - empiricalRate);
  }, 0);
  const skill = naiveBrier > 0 ? ((naiveBrier - brier) / naiveBrier) * 100 : null;
  return {
    sampleSize: valid.length,
    brierScore: round(brier),
    logLoss: round(logLoss),
    expectedCalibrationError: round(ece),
    baseRate: round(baseRate),
    naiveBrierScore: round(naiveBrier),
    skillVsBaseRatePct: round(skill, 4),
  };
}

function comparisonMetrics(predictions = []) {
  const baseline = probabilityMetrics(predictions, 'baselinePatternProbabilityPositive');
  const ensemble = probabilityMetrics(predictions, 'ensembleResearchProbabilityPositive');
  const relativeBrierImprovementPct = Number.isFinite(baseline.brierScore) && baseline.brierScore > 0 && Number.isFinite(ensemble.brierScore)
    ? ((baseline.brierScore - ensemble.brierScore) / baseline.brierScore) * 100
    : null;
  const logLossImprovement = Number.isFinite(baseline.logLoss) && Number.isFinite(ensemble.logLoss)
    ? baseline.logLoss - ensemble.logLoss
    : null;
  const eceImprovement = Number.isFinite(baseline.expectedCalibrationError) && Number.isFinite(ensemble.expectedCalibrationError)
    ? baseline.expectedCalibrationError - ensemble.expectedCalibrationError
    : null;
  return {
    baselinePattern: baseline,
    stackedEnsemble: ensemble,
    improvement: {
      relativeBrierImprovementPct: round(relativeBrierImprovementPct, 4),
      logLossImprovement: round(logLossImprovement, 6),
      expectedCalibrationErrorImprovement: round(eceImprovement, 6),
    },
  };
}

function temporalStability(predictions = [], options = {}) {
  const blockCount = Math.max(2, Number(options.ensembleStabilityBlockCount ?? 3));
  const minimumBlockSample = Math.max(20, Number(options.ensembleMinimumBlockSample ?? 40));
  const minimumBlockClassCount = Math.max(5, Number(options.ensembleMinimumBlockClassCount ?? 8));
  const blocks = splitChronologicalDateBlocks(predictions, blockCount).map((block, index) => {
    const positiveCount = block.filter((record) => record.positiveOutcome === 1).length;
    const negativeCount = block.length - positiveCount;
    const comparison = comparisonMetrics(block);
    const blockers = [];
    if (block.length < minimumBlockSample) blockers.push('ENSEMBLE_SUBPERIOD_SAMPLE_TOO_SMALL');
    if (positiveCount < minimumBlockClassCount || negativeCount < minimumBlockClassCount) blockers.push('ENSEMBLE_SUBPERIOD_CLASS_SUPPORT_TOO_SMALL');
    if (!Number.isFinite(Number(comparison.improvement.relativeBrierImprovementPct)) || comparison.improvement.relativeBrierImprovementPct < 0) {
      blockers.push('ENSEMBLE_SUBPERIOD_BRIER_NOT_BETTER_THAN_PATTERN');
    }
    if (!Number.isFinite(Number(comparison.improvement.logLossImprovement)) || comparison.improvement.logLossImprovement < 0) {
      blockers.push('ENSEMBLE_SUBPERIOD_LOGLOSS_NOT_BETTER_THAN_PATTERN');
    }
    return {
      index,
      sampleSize: block.length,
      positiveCount,
      negativeCount,
      firstForecastDate: forecastDateKey(block[0] || {}),
      lastForecastDate: forecastDateKey(block.at(-1) || {}),
      relativeBrierImprovementPct: comparison.improvement.relativeBrierImprovementPct,
      logLossImprovement: comparison.improvement.logLossImprovement,
      status: blockers.length ? 'UNSTABLE' : 'STABLE',
      blockers,
    };
  });
  const stableAcrossSubperiods = blocks.length === blockCount && blocks.every((block) => block.status === 'STABLE');
  return {
    status: stableAcrossSubperiods ? 'STABILITY_READY' : 'UNSTABLE',
    stableAcrossSubperiods,
    thresholds: { blockCount, minimumBlockSample, minimumBlockClassCount },
    subperiods: blocks,
    blockers: stableAcrossSubperiods ? [] : ['ENSEMBLE_IMPROVEMENT_NOT_STABLE_ACROSS_SUBPERIODS'],
  };
}

function evaluateGroup(records, options = {}) {
  const lineage = records.filter(isLineageRecord);
  const maturedEligible = lineage.filter(eligibleMaturedRecord);
  const invalidMaturedRecordCount = lineage.filter((record) => record?.status === 'MATURED' && !eligibleMaturedRecord(record)).length;
  const prequential = buildPrequentialStackPredictions(maturedEligible, options);
  const predictions = prequential.predictions;
  const positiveCount = predictions.filter((record) => record.positiveOutcome === 1).length;
  const negativeCount = predictions.length - positiveCount;
  const comparison = comparisonMetrics(predictions);

  const minimumPrequentialPredictions = Math.max(100, Number(options.ensembleMinimumPrequentialPredictions ?? 200));
  const minimumPredictionClassCount = Math.max(20, Number(options.ensembleMinimumPredictionClassCount ?? 40));
  const minimumRelativeBrierImprovementPct = Number(options.ensembleMinimumRelativeBrierImprovementPct ?? 3);
  const minimumLogLossImprovement = Number(options.ensembleMinimumLogLossImprovement ?? 0);
  const minimumEceImprovement = Number(options.ensembleMinimumEceImprovement ?? -0.01);

  const sampleIndependence = evaluateOosSampleIndependence(predictions, {
    minimumDistinctForecastDates: options.ensembleMinimumDistinctForecastDates ?? 40,
    minimumDistinctInstruments: options.ensembleMinimumDistinctInstruments ?? 10,
    maximumSingleForecastDateSharePct: options.ensembleMaximumSingleForecastDateSharePct ?? 10,
  });
  const outcomeWindowIndependence = evaluateOosOutcomeWindowIndependence(predictions, {
    minimumEffectiveNonOverlappingWindows: options.ensembleMinimumEffectiveNonOverlappingOutcomeWindows ?? 12,
  });
  const instrumentConcentration = evaluateOosInstrumentConcentration(predictions, {
    maximumSingleInstrumentSharePct: options.ensembleMaximumSingleInstrumentSharePct ?? 25,
    minimumEffectiveInstrumentCount: options.ensembleMinimumEffectiveInstrumentCount ?? 6,
  });
  const taxonomyConcentration = evaluateOosTaxonomyConcentration(predictions, {
    minimumClassificationCoveragePct: options.ensembleMinimumClassificationCoveragePct ?? 80,
    materialTaxonomyMinimumSharePct: options.ensembleMaterialTaxonomyMinimumSharePct ?? 15,
    materialTaxonomyMinimumRecordCount: options.ensembleMaterialTaxonomyMinimumRecordCount ?? 30,
    maximumSingleNativeClusterSharePct: options.ensembleMaximumSingleNativeClusterSharePct ?? 40,
    minimumEffectiveNativeClusterCount: options.ensembleMinimumEffectiveNativeClusterCount ?? 3,
  });
  const stability = temporalStability(predictions, options);

  const blockers = [
    ...sampleIndependence.blockers,
    ...outcomeWindowIndependence.blockers,
    ...instrumentConcentration.blockers,
    ...taxonomyConcentration.blockers,
    ...stability.blockers,
  ];
  if (predictions.length < minimumPrequentialPredictions) blockers.push('ENSEMBLE_PREQUENTIAL_SAMPLE_TOO_SMALL');
  if (positiveCount < minimumPredictionClassCount) blockers.push('ENSEMBLE_POSITIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (negativeCount < minimumPredictionClassCount) blockers.push('ENSEMBLE_NEGATIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (invalidMaturedRecordCount > 0) blockers.push('ENSEMBLE_INVALID_MATURED_INPUT_RECORDS_EXCLUDED');
  if (!Number.isFinite(Number(comparison.improvement.relativeBrierImprovementPct)) || comparison.improvement.relativeBrierImprovementPct < minimumRelativeBrierImprovementPct) {
    blockers.push('ENSEMBLE_BRIER_IMPROVEMENT_TOO_SMALL');
  }
  if (!Number.isFinite(Number(comparison.improvement.logLossImprovement)) || comparison.improvement.logLossImprovement < minimumLogLossImprovement) {
    blockers.push('ENSEMBLE_LOGLOSS_NOT_BETTER_THAN_PATTERN');
  }
  if (!Number.isFinite(Number(comparison.improvement.expectedCalibrationErrorImprovement)) || comparison.improvement.expectedCalibrationErrorImprovement < minimumEceImprovement) {
    blockers.push('ENSEMBLE_CALIBRATION_ERROR_MATERIALLY_WORSE');
  }

  const uniqueBlockers = [...new Set(blockers)];
  const enoughPredictions = predictions.length >= minimumPrequentialPredictions && positiveCount >= minimumPredictionClassCount && negativeCount >= minimumPredictionClassCount;
  const ready = uniqueBlockers.length === 0;

  return {
    historicalPatternPolicyVersion: lineage[0]?.historicalPatternPolicyVersion || null,
    factorScorePolicyVersion: lineage[0]?.factorScorePolicyVersion || null,
    assetClass: lineage[0]?.assetClass || 'UNKNOWN',
    horizon: lineage[0]?.horizon || 'UNKNOWN',
    status: ready ? 'ENSEMBLE_RESEARCH_READY' : enoughPredictions ? 'ENSEMBLE_SKILL_NOT_READY' : 'INSUFFICIENT_PREQUENTIAL_HISTORY',
    lineageRecordCount: lineage.length,
    maturedEligibleRecordCount: maturedEligible.length,
    invalidMaturedRecordCount,
    prequentialPredictionCount: predictions.length,
    positiveCount,
    negativeCount,
    skippedInsufficientTrainingCount: prequential.skippedInsufficientTrainingCount,
    modelFitCount: prequential.modelFitCount,
    latestModel: prequential.latestModel,
    baselinePatternMetrics: comparison.baselinePattern,
    ensembleMetrics: comparison.stackedEnsemble,
    improvement: comparison.improvement,
    sampleIndependence,
    outcomeWindowIndependence,
    instrumentConcentration,
    taxonomyConcentration,
    temporalStability: stability,
    thresholds: {
      minimumTrainingSample: prequential.minimumTrainingSample,
      minimumTrainingClassCount: prequential.minimumTrainingClassCount,
      minimumPrequentialPredictions,
      minimumPredictionClassCount,
      minimumRelativeBrierImprovementPct,
      minimumLogLossImprovement,
      minimumEceImprovement,
    },
    blockers: uniqueBlockers,
    researchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
  };
}

export function buildForecastStackedEnsembleResearchStatus(input = {}) {
  const records = Array.isArray(input.records) ? input.records : Array.isArray(input.archive?.records) ? input.archive.records : [];
  const lineage = records.filter(isLineageRecord);
  const groups = new Map();
  for (const record of lineage) {
    const key = groupKey(record);
    const items = groups.get(key) || [];
    items.push(record);
    groups.set(key, items);
  }
  const evaluated = [...groups.values()]
    .map((items) => evaluateGroup(items, input.options || {}))
    .sort((left, right) => [left.historicalPatternPolicyVersion, left.factorScorePolicyVersion, left.assetClass, left.horizon].join('|').localeCompare([right.historicalPatternPolicyVersion, right.factorScorePolicyVersion, right.assetClass, right.horizon].join('|')));
  const readyGroupCount = evaluated.filter((group) => group.status === 'ENSEMBLE_RESEARCH_READY').length;
  const maturedEligibleRecordCount = evaluated.reduce((sum, group) => sum + group.maturedEligibleRecordCount, 0);
  const prequentialPredictionCount = evaluated.reduce((sum, group) => sum + group.prequentialPredictionCount, 0);
  return {
    format: 'investor-control-forecast-stacked-ensemble-research',
    version: 1,
    policyVersion: FORECAST_STACKED_ENSEMBLE_RESEARCH_VERSION,
    contract: FORECAST_STACKED_ENSEMBLE_CONTRACT,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    source: 'LIVE_SHADOW_OOS_PREQUENTIAL_PATTERN_PLUS_FACTOR_RESEARCH_ONLY',
    status: readyGroupCount ? 'RESEARCH_ONLY_READY_GROUPS_EXIST' : 'RESEARCH_ONLY',
    lineageRecordCount: lineage.length,
    maturedEligibleRecordCount,
    prequentialPredictionCount,
    groupCount: evaluated.length,
    readyGroupCount,
    groups: evaluated,
    methodology: {
      trainingRule: 'FOR_EACH_FORECAST_DATE_TRAIN_ONLY_ON_OUTCOMES_REALIZED_STRICTLY_BEFORE_THAT_FORECAST_TIME',
      features: ['PATTERN_LOGIT', 'LATENT_FACTOR_SCORE'],
      model: 'DETERMINISTIC_L2_LOGISTIC_STACK',
      comparator: 'EXACT_SAME_PREQUENTIAL_TARGET_SAMPLE_RAW_PATTERN_PROBABILITY',
      regimeInteraction: 'NOT_USED_IN_V1',
      probabilityUse: 'HISTORICAL_PREQUENTIAL_RESEARCH_EVALUATION_ONLY',
    },
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    decisionImpact: 'NONE',
  };
}
