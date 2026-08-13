import {
  FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_CONTRACT,
  FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_EVIDENCE_CLASS,
  FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_VERSION,
} from './forecast-cross-sectional-regime-walk-forward.js';
import {
  FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RUNTIME_CONTRACT,
  FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RUNTIME_VERSION,
  FORECAST_HISTORICAL_UNIVERSE_COVERAGE_CONTRACT,
} from './forecast-cross-sectional-regime-walk-forward-runtime.js';

export const FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_OBSERVABILITY_CONTRACT = 'HISTORICAL_REGIME_WALK_FORWARD_RUNTIME_OBSERVABILITY_V1';

function assert(condition, message) {
  if (!condition) throw new Error(`Historical regime walk-forward production safety: ${message}`);
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function authoritySafe(value = {}) {
  return value?.liveArchiveEligible === false &&
    value?.liveCalibrationEligible === false &&
    value?.factorWeightGovernanceEligible === false &&
    value?.automaticModelPromotionEnabled === false &&
    value?.probabilityCalibrationEnabled === false &&
    value?.decisionIntegrationEnabled === false &&
    value?.forecastMayInfluenceFinalAction === false &&
    value?.finalActionEligible === false &&
    value?.brokerExecutionEligible === false &&
    value?.decisionImpact === 'NONE';
}

export function buildCrossSectionalRegimeWalkForwardOperationalTelemetry(status = {}) {
  const coverage = status?.universeCoverage || null;
  return {
    forecastHistoricalWalkForwardObservabilityContract: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_OBSERVABILITY_CONTRACT,
    forecastHistoricalWalkForwardRuntimePolicyVersion: status?.runtimePolicyVersion || null,
    forecastHistoricalWalkForwardExecutionState: status?.executionState || 'UNAVAILABLE',
    forecastHistoricalWalkForwardStatus: status?.status || 'UNAVAILABLE',
    forecastHistoricalWalkForwardCadenceRequested: status?.cadenceRequested === true,
    forecastHistoricalWalkForwardEligibleInstrumentCount: Number(status?.eligibleInstrumentCount || 0),
    forecastHistoricalWalkForwardSelectedInstrumentCount: Number(status?.selectedInstrumentCount || 0),
    forecastHistoricalWalkForwardGeneratedRecordCount: Number(status?.generatedRecordCount || 0),
    forecastHistoricalWalkForwardValidRegimeRecordCount: Number(status?.validRegimeRecordCount || 0),
    forecastHistoricalWalkForwardGroupCount: Number(status?.groupCount || 0),
    forecastHistoricalWalkForwardReadyGroupCount: Number(status?.readyGroupCount || 0),
    forecastHistoricalWalkForwardCoverageContract: coverage?.contract || null,
    forecastHistoricalWalkForwardDossierCount: Number(coverage?.dossierCount || 0),
    forecastHistoricalWalkForwardLoadedHistoryCount: Number(coverage?.loadedHistoricalSeriesCount || 0),
    forecastHistoricalWalkForwardExcludedDossierCount: Number(coverage?.excludedDossierCount || 0),
    forecastHistoricalWalkForwardLoadedHistoryWithoutDossierCount: Number(coverage?.loadedHistoryWithoutDossierCount || 0),
    forecastHistoricalWalkForwardLiveArchiveEligible: false,
    forecastHistoricalWalkForwardLiveCalibrationEligible: false,
    forecastHistoricalWalkForwardDecisionIntegrationEnabled: false,
    forecastHistoricalWalkForwardMayInfluenceFinalAction: false,
    forecastHistoricalWalkForwardBrokerExecutionEligible: false,
  };
}

function verifyCoverage(status) {
  const coverage = status.universeCoverage;
  assert(coverage && typeof coverage === 'object', 'historical universe coverage missing');
  assert(coverage.format === 'investor-control-historical-walk-forward-universe-coverage', 'historical universe coverage format invalid');
  assert(coverage.version === 1, 'historical universe coverage version invalid');
  assert(coverage.contract === FORECAST_HISTORICAL_UNIVERSE_COVERAGE_CONTRACT, 'historical universe coverage contract invalid');
  assert(nonNegativeInteger(coverage.dossierCount) !== null, 'historical universe dossier count invalid');
  assert(nonNegativeInteger(coverage.uniqueDossierCompanyCount) !== null, 'historical universe unique dossier count invalid');
  assert(nonNegativeInteger(coverage.loadedHistoricalSeriesCount) !== null, 'historical universe loaded history count invalid');
  assert(nonNegativeInteger(coverage.loadedBenchmarkSeriesCount) !== null, 'historical universe loaded benchmark count invalid');
  assert(nonNegativeInteger(coverage.eligibleInstrumentCount) === nonNegativeInteger(status.eligibleInstrumentCount), 'historical universe eligible count mismatch');
  assert(nonNegativeInteger(coverage.selectedInstrumentCount) === nonNegativeInteger(status.selectedInstrumentCount), 'historical universe selected count mismatch');
  assert(nonNegativeInteger(coverage.omittedByBoundCount) === nonNegativeInteger(status.omittedInstrumentCount), 'historical universe omitted count mismatch');
  assert(nonNegativeInteger(coverage.excludedDossierCount) !== null, 'historical universe exclusion count invalid');
  assert(nonNegativeInteger(coverage.loadedHistoryWithoutDossierCount) !== null, 'historical universe unmatched history count invalid');
  assert(nonNegativeInteger(coverage.eligibleWithBenchmarkCount) !== null, 'historical universe benchmark coverage count invalid');
  assert(nonNegativeInteger(coverage.eligibleWithoutBenchmarkCount) !== null, 'historical universe missing benchmark count invalid');
  assert(coverage.eligibleWithBenchmarkCount + coverage.eligibleWithoutBenchmarkCount === coverage.eligibleInstrumentCount, 'historical universe benchmark counts mismatch');
  assert(Array.isArray(coverage.selectedInstruments) && coverage.selectedInstruments.length === coverage.selectedInstrumentCount, 'historical universe selected diagnostics mismatch');
  assert(Array.isArray(coverage.omittedByBound) && coverage.omittedByBound.length <= 40, 'historical universe omitted diagnostics not bounded');
  assert(Array.isArray(coverage.excludedDossiers) && coverage.excludedDossiers.length <= 40, 'historical universe exclusion diagnostics not bounded');
  assert(Array.isArray(coverage.loadedHistoriesWithoutDossier) && coverage.loadedHistoriesWithoutDossier.length <= 40, 'historical universe unmatched-history diagnostics not bounded');
  assert(coverage.rawHistoricalCandlesIncluded === false, 'raw historical candles export forbidden');
  assert(coverage.selectionRulesChanged === false, 'coverage diagnostics must not change selection rules');
  assert(coverage.thresholdsChanged === false, 'coverage diagnostics must not change thresholds');
  assert(coverage.networkFetchPerformed === false, 'coverage diagnostics network fetch forbidden');
  assert(coverage.historicalResearchOnly === true, 'coverage diagnostics must remain historical research only');
  assert(coverage.decisionImpact === 'NONE', 'coverage diagnostics decision impact forbidden');
  assert(!JSON.stringify(coverage).includes('"candles"'), 'raw candle arrays leaked into universe coverage');
}

function verifyResearch(status) {
  const research = status.research;
  assert(research && typeof research === 'object', 'enabled runtime research payload missing');
  assert(research.format === 'investor-control-cross-sectional-regime-walk-forward-research', 'research format invalid');
  assert(research.version === 1, 'research version invalid');
  assert(research.policyVersion === FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_VERSION, 'research policy version invalid');
  assert(research.contract === FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_CONTRACT, 'research contract invalid');
  assert(research.evidenceClass === FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_EVIDENCE_CLASS, 'research evidence class invalid');
  assert(authoritySafe(research), 'research payload has forbidden authority');
  assert(research?.methodology?.validationMode === 'WALK_FORWARD_OOS', 'research validation mode invalid');
  assert(research?.methodology?.historicalClassificationBackfillAllowed === false, 'historical classification backfill must remain forbidden');
  assert(research?.methodology?.liveArchiveWriteAllowed === false, 'live archive write must remain forbidden');
  assert(research?.methodology?.liveCalibrationUseAllowed === false, 'live calibration use must remain forbidden');
  assert(research?.methodology?.rawHistoricalRecordExportDefault === 'DISABLED', 'raw historical export default must remain disabled');
  assert(Array.isArray(research.auditSampleRecords) && research.auditSampleRecords.length === 0, 'production runtime must not export historical audit samples');
  assert(!Object.prototype.hasOwnProperty.call(research, 'researchRecords'), 'raw historical research records leaked into runtime report');
  assert(nonNegativeInteger(research.generatedRecordCount) === nonNegativeInteger(status.generatedRecordCount), 'generated record count mismatch');
  assert(nonNegativeInteger(research.validRegimeRecordCount) === nonNegativeInteger(status.validRegimeRecordCount), 'valid regime record count mismatch');
  assert(nonNegativeInteger(research.groupCount) === nonNegativeInteger(status.groupCount), 'group count mismatch');
  assert(nonNegativeInteger(research.readyGroupCount) === nonNegativeInteger(status.readyGroupCount), 'ready group count mismatch');

  for (const [index, group] of (research.groups || []).entries()) {
    assert(group?.historicalResearchOnly === true, `group ${index} not marked historical research only`);
    assert(group?.liveArchiveEligible === false, `group ${index} live archive eligibility forbidden`);
    assert(group?.liveCalibrationEligible === false, `group ${index} live calibration eligibility forbidden`);
    assert(group?.decisionIntegrationEnabled === false, `group ${index} decision integration forbidden`);
    assert(group?.forecastMayInfluenceFinalAction === false, `group ${index} final-action influence forbidden`);
    assert(group?.finalActionEligible === false, `group ${index} final action eligibility forbidden`);
    assert(group?.decisionImpact === 'NONE', `group ${index} decision impact forbidden`);
    if (group.status === 'HISTORICAL_REGIME_RESEARCH_READY') {
      const sample = group.sampleIndependence || {};
      const windows = group.outcomeWindowIndependence || {};
      const instruments = group.instrumentConcentration || {};
      assert(sample.status === 'INDEPENDENCE_READY', `group ${index} sample independence not ready`);
      assert(finiteNumber(sample?.thresholds?.minimumDistinctForecastDates) >= 30, `group ${index} date threshold too weak`);
      assert(finiteNumber(sample?.thresholds?.minimumDistinctInstruments) >= 8, `group ${index} instrument threshold too weak`);
      assert(finiteNumber(sample?.thresholds?.maximumSingleForecastDateSharePct) <= 15, `group ${index} date concentration threshold too weak`);
      assert(windows.status === 'WINDOW_INDEPENDENCE_READY', `group ${index} outcome-window independence not ready`);
      assert(finiteNumber(windows?.thresholds?.minimumEffectiveNonOverlappingWindows) >= 12, `group ${index} outcome-window threshold too weak`);
      assert(instruments.status === 'INSTRUMENT_DIVERSIFICATION_READY', `group ${index} instrument diversification not ready`);
      assert(finiteNumber(instruments?.thresholds?.maximumSingleInstrumentSharePct) <= 25, `group ${index} single-instrument threshold too weak`);
      assert(finiteNumber(instruments?.thresholds?.minimumEffectiveInstrumentCount) >= 5, `group ${index} effective-instrument threshold too weak`);
      assert(group?.calibration?.status === 'OOS_METRICS_READY', `group ${index} calibration metrics not ready`);
      assert(Array.isArray(group.blockers) && group.blockers.length === 0, `group ${index} ready status contains blockers`);
    }
  }
}

export function verifyCrossSectionalRegimeWalkForwardProductionSafety(report = {}) {
  const status = report?.forecastCrossSectionalRegimeWalkForwardRuntimeStatus;
  assert(status && typeof status === 'object', 'runtime status missing');
  assert(status.format === 'investor-control-cross-sectional-regime-walk-forward-runtime-status', 'runtime format invalid');
  assert(status.version === 1, 'runtime version invalid');
  assert(status.runtimePolicyVersion === FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RUNTIME_VERSION, 'runtime policy version invalid');
  assert(status.runtimeContract === FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RUNTIME_CONTRACT, 'runtime contract invalid');
  assert(status.researchPolicyVersion === FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_VERSION, 'research policy version mismatch');
  assert(status.researchContract === FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_CONTRACT, 'research contract mismatch');
  assert(status.evidenceClass === FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_EVIDENCE_CLASS, 'evidence class mismatch');
  assert(authoritySafe(status), 'runtime status has forbidden authority');
  assert(status.rawHistoricalRecordExported === false, 'raw historical record export forbidden');
  assert(status.networkFetchPerformedByRuntime === false, 'runtime network fetch forbidden');

  if (status.executionState === 'DISABLED_BY_CADENCE') {
    assert(status.cadenceRequested === false, 'disabled runtime cadence flag invalid');
    assert(status.research === null, 'disabled runtime must not contain research payload');
    assert(status.universeCoverage === null, 'disabled runtime must not inspect universe coverage');
    for (const key of ['eligibleInstrumentCount', 'selectedInstrumentCount', 'omittedInstrumentCount', 'generatedRecordCount', 'validRegimeRecordCount', 'groupCount', 'readyGroupCount']) {
      assert(nonNegativeInteger(status[key]) === 0, `disabled runtime ${key} must be zero`);
    }
  } else {
    assert(status.executionState === 'ENABLED_RESEARCH_ONLY', 'runtime execution state invalid');
    assert(status.cadenceRequested === true, 'enabled runtime cadence flag invalid');
    assert(nonNegativeInteger(status.maximumInstrumentCount) !== null && status.maximumInstrumentCount >= 2 && status.maximumInstrumentCount <= 40, 'instrument bound invalid');
    assert(nonNegativeInteger(status.selectedInstrumentCount) !== null && status.selectedInstrumentCount <= status.maximumInstrumentCount, 'selected instrument bound exceeded');
    assert(nonNegativeInteger(status.eligibleInstrumentCount) !== null && status.eligibleInstrumentCount >= status.selectedInstrumentCount, 'eligible instrument count invalid');
    assert(nonNegativeInteger(status.omittedInstrumentCount) === status.eligibleInstrumentCount - status.selectedInstrumentCount, 'omitted instrument count mismatch');
    verifyCoverage(status);
    verifyResearch(status);
  }

  const expectedTelemetry = buildCrossSectionalRegimeWalkForwardOperationalTelemetry(status);
  const health = report?.operationalHealth || {};
  for (const [key, value] of Object.entries(expectedTelemetry)) {
    assert(health[key] === value, `telemetry mismatch for ${key}`);
  }
  const healthText = JSON.stringify(health);
  assert(!healthText.includes('auditSampleRecords') && !healthText.includes('instrumentSummaries') && !healthText.includes('calibration'), 'raw historical research payload leaked into operational health');

  return {
    status: 'VERIFIED',
    contract: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_OBSERVABILITY_CONTRACT,
    telemetry: expectedTelemetry,
  };
}
