export const FORECAST_REGIME_FACTOR_PRODUCTION_SAFETY_VERSION = '2026-08-12.1';

function assert(condition, message) {
  if (!condition) throw new Error(`Forecast regime-factor production safety: ${message}`);
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function authorityDisabled(object, prefix) {
  assert(object?.researchOnly === true, `${prefix} must remain research-only`);
  for (const field of [
    'automaticRegimeWeightingEnabled',
    'automaticFactorReweightingEnabled',
    'probabilityCalibrationEnabled',
    'decisionIntegrationEnabled',
    'forecastMayInfluenceFinalAction',
  ]) {
    if (Object.prototype.hasOwnProperty.call(object || {}, field)) {
      assert(object[field] === false, `${prefix} ${field} must remain false`);
    }
  }
}

function readySignalCount(status) {
  const groups = Array.isArray(status?.groups) ? status.groups : [];
  let supported = 0;
  let inverted = 0;
  for (const group of groups) {
    for (const regime of Array.isArray(group?.regimes) ? group.regimes : []) {
      const signals = [regime?.latentFactorScore, ...(Array.isArray(regime?.domains) ? regime.domains : [])];
      for (const signal of signals) {
        if (signal?.status !== 'REGIME_FACTOR_RESEARCH_READY') continue;
        if (signal?.signal === 'SUPPORTED_IN_REGIME') supported += 1;
        if (signal?.signal === 'INVERTED_IN_REGIME') inverted += 1;
      }
    }
  }
  return { supported, inverted };
}

export function buildForecastRegimeFactorOperationalTelemetry(status = null) {
  const counts = readySignalCount(status);
  return {
    forecastRegimeFactorObservabilityContract: 'REGIME_CONDITIONAL_FACTOR_RESEARCH_OBSERVABILITY_V1',
    forecastRegimeFactorLineageRecordCount: Number(status?.lineageRecordCount || 0),
    forecastRegimeFactorGroupCount: Number(status?.groupCount || 0),
    forecastRegimeFactorSupportedSignalCount: Number(status?.supportedSignalCount || 0),
    forecastRegimeFactorInvertedSignalCount: Number(status?.invertedSignalCount || 0),
    forecastRegimeFactorReadySupportedSignalCount: counts.supported,
    forecastRegimeFactorReadyInvertedSignalCount: counts.inverted,
    forecastRegimeFactorAutomaticRegimeWeightingEnabled: false,
    forecastRegimeFactorAutomaticReweightingEnabled: false,
    forecastRegimeFactorProbabilityCalibrationEnabled: false,
    forecastRegimeFactorDecisionIntegrationEnabled: false,
    forecastRegimeFactorMayInfluenceFinalAction: false,
  };
}

function verifyReadySignal(signal, group, prefix) {
  authorityDisabled(signal, prefix);
  assert(['SUPPORTED_IN_REGIME', 'INVERTED_IN_REGIME', 'INCONCLUSIVE_IN_REGIME'].includes(signal?.signal), `${prefix} signal invalid`);
  assert(['REGIME_FACTOR_RESEARCH_READY', 'REGIME_FACTOR_RESEARCH_NOT_READY'].includes(signal?.status), `${prefix} status invalid`);
  if (signal.status !== 'REGIME_FACTOR_RESEARCH_READY') return;
  assert(group?.coverage?.status === 'REGIME_FACTOR_COVERAGE_READY' && group?.coverage?.coverageReady === true, `${prefix} regime coverage not ready`);
  assert(Array.isArray(signal.blockers) && signal.blockers.length === 0, `${prefix} has blockers`);
  assert(signal.sampleIndependence?.status === 'INDEPENDENCE_READY', `${prefix} sample independence not ready`);
  assert(signal.outcomeWindowIndependence?.status === 'WINDOW_INDEPENDENCE_READY', `${prefix} outcome-window independence not ready`);
  assert(signal.instrumentConcentration?.status === 'INSTRUMENT_DIVERSIFICATION_READY', `${prefix} instrument diversification not ready`);
  assert(signal.taxonomyConcentration?.status === 'TAXONOMY_DIVERSIFICATION_READY', `${prefix} taxonomy diversification not ready`);
}

export function verifyForecastRegimeFactorProductionSafety(report = {}) {
  const status = report?.forecastRegimeFactorAttributionStatus;
  assert(status?.format === 'investor-control-forecast-regime-factor-attribution-status', 'regime-factor status missing or invalid');
  assert(status?.version === 1, 'regime-factor status version invalid');
  assert(typeof status?.policyVersion === 'string' && status.policyVersion.length > 0, 'regime-factor policy version missing');
  authorityDisabled(status, 'regime-factor status');

  const groups = Array.isArray(status.groups) ? status.groups : [];
  assert(nonNegativeInteger(status.lineageRecordCount) !== null, 'lineage record count invalid');
  assert(nonNegativeInteger(status.groupCount) === groups.length, 'group count mismatch');

  let supportedCount = 0;
  let invertedCount = 0;
  for (const [groupIndex, group] of groups.entries()) {
    const groupPrefix = `group ${groupIndex}`;
    authorityDisabled(group, groupPrefix);
    assert(group?.coverage && typeof group.coverage === 'object', `${groupPrefix} coverage missing`);
    const regimes = Array.isArray(group.regimes) ? group.regimes : [];
    assert(nonNegativeInteger(group.regimeCount) === regimes.length, `${groupPrefix} regime count mismatch`);

    for (const [regimeIndex, regime] of regimes.entries()) {
      const regimePrefix = `${groupPrefix} regime ${regimeIndex}`;
      authorityDisabled(regime, regimePrefix);
      assert(typeof regime.regimeKey === 'string' && regime.regimeKey.length > 0, `${regimePrefix} regime key missing`);
      assert(nonNegativeInteger(regime.domainCount) === (Array.isArray(regime.domains) ? regime.domains.length : 0), `${regimePrefix} domain count mismatch`);
      verifyReadySignal(regime.latentFactorScore, group, `${regimePrefix} latent score`);
      if (regime.latentFactorScore?.status === 'REGIME_FACTOR_RESEARCH_READY') {
        if (regime.latentFactorScore.signal === 'SUPPORTED_IN_REGIME') supportedCount += 1;
        if (regime.latentFactorScore.signal === 'INVERTED_IN_REGIME') invertedCount += 1;
      }
      for (const [domainIndex, domain] of (regime.domains || []).entries()) {
        verifyReadySignal(domain, group, `${regimePrefix} domain ${domainIndex}`);
        if (domain?.status === 'REGIME_FACTOR_RESEARCH_READY') {
          if (domain.signal === 'SUPPORTED_IN_REGIME') supportedCount += 1;
          if (domain.signal === 'INVERTED_IN_REGIME') invertedCount += 1;
        }
      }
    }
  }

  assert(nonNegativeInteger(status.supportedSignalCount) === supportedCount, 'supported signal count mismatch');
  assert(nonNegativeInteger(status.invertedSignalCount) === invertedCount, 'inverted signal count mismatch');

  const expectedTelemetry = buildForecastRegimeFactorOperationalTelemetry(status);
  const health = report?.operationalHealth || {};
  for (const [key, expected] of Object.entries(expectedTelemetry)) {
    assert(health[key] === expected, `operational telemetry mismatch for ${key}`);
  }

  return {
    status: 'VERIFIED',
    policyVersion: FORECAST_REGIME_FACTOR_PRODUCTION_SAFETY_VERSION,
    groupCount: groups.length,
    supportedSignalCount: supportedCount,
    invertedSignalCount: invertedCount,
  };
}
