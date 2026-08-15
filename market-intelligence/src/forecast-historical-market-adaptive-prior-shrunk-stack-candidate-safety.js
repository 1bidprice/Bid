import {
  HISTORICAL_MARKET_ADAPTIVE_PRIOR_SHRUNK_STACK_RESEARCH_CONTRACT,
  HISTORICAL_MARKET_STACK_RESEARCH_VERSION,
} from './forecast-historical-market-stacked-ensemble-research.js';

export const HISTORICAL_MARKET_ADAPTIVE_PRIOR_SHRUNK_STACK_CANDIDATE_SAFETY_CONTRACT = 'HISTORICAL_MARKET_ADAPTIVE_PRIOR_SHRUNK_STACK_CANDIDATE_SAFETY_V1';

const ADAPTIVE_SELECTION_RULE = 'SUPPORT_FLOOR_SELECTED_BY_MINIMUM_BRIER_ON_SAME_LINEAGE_PRIOR_OOS_PREDICTIONS_WITH_OUTCOMES_REALIZED_STRICTLY_BEFORE_TARGET_FORECAST_TIME_TIES_PREFER_STRONGER_SHRINKAGE';
const ADAPTIVE_FEATURES = [
  'PATTERN_LOGIT',
  'HISTORICAL_MARKET_FACTOR_SCORE',
  'TRAINING_ONLY_BASE_RATE_SHRINKAGE',
  'PREQUENTIAL_BRIER_SELECTED_SUPPORT_FLOOR',
];

function assert(condition, message) {
  if (!condition) throw new Error(`Historical market adaptive prior-shrunk stack candidate safety: ${message}`);
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integer(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function authoritySafe(value = {}) {
  return value?.taxonomyPromotionEligible === false &&
    value?.historicalResearchOnly === true &&
    value?.automaticModelPromotionEnabled === false &&
    value?.probabilityCalibrationEnabled === false &&
    value?.decisionIntegrationEnabled === false &&
    value?.forecastMayInfluenceFinalAction === false &&
    value?.finalActionEligible === false &&
    value?.brokerExecutionEligible === false &&
    value?.decisionImpact === 'NONE';
}

function verifyThresholds(group, index) {
  const t = group?.thresholds || {};
  assert(number(t.minimumEvaluationSample) >= 200, `group ${index} evaluation sample threshold too weak`);
  assert(number(t.minimumClassCount) >= 40, `group ${index} class threshold too weak`);
  assert(number(t.minimumSkillPct) >= 5, `group ${index} skill threshold too weak`);
  assert(number(t.maximumEce) <= 0.08, `group ${index} ECE threshold too weak`);
  assert(number(t.minimumBrierImprovementPct) >= 3, `group ${index} Brier threshold too weak`);
  assert(number(t.minimumLogLossImprovementPct) >= 0, `group ${index} log-loss threshold too weak`);
  assert(number(t.minimumEceImprovement) >= -0.01, `group ${index} ECE regression threshold too weak`);
  assert(number(t.minimumDistinctForecastDates) >= 40, `group ${index} date threshold too weak`);
  assert(number(t.minimumDistinctInstruments) >= 10, `group ${index} instrument threshold too weak`);
  assert(number(t.maximumSingleForecastDateSharePct) <= 10, `group ${index} date concentration threshold too weak`);
  assert(number(t.minimumEffectiveNonOverlappingWindows) >= 12, `group ${index} outcome-window threshold too weak`);
  assert(number(t.maximumSingleInstrumentSharePct) <= 25, `group ${index} instrument concentration threshold too weak`);
  assert(number(t.minimumEffectiveInstrumentCount) >= 6, `group ${index} effective instrument threshold too weak`);
  assert(number(t.chronologicalBlockCount) >= 3, `group ${index} chronological block threshold too weak`);
  assert(number(t.minimumChronologicalBlockSample) >= 20, `group ${index} chronological sample threshold too weak`);
}

function verifyReadyGroup(group, index) {
  const t = group.thresholds;
  assert(integer(group.sampleSize) !== null && group.sampleSize >= t.minimumEvaluationSample, `group ${index} sample too small`);
  assert(integer(group.positiveCount) !== null && group.positiveCount >= t.minimumClassCount, `group ${index} positive class too small`);
  assert(integer(group.negativeCount) !== null && group.negativeCount >= t.minimumClassCount, `group ${index} negative class too small`);
  assert(number(group?.ensembleMetrics?.skillVsBaseRatePct) >= 5, `group ${index} skill not ready`);
  assert(number(group?.ensembleMetrics?.expectedCalibrationError) <= 0.08, `group ${index} ECE not ready`);
  assert(number(group.brierImprovementVsRawPatternPct) >= 3, `group ${index} Brier improvement not ready`);
  assert(number(group.logLossImprovementVsRawPatternPct) >= 0, `group ${index} log-loss regression`);
  assert(number(group.eceImprovementVsRawPattern) >= -0.01, `group ${index} ECE regression`);
  assert(group?.sampleIndependence?.status === 'INDEPENDENCE_READY', `group ${index} sample independence not ready`);
  assert(group?.outcomeWindowIndependence?.status === 'WINDOW_INDEPENDENCE_READY', `group ${index} outcome-window independence not ready`);
  assert(group?.instrumentConcentration?.status === 'INSTRUMENT_DIVERSIFICATION_READY', `group ${index} instrument diversification not ready`);
  assert(group?.chronologicalStability?.status === 'CHRONOLOGICAL_STABILITY_READY', `group ${index} chronology not ready`);
  assert(Array.isArray(group?.chronologicalStability?.blocks) && group.chronologicalStability.blocks.length >= 3 && group.chronologicalStability.blocks.every((block) => block?.ready === true), `group ${index} chronological block not ready`);
  assert(Array.isArray(group.blockers) && group.blockers.length === 0, `group ${index} ready status has blockers`);
}

function verifyAdaptiveSupport(candidate) {
  assert(integer(candidate.adaptiveSelectionMinimumSample) !== null && candidate.adaptiveSelectionMinimumSample >= 20, 'adaptive selection minimum sample invalid');
  assert(integer(candidate.adaptiveSelectionMinimumClassCount) !== null && candidate.adaptiveSelectionMinimumClassCount >= 5, 'adaptive selection minimum class count invalid');

  const expectedGrid = [1, 2, 4, 8].map((multiplier) => candidate.adaptiveSelectionMinimumSample * multiplier);
  assert(JSON.stringify(candidate.adaptiveSupportFloorGrid) === JSON.stringify(expectedGrid), 'adaptive support-floor grid invalid');
  assert(JSON.stringify(candidate?.methodology?.adaptiveSupportFloorGrid) === JSON.stringify(expectedGrid), 'methodology adaptive support-floor grid invalid');
  assert(candidate?.methodology?.adaptiveSelectionMinimumSample === candidate.adaptiveSelectionMinimumSample, 'adaptive minimum sample mismatch');
  assert(candidate?.methodology?.adaptiveSelectionMinimumClassCount === candidate.adaptiveSelectionMinimumClassCount, 'adaptive minimum class count mismatch');
  assert(candidate?.methodology?.adaptiveSelectionRule === ADAPTIVE_SELECTION_RULE, 'adaptive anti-leak selection rule invalid');
  assert(candidate?.methodology?.adaptiveSelectionObjective === 'BRIER_SCORE', 'adaptive selection objective invalid');
  assert(candidate?.methodology?.adaptiveTieBreak === 'PREFER_STRONGER_SHRINKAGE', 'adaptive tie-break invalid');

  assert(integer(candidate.adaptiveSelectionReadyPredictionCount) !== null, 'adaptive ready prediction count invalid');
  assert(integer(candidate.adaptiveSelectionWarmupPredictionCount) !== null, 'adaptive warmup prediction count invalid');
  assert(candidate.adaptiveSelectionReadyPredictionCount + candidate.adaptiveSelectionWarmupPredictionCount === candidate.predictionCount, 'adaptive selection readiness counts mismatch');
  assert(Array.isArray(candidate.adaptiveSupportFloorSelectionCounts), 'adaptive support-floor selection counts invalid');

  const grid = new Set(expectedGrid);
  const seen = new Set();
  let totalSelections = 0;
  for (const item of candidate.adaptiveSupportFloorSelectionCounts) {
    assert(grid.has(item?.supportFloor), 'adaptive support-floor selection outside fixed grid');
    assert(!seen.has(item.supportFloor), 'adaptive support-floor selection duplicated');
    assert(integer(item?.predictionCount) !== null, 'adaptive support-floor prediction count invalid');
    seen.add(item.supportFloor);
    totalSelections += item.predictionCount;
  }
  assert(totalSelections === candidate.predictionCount, 'adaptive support-floor selection counts mismatch');
}

export function verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(candidate = {}, options = {}) {
  assert(candidate && typeof candidate === 'object', 'candidate missing');
  assert(candidate.format === 'investor-control-historical-market-adaptive-prior-shrunk-stacked-ensemble-research', 'format invalid');
  assert(candidate.version === 1, 'version invalid');
  assert(candidate.policyVersion === HISTORICAL_MARKET_STACK_RESEARCH_VERSION, 'policy version invalid');
  assert(candidate.contract === HISTORICAL_MARKET_ADAPTIVE_PRIOR_SHRUNK_STACK_RESEARCH_CONTRACT, 'contract invalid');
  assert(candidate.modelVariant === 'ADAPTIVE_PRIOR_SHRUNK_SCALAR_MARKET_FACTOR', 'model variant invalid');
  assert(authoritySafe(candidate), 'candidate has forbidden authority');
  assert(candidate.rawPredictionsIncluded === false, 'raw predictions forbidden');
  assert(candidate.rawHistoricalRecordsIncluded === false, 'raw records forbidden');
  assert(candidate.rawHistoricalCandlesIncluded === false, 'raw candles forbidden');
  assert(candidate?.methodology?.model === 'PREQUENTIAL_L2_LOGISTIC_STACK_WITH_ADAPTIVE_TRAINING_ONLY_PRIOR_SHRINKAGE', 'model invalid');
  assert(JSON.stringify(candidate?.methodology?.features) === JSON.stringify(ADAPTIVE_FEATURES), 'features invalid');
  assert(candidate?.methodology?.representation === 'SCALAR_MARKET_FACTOR_SHRUNK_TOWARD_BETA_1_1_TRAINING_BASE_RATE_WITH_SUPPORT_FLOOR_SELECTED_FROM_PRIOR_REALIZED_OOS_BRIER_ONLY', 'representation invalid');
  assert(typeof candidate?.methodology?.trainingRule === 'string' && candidate.methodology.trainingRule.includes('STRICTLY_BEFORE_TARGET_FORECAST_TIME'), 'anti-leak training rule invalid');
  assert(typeof candidate?.methodology?.priorShrinkageRule === 'string' && candidate.methodology.priorShrinkageRule.includes('TRAINING_OUTCOMES_REALIZED_STRICTLY_BEFORE_TARGET_FORECAST_TIME'), 'prior shrinkage anti-leak rule invalid');
  assert(candidate?.methodology?.taxonomyHistoricalBackfillAllowed === false, 'taxonomy backfill forbidden');
  assert(candidate?.methodology?.rawPredictionExportAllowed === false, 'raw prediction export forbidden');

  const expectedSourceRecordCount = integer(options.sourceRecordCount);
  if (expectedSourceRecordCount !== null) assert(integer(candidate.sourceRecordCount) === expectedSourceRecordCount, 'source record count mismatch');
  for (const key of ['sourceRecordCount', 'eligibleRecordCount', 'rejectedRecordCount', 'predictionCount', 'skippedInsufficientTrainingCount', 'modelFitCount', 'groupCount', 'predictiveReadyGroupCount', 'predictiveNotReadyGroupCount']) {
    assert(integer(candidate[key]) !== null, `${key} invalid`);
  }
  assert(candidate.eligibleRecordCount + candidate.rejectedRecordCount === candidate.sourceRecordCount, 'eligibility counts mismatch');
  assert(candidate.predictionCount <= candidate.eligibleRecordCount, 'prediction count exceeds eligible records');
  assert(Array.isArray(candidate.groups) && candidate.groups.length === candidate.groupCount, 'group count mismatch');
  assert(candidate.predictiveReadyGroupCount + candidate.predictiveNotReadyGroupCount === candidate.groupCount, 'readiness counts mismatch');
  assert(candidate.predictiveReadyGroupCount === candidate.groups.filter((group) => group?.status === 'HISTORICAL_MARKET_STACK_PREDICTIVE_READY').length, 'ready group count mismatch');
  verifyAdaptiveSupport(candidate);

  const serialized = JSON.stringify(candidate);
  assert(!serialized.includes('"predictions"'), 'raw predictions leaked');
  assert(!serialized.includes('"candles"'), 'raw candles leaked');
  assert(!serialized.includes('"historicalRecords"'), 'raw historical records leaked');
  assert(!serialized.includes('LIVE_SHADOW_OOS'), 'live shadow lineage forbidden');

  candidate.groups.forEach((group, index) => {
    assert(group?.modelVariant === 'ADAPTIVE_PRIOR_SHRUNK_SCALAR_MARKET_FACTOR', `group ${index} model variant invalid`);
    assert(group?.taxonomyHistoricalBackfillAllowed === false, `group ${index} taxonomy backfill forbidden`);
    assert(authoritySafe(group), `group ${index} has forbidden authority`);
    verifyThresholds(group, index);
    if (group.status === 'HISTORICAL_MARKET_STACK_PREDICTIVE_READY') verifyReadyGroup(group, index);
  });

  return {
    status: 'VERIFIED',
    contract: HISTORICAL_MARKET_ADAPTIVE_PRIOR_SHRUNK_STACK_CANDIDATE_SAFETY_CONTRACT,
    sourceRecordCount: candidate.sourceRecordCount,
    predictionCount: candidate.predictionCount,
    groupCount: candidate.groupCount,
    predictiveReadyGroupCount: candidate.predictiveReadyGroupCount,
    adaptiveSupportFloorGrid: [...candidate.adaptiveSupportFloorGrid],
    adaptiveSupportFloorSelectionCounts: candidate.adaptiveSupportFloorSelectionCounts.map((item) => ({ ...item })),
    adaptiveSelectionReadyPredictionCount: candidate.adaptiveSelectionReadyPredictionCount,
    adaptiveSelectionWarmupPredictionCount: candidate.adaptiveSelectionWarmupPredictionCount,
  };
}
