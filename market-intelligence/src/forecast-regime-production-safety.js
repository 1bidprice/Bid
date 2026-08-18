export const FORECAST_REGIME_PRODUCTION_SAFETY_VERSION = '2026-08-12.1';

function assert(condition, message) {
  if (!condition) throw new Error(`Forecast regime production safety: ${message}`);
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function authorityDisabled(object, prefix) {
  assert(object?.researchOnly === true, `${prefix} must remain research-only`);
  for (const field of [
    'automaticRegimeWeightingEnabled',
    'probabilityCalibrationEnabled',
    'factorReweightingEnabled',
    'decisionIntegrationEnabled',
    'forecastMayInfluenceFinalAction',
  ]) {
    if (Object.prototype.hasOwnProperty.call(object || {}, field)) {
      assert(object[field] === false, `${prefix} ${field} must remain false`);
    }
  }
}

export function buildForecastRegimeOperationalTelemetry(status = null) {
  const groups = Array.isArray(status?.groups) ? status.groups : [];
  const maturedOosCount = groups.reduce((sum, group) => sum + Number(group?.coverage?.maturedOosCount || 0), 0);
  const validRegimeMaturedCount = groups.reduce((sum, group) => sum + Number(group?.coverage?.validRegimeMaturedCount || 0), 0);
  return {
    forecastRegimeObservabilityContract: 'REGIME_STRATIFIED_OOS_RESEARCH_OBSERVABILITY_V1',
    forecastRegimeLearningLineageRecordCount: Number(status?.lineageRecordCount || 0),
    forecastRegimeLearningGroupCount: Number(status?.groupCount || 0),
    forecastRegimeLearningReadyRegimeCount: Number(status?.readyRegimeCount || 0),
    forecastRegimeLearningMaturedOosCount: maturedOosCount,
    forecastRegimeLearningValidRegimeMaturedCount: validRegimeMaturedCount,
    forecastRegimeAutomaticWeightingEnabled: false,
    forecastRegimeProbabilityCalibrationEnabled: false,
    forecastRegimeFactorReweightingEnabled: false,
    forecastRegimeDecisionIntegrationEnabled: false,
    forecastRegimeMayInfluenceFinalAction: false,
  };
}

export function verifyForecastRegimeProductionSafety(report = {}) {
  const status = report?.forecastRegimeLearningStatus;
  assert(status?.format === 'investor-control-forecast-regime-learning-status', 'regime learning status missing or invalid');
  assert(status?.version === 1, 'regime learning version invalid');
  assert(typeof status?.policyVersion === 'string' && status.policyVersion.length > 0, 'regime learning policy version missing');
  authorityDisabled(status, 'regime learning status');

  const groups = Array.isArray(status.groups) ? status.groups : [];
  assert(nonNegativeInteger(status.lineageRecordCount) !== null, 'lineage record count invalid');
  assert(nonNegativeInteger(status.groupCount) === groups.length, 'group count mismatch');

  let calculatedReadyRegimeCount = 0;
  for (const [groupIndex, group] of groups.entries()) {
    const prefix = `group ${groupIndex}`;
    authorityDisabled(group, prefix);
    assert(group?.coverage && typeof group.coverage === 'object', `${prefix} coverage missing`);
    const regimes = Array.isArray(group.regimes) ? group.regimes : [];
    assert(nonNegativeInteger(group.regimeCount) === regimes.length, `${prefix} regime count mismatch`);
    const readyInGroup = regimes.filter((regime) => regime?.status === 'REGIME_RESEARCH_READY').length;
    assert(nonNegativeInteger(group.readyRegimeCount) === readyInGroup, `${prefix} ready regime count mismatch`);
    calculatedReadyRegimeCount += readyInGroup;

    for (const [regimeIndex, regime] of regimes.entries()) {
      const regimePrefix = `${prefix} regime ${regimeIndex}`;
      authorityDisabled(regime, regimePrefix);
      assert(typeof regime.regimeKey === 'string' && regime.regimeKey.length > 0, `${regimePrefix} regime key missing`);
      assert(['REGIME_RESEARCH_READY', 'REGIME_RESEARCH_NOT_READY'].includes(regime.status), `${regimePrefix} status invalid`);
      if (regime.status === 'REGIME_RESEARCH_READY') {
        assert(group.coverage.status === 'REGIME_COVERAGE_READY' && group.coverage.coverageReady === true, `${regimePrefix} coverage not ready`);
        assert(Array.isArray(regime.blockers) && regime.blockers.length === 0, `${regimePrefix} has blockers`);
        assert(regime.calibration?.status === 'OOS_METRICS_READY', `${regimePrefix} calibration not ready`);
        assert(regime.sampleIndependence?.status === 'INDEPENDENCE_READY', `${regimePrefix} sample independence not ready`);
        assert(regime.outcomeWindowIndependence?.status === 'WINDOW_INDEPENDENCE_READY', `${regimePrefix} outcome-window independence not ready`);
        assert(regime.instrumentConcentration?.status === 'INSTRUMENT_DIVERSIFICATION_READY', `${regimePrefix} instrument diversification not ready`);
      }
    }
  }

  assert(nonNegativeInteger(status.readyRegimeCount) === calculatedReadyRegimeCount, 'top-level ready regime count mismatch');
  const expectedTelemetry = buildForecastRegimeOperationalTelemetry(status);
  const health = report?.operationalHealth || {};
  for (const [key, expected] of Object.entries(expectedTelemetry)) {
    assert(health[key] === expected, `operational telemetry mismatch for ${key}`);
  }

  return {
    status: 'VERIFIED',
    policyVersion: FORECAST_REGIME_PRODUCTION_SAFETY_VERSION,
    groupCount: groups.length,
    readyRegimeCount: calculatedReadyRegimeCount,
  };
}
