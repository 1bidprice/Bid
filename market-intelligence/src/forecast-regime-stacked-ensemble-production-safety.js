import {
  FORECAST_REGIME_STACKED_ENSEMBLE_CONTRACT,
  FORECAST_REGIME_STACKED_ENSEMBLE_RESEARCH_VERSION,
} from './forecast-regime-stacked-ensemble-research.js';
import {
  buildForecastStackedEnsembleOperationalTelemetry,
  verifyForecastStackedEnsembleProductionSafety,
} from './forecast-stacked-ensemble-production-safety.js';

export const FORECAST_REGIME_STACKED_ENSEMBLE_OBSERVABILITY_CONTRACT = 'REGIME_STACKED_ENSEMBLE_RESEARCH_OBSERVABILITY_V1';

function assert(condition, message) {
  if (!condition) throw new Error(`Regime stacked ensemble production safety: ${message}`);
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function authoritySafe(value = {}) {
  return value?.automaticModelPromotionEnabled === false &&
    value?.probabilityCalibrationEnabled === false &&
    value?.decisionIntegrationEnabled === false &&
    value?.forecastMayInfluenceFinalAction === false &&
    value?.finalActionEligible === false &&
    value?.decisionImpact === 'NONE';
}

export function buildForecastRegimeStackedEnsembleOperationalTelemetry(status = {}) {
  return {
    forecastRegimeStackedEnsembleObservabilityContract: FORECAST_REGIME_STACKED_ENSEMBLE_OBSERVABILITY_CONTRACT,
    forecastRegimeStackedEnsemblePolicyVersion: status?.policyVersion || null,
    forecastRegimeStackedEnsembleStatus: status?.status || 'UNAVAILABLE',
    forecastRegimeStackedEnsembleLineageRecordCount: Number(status?.lineageRecordCount || 0),
    forecastRegimeStackedEnsembleMaturedStackInputCount: Number(status?.maturedStackInputCount || 0),
    forecastRegimeStackedEnsembleValidRegimeMaturedCount: Number(status?.validRegimeMaturedStackInputCount || 0),
    forecastRegimeStackedEnsembleGroupCount: Number(status?.groupCount || 0),
    forecastRegimeStackedEnsembleRegimeCount: Number(status?.regimeCount || 0),
    forecastRegimeStackedEnsembleReadyRegimeCount: Number(status?.readyRegimeCount || 0),
    forecastRegimeStackedEnsembleAutomaticModelPromotionEnabled: false,
    forecastRegimeStackedEnsembleProbabilityCalibrationEnabled: false,
    forecastRegimeStackedEnsembleDecisionIntegrationEnabled: false,
    forecastRegimeStackedEnsembleMayInfluenceFinalAction: false,
  };
}

function verifyChildStack(regime, groupIndex, regimeIndex) {
  const prefix = `group ${groupIndex} regime ${regimeIndex}`;
  assert(authoritySafe(regime), `${prefix} has forbidden authority`);
  assert(typeof regime?.regimeKey === 'string' && regime.regimeKey.length > 0, `${prefix} regime key missing`);
  assert(regime?.trainingRegimeIsolation === 'SAME_IMMUTABLE_FORECAST_TIME_REGIME_ONLY', `${prefix} training isolation missing`);
  assert(regime?.antiLeakRule === 'TRAIN_ONLY_ON_SAME_REGIME_OUTCOMES_REALIZED_STRICTLY_BEFORE_TARGET_FORECAST_TIME', `${prefix} anti-leak rule invalid`);
  const child = regime?.ensembleResearch;
  assert(child && typeof child === 'object', `${prefix} child stacked research missing`);
  assert(nonNegativeInteger(child.lineageRecordCount) === nonNegativeInteger(regime.regimeMaturedStackInputCount), `${prefix} child lineage crosses regime boundary`);
  const miniReport = {
    forecastStackedEnsembleResearchStatus: child,
    operationalHealth: buildForecastStackedEnsembleOperationalTelemetry(child),
  };
  verifyForecastStackedEnsembleProductionSafety(miniReport);
  if (regime.status === 'REGIME_ENSEMBLE_RESEARCH_READY') {
    assert(nonNegativeInteger(child.readyGroupCount) > 0, `${prefix} ready regime has no ready child stack`);
    assert(Array.isArray(regime.blockers) && regime.blockers.length === 0, `${prefix} ready regime has blockers`);
  }
}

export function verifyForecastRegimeStackedEnsembleProductionSafety(report = {}) {
  const status = report?.forecastRegimeStackedEnsembleResearchStatus;
  assert(status && typeof status === 'object', 'research status missing');
  assert(status.format === 'investor-control-forecast-regime-stacked-ensemble-research', 'research format invalid');
  assert(status.version === 1, 'research version invalid');
  assert(status.policyVersion === FORECAST_REGIME_STACKED_ENSEMBLE_RESEARCH_VERSION, 'research policy version invalid');
  assert(status.contract === FORECAST_REGIME_STACKED_ENSEMBLE_CONTRACT, 'research contract invalid');
  assert(authoritySafe(status), 'research status has forbidden authority');
  assert(status?.methodology?.trainingRule === 'FOR_EACH_TARGET_TRAIN_ONLY_ON_SAME_IMMUTABLE_FORECAST_TIME_REGIME_OUTCOMES_REALIZED_STRICTLY_BEFORE_TARGET_FORECAST_TIME', 'regime anti-leak training rule missing');
  assert(status?.methodology?.pooledComparatorCanPromoteRegime === false, 'pooled comparator must never promote a regime');
  assert(status?.methodology?.legacyRegimeBackfillAllowed === false, 'legacy regime backfill must remain forbidden');

  const groups = Array.isArray(status.groups) ? status.groups : [];
  assert(nonNegativeInteger(status.groupCount) === groups.length, 'group count mismatch');
  let regimeCount = 0;
  let readyRegimeCount = 0;
  let validRegimeMaturedCount = 0;
  groups.forEach((group, groupIndex) => {
    assert(authoritySafe(group), `group ${groupIndex} has forbidden authority`);
    assert(group?.pooledReferenceMaySatisfyRegimeReadiness === false, `group ${groupIndex} pooled reference may promote regime`);
    const coverage = group?.coverage || {};
    assert(finiteNumber(coverage.minimumRegimeCoveragePct) >= 70, `group ${groupIndex} regime coverage threshold too weak`);
    assert(nonNegativeInteger(coverage.invalidRegimeSnapshotCount) !== null, `group ${groupIndex} invalid regime count malformed`);
    if (coverage.coverageReady === true) {
      assert(coverage.status === 'REGIME_ENSEMBLE_COVERAGE_READY', `group ${groupIndex} coverage status mismatch`);
      assert(coverage.invalidRegimeSnapshotCount === 0, `group ${groupIndex} ready coverage contains invalid regime snapshots`);
      assert(finiteNumber(coverage.regimeCoveragePct) >= coverage.minimumRegimeCoveragePct, `group ${groupIndex} coverage below threshold`);
    }
    const regimes = Array.isArray(group.regimes) ? group.regimes : [];
    assert(nonNegativeInteger(group.regimeCount) === regimes.length, `group ${groupIndex} regime count mismatch`);
    regimeCount += regimes.length;
    validRegimeMaturedCount += Number(coverage.validRegimeMaturedStackInputCount || 0);
    regimes.forEach((regime, regimeIndex) => {
      verifyChildStack(regime, groupIndex, regimeIndex);
      if (regime.status === 'REGIME_ENSEMBLE_RESEARCH_READY') {
        assert(coverage.coverageReady === true, `group ${groupIndex} ready regime bypasses coverage gate`);
        readyRegimeCount += 1;
      }
    });
  });
  assert(nonNegativeInteger(status.regimeCount) === regimeCount, 'top-level regime count mismatch');
  assert(nonNegativeInteger(status.readyRegimeCount) === readyRegimeCount, 'top-level ready regime count mismatch');
  assert(nonNegativeInteger(status.validRegimeMaturedStackInputCount) === validRegimeMaturedCount, 'top-level valid regime matured count mismatch');

  const expectedTelemetry = buildForecastRegimeStackedEnsembleOperationalTelemetry(status);
  const health = report?.operationalHealth || {};
  for (const [key, value] of Object.entries(expectedTelemetry)) {
    assert(health[key] === value, `telemetry mismatch for ${key}`);
  }
  const serializedHealth = JSON.stringify(health);
  assert(!serializedHealth.includes('ensembleResearch') && !serializedHealth.includes('pooledReference') && !serializedHealth.includes('latestModel') && !serializedHealth.includes('coefficients'), 'raw regime ensemble research leaked into operational health');

  return {
    status: 'VERIFIED',
    contract: FORECAST_REGIME_STACKED_ENSEMBLE_OBSERVABILITY_CONTRACT,
    telemetry: expectedTelemetry,
  };
}
