import {
  FORECAST_STACKED_ENSEMBLE_CONTRACT,
  FORECAST_STACKED_ENSEMBLE_RESEARCH_VERSION,
} from './forecast-stacked-ensemble-research.js';

export const FORECAST_STACKED_ENSEMBLE_OBSERVABILITY_CONTRACT = 'STACKED_ENSEMBLE_RESEARCH_OBSERVABILITY_V1';

function assert(condition, message) {
  if (!condition) throw new Error(`Stacked ensemble production safety: ${message}`);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function authoritySafe(value = {}) {
  return value?.automaticModelPromotionEnabled === false &&
    value?.probabilityCalibrationEnabled === false &&
    value?.decisionIntegrationEnabled === false &&
    value?.forecastMayInfluenceFinalAction === false &&
    value?.finalActionEligible === false;
}

export function buildForecastStackedEnsembleOperationalTelemetry(status = {}) {
  return {
    forecastStackedEnsembleObservabilityContract: FORECAST_STACKED_ENSEMBLE_OBSERVABILITY_CONTRACT,
    forecastStackedEnsemblePolicyVersion: status?.policyVersion || null,
    forecastStackedEnsembleStatus: status?.status || 'UNAVAILABLE',
    forecastStackedEnsembleLineageRecordCount: Number(status?.lineageRecordCount || 0),
    forecastStackedEnsembleMaturedEligibleRecordCount: Number(status?.maturedEligibleRecordCount || 0),
    forecastStackedEnsemblePrequentialPredictionCount: Number(status?.prequentialPredictionCount || 0),
    forecastStackedEnsembleGroupCount: Number(status?.groupCount || 0),
    forecastStackedEnsembleReadyGroupCount: Number(status?.readyGroupCount || 0),
    forecastStackedEnsembleAutomaticModelPromotionEnabled: false,
    forecastStackedEnsembleProbabilityCalibrationEnabled: false,
    forecastStackedEnsembleDecisionIntegrationEnabled: false,
    forecastStackedEnsembleMayInfluenceFinalAction: false,
  };
}

function verifyReadyGroup(group, index) {
  const prefix = `ready group ${index}`;
  assert(group?.status === 'ENSEMBLE_RESEARCH_READY', `${prefix} status mismatch`);
  assert(Array.isArray(group?.blockers) && group.blockers.length === 0, `${prefix} has blockers`);
  assert(authoritySafe(group), `${prefix} has forbidden authority`);

  const thresholds = group?.thresholds || {};
  assert(finiteNumber(thresholds.minimumTrainingSample) >= 60, `${prefix} training sample threshold too weak`);
  assert(finiteNumber(thresholds.minimumTrainingClassCount) >= 15, `${prefix} training class threshold too weak`);
  assert(finiteNumber(thresholds.minimumPrequentialPredictions) >= 200, `${prefix} prediction threshold too weak`);
  assert(finiteNumber(thresholds.minimumPredictionClassCount) >= 40, `${prefix} prediction class threshold too weak`);
  assert(finiteNumber(thresholds.minimumRelativeBrierImprovementPct) >= 3, `${prefix} Brier improvement threshold too weak`);
  assert(finiteNumber(thresholds.minimumLogLossImprovement) >= 0, `${prefix} log-loss threshold too weak`);
  assert(finiteNumber(thresholds.minimumEceImprovement) >= -0.01, `${prefix} calibration-error threshold too weak`);

  assert(nonNegativeInteger(group.prequentialPredictionCount) >= thresholds.minimumPrequentialPredictions, `${prefix} prediction sample too small`);
  assert(nonNegativeInteger(group.positiveCount) >= thresholds.minimumPredictionClassCount, `${prefix} positive class too small`);
  assert(nonNegativeInteger(group.negativeCount) >= thresholds.minimumPredictionClassCount, `${prefix} negative class too small`);
  assert(nonNegativeInteger(group.invalidMaturedRecordCount) === 0, `${prefix} includes invalid matured inputs`);

  const improvement = group?.improvement || {};
  assert(finiteNumber(improvement.relativeBrierImprovementPct) >= thresholds.minimumRelativeBrierImprovementPct, `${prefix} Brier improvement below threshold`);
  assert(finiteNumber(improvement.logLossImprovement) >= thresholds.minimumLogLossImprovement, `${prefix} log-loss improvement below threshold`);
  assert(finiteNumber(improvement.expectedCalibrationErrorImprovement) >= thresholds.minimumEceImprovement, `${prefix} calibration-error improvement below threshold`);

  const sample = group?.sampleIndependence;
  assert(sample?.contract === 'OOS_SAMPLE_INDEPENDENCE_V1' && sample?.status === 'INDEPENDENCE_READY', `${prefix} sample independence not ready`);
  assert(finiteNumber(sample?.thresholds?.minimumDistinctForecastDates) >= 40, `${prefix} date threshold too weak`);
  assert(finiteNumber(sample?.thresholds?.minimumDistinctInstruments) >= 10, `${prefix} instrument threshold too weak`);
  assert(finiteNumber(sample?.thresholds?.maximumSingleForecastDateSharePct) <= 10, `${prefix} date concentration threshold too weak`);
  assert(nonNegativeInteger(sample?.missingForecastDateCount) === 0 && nonNegativeInteger(sample?.missingInstrumentIdentityCount) === 0, `${prefix} missing sample identity`);

  const windows = group?.outcomeWindowIndependence;
  assert(windows?.contract === 'OOS_OUTCOME_WINDOW_INDEPENDENCE_V1' && windows?.status === 'WINDOW_INDEPENDENCE_READY', `${prefix} outcome-window independence not ready`);
  assert(finiteNumber(windows?.thresholds?.minimumEffectiveNonOverlappingWindows) >= 12, `${prefix} outcome-window threshold too weak`);
  assert(nonNegativeInteger(windows?.invalidWindowRecordCount) === 0, `${prefix} has invalid outcome windows`);

  const instruments = group?.instrumentConcentration;
  assert(instruments?.contract === 'OOS_INSTRUMENT_CONCENTRATION_V1' && instruments?.status === 'INSTRUMENT_DIVERSIFICATION_READY', `${prefix} instrument concentration not ready`);
  assert(finiteNumber(instruments?.thresholds?.maximumSingleInstrumentSharePct) <= 25, `${prefix} single-instrument threshold too weak`);
  assert(finiteNumber(instruments?.thresholds?.minimumEffectiveInstrumentCount) >= 6, `${prefix} effective-instrument threshold too weak`);
  assert(nonNegativeInteger(instruments?.missingInstrumentIdentityCount) === 0, `${prefix} missing instrument identity`);

  const taxonomy = group?.taxonomyConcentration;
  assert(taxonomy?.contract === 'OOS_TAXONOMY_NATIVE_CONCENTRATION_V1' && taxonomy?.status === 'TAXONOMY_DIVERSIFICATION_READY', `${prefix} taxonomy concentration not ready`);
  assert(taxonomy?.crossTaxonomyMappingUsed === false && taxonomy?.inferenceUsed === false && taxonomy?.decisionImpact === 'NONE', `${prefix} taxonomy mapping/inference forbidden`);
  assert(finiteNumber(taxonomy?.thresholds?.minimumClassificationCoveragePct) >= 80, `${prefix} classification coverage threshold too weak`);
  assert(finiteNumber(taxonomy?.thresholds?.materialTaxonomyMinimumSharePct) >= 15, `${prefix} material taxonomy share threshold too weak`);
  assert(finiteNumber(taxonomy?.thresholds?.materialTaxonomyMinimumRecordCount) >= 30, `${prefix} material taxonomy sample threshold too weak`);
  assert(finiteNumber(taxonomy?.thresholds?.maximumSingleNativeClusterSharePct) <= 40, `${prefix} native-cluster concentration threshold too weak`);
  assert(finiteNumber(taxonomy?.thresholds?.minimumEffectiveNativeClusterCount) >= 3, `${prefix} native-cluster effective-count threshold too weak`);

  const stability = group?.temporalStability;
  assert(stability?.status === 'STABILITY_READY' && stability?.stableAcrossSubperiods === true, `${prefix} temporal stability not ready`);
  assert(finiteNumber(stability?.thresholds?.blockCount) >= 3, `${prefix} stability block threshold too weak`);
  assert(finiteNumber(stability?.thresholds?.minimumBlockSample) >= 40, `${prefix} stability sample threshold too weak`);
  assert(finiteNumber(stability?.thresholds?.minimumBlockClassCount) >= 8, `${prefix} stability class threshold too weak`);
  assert(Array.isArray(stability?.subperiods) && stability.subperiods.length >= 3 && stability.subperiods.every((block) => block?.status === 'STABLE'), `${prefix} contains unstable subperiod`);
}

export function verifyForecastStackedEnsembleProductionSafety(report = {}) {
  const status = report?.forecastStackedEnsembleResearchStatus;
  assert(status && typeof status === 'object', 'research status missing');
  assert(status.format === 'investor-control-forecast-stacked-ensemble-research', 'research format invalid');
  assert(status.version === 1, 'research version invalid');
  assert(status.policyVersion === FORECAST_STACKED_ENSEMBLE_RESEARCH_VERSION, 'research policy version invalid');
  assert(status.contract === FORECAST_STACKED_ENSEMBLE_CONTRACT, 'research contract invalid');
  assert(status.decisionImpact === 'NONE', 'research decision impact must remain NONE');
  assert(authoritySafe(status), 'research status has forbidden authority');
  assert(status?.methodology?.trainingRule === 'FOR_EACH_FORECAST_DATE_TRAIN_ONLY_ON_OUTCOMES_REALIZED_STRICTLY_BEFORE_THAT_FORECAST_TIME', 'anti-leak training rule missing');
  assert(status?.methodology?.regimeInteraction === 'NOT_USED_IN_V1', 'v1 ensemble must not silently use regime interaction');

  const groups = Array.isArray(status.groups) ? status.groups : [];
  assert(nonNegativeInteger(status.groupCount) === groups.length, 'group count mismatch');
  const readyGroups = groups.filter((group) => group?.status === 'ENSEMBLE_RESEARCH_READY');
  assert(nonNegativeInteger(status.readyGroupCount) === readyGroups.length, 'ready group count mismatch');
  for (const group of groups) assert(authoritySafe(group), 'group has forbidden authority');
  readyGroups.forEach(verifyReadyGroup);

  const expectedTelemetry = buildForecastStackedEnsembleOperationalTelemetry(status);
  const health = report?.operationalHealth || {};
  for (const [key, value] of Object.entries(expectedTelemetry)) {
    assert(health[key] === value, `telemetry mismatch for ${key}`);
  }
  const serializedHealth = JSON.stringify(health);
  assert(!serializedHealth.includes('latestModel') && !serializedHealth.includes('coefficients') && !serializedHealth.includes('baselinePatternMetrics'), 'raw ensemble research payload leaked into operational health');

  return {
    status: 'VERIFIED',
    contract: FORECAST_STACKED_ENSEMBLE_OBSERVABILITY_CONTRACT,
    telemetry: expectedTelemetry,
  };
}
