import { validateForecastMarketRegimeSnapshot } from './forecast-market-regime.js';
import { buildForecastStackedEnsembleResearchStatus } from './forecast-stacked-ensemble-research.js';

export const FORECAST_REGIME_STACKED_ENSEMBLE_RESEARCH_VERSION = '2026-08-13.1';
export const FORECAST_REGIME_STACKED_ENSEMBLE_CONTRACT = 'PREQUENTIAL_REGIME_CONDITIONAL_PATTERN_FACTOR_STACK_V1';

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

function stackLineageRecord(record) {
  return record?.validationMode === 'LIVE_SHADOW_OOS' &&
    typeof record?.historicalPatternPolicyVersion === 'string' && record.historicalPatternPolicyVersion.trim().length > 0 &&
    typeof record?.factorScorePolicyVersion === 'string' && record.factorScorePolicyVersion.trim().length > 0 &&
    typeof record?.assetClass === 'string' && record.assetClass.trim().length > 0 &&
    typeof record?.horizon === 'string' && record.horizon.trim().length > 0;
}

function maturedStackInput(record) {
  if (!stackLineageRecord(record) || record?.status !== 'MATURED') return false;
  const patternProbability = strictNumber(record?.rawProbabilityPositive);
  const factorScore = strictNumber(record?.latentFactorScore);
  const forecastAt = timestampMs(record?.forecastAt);
  const outcomeAt = timestampMs(record?.realisedOutcome?.timestamp);
  return patternProbability !== null && patternProbability >= 0 && patternProbability <= 1 &&
    factorScore !== null && factorScore >= -1 && factorScore <= 1 &&
    binaryOutcome(record?.positiveOutcome) &&
    forecastAt !== null && outcomeAt !== null && outcomeAt > forecastAt;
}

function modelGroupKey(record = {}) {
  return [
    record.historicalPatternPolicyVersion || 'NO_PATTERN_VERSION',
    record.factorScorePolicyVersion || 'NO_FACTOR_VERSION',
    record.assetClass || 'UNKNOWN',
    record.horizon || 'UNKNOWN',
  ].join('|');
}

function validRegimeRecord(record) {
  return maturedStackInput(record) &&
    record?.marketRegimeSnapshot &&
    validateForecastMarketRegimeSnapshot(record.marketRegimeSnapshot, record).ok;
}

function regimeSummary(snapshot = {}) {
  return {
    regimeKey: snapshot.regimeKey || null,
    riskTone: snapshot.riskTone || null,
    trendRegime: snapshot.trendRegime || null,
    momentumRegime: snapshot.momentumRegime || null,
    volatilityRegime: snapshot.volatilityRegime || null,
    benchmarkSymbol: snapshot.benchmarkSymbol || null,
  };
}

function compactPooledReference(status = {}) {
  const group = Array.isArray(status.groups) ? status.groups[0] : null;
  return {
    status: group?.status || 'UNAVAILABLE',
    maturedEligibleRecordCount: Number(group?.maturedEligibleRecordCount || 0),
    prequentialPredictionCount: Number(group?.prequentialPredictionCount || 0),
    relativeBrierImprovementPct: group?.improvement?.relativeBrierImprovementPct ?? null,
    logLossImprovement: group?.improvement?.logLossImprovement ?? null,
    calibrationStatus: group?.calibrationStatus || null,
    researchOnly: true,
    decisionImpact: 'NONE',
  };
}

function evaluateRegime(regimeRecords, modelCoverage, options = {}) {
  const snapshot = regimeRecords[0]?.marketRegimeSnapshot || {};
  const ensembleResearch = buildForecastStackedEnsembleResearchStatus({
    generatedAt: options.generatedAt,
    records: regimeRecords,
    options,
  });
  const ensembleGroup = Array.isArray(ensembleResearch.groups) ? ensembleResearch.groups[0] : null;
  const blockers = [];
  if (!modelCoverage.coverageReady) blockers.push('REGIME_ENSEMBLE_LINEAGE_COVERAGE_NOT_READY');
  if (!ensembleGroup || ensembleGroup.status !== 'ENSEMBLE_RESEARCH_READY') {
    blockers.push('REGIME_ENSEMBLE_CHILD_STACK_NOT_READY');
  }
  const uniqueBlockers = [...new Set(blockers)];
  return {
    ...regimeSummary(snapshot),
    status: uniqueBlockers.length ? 'REGIME_ENSEMBLE_RESEARCH_NOT_READY' : 'REGIME_ENSEMBLE_RESEARCH_READY',
    regimeMaturedStackInputCount: regimeRecords.length,
    trainingRegimeIsolation: 'SAME_IMMUTABLE_FORECAST_TIME_REGIME_ONLY',
    antiLeakRule: 'TRAIN_ONLY_ON_SAME_REGIME_OUTCOMES_REALIZED_STRICTLY_BEFORE_TARGET_FORECAST_TIME',
    ensembleResearch,
    blockers: uniqueBlockers,
    researchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    decisionImpact: 'NONE',
  };
}

function evaluateModelGroup(records, options = {}) {
  const lineage = records.filter(stackLineageRecord);
  const maturedInputs = lineage.filter(maturedStackInput);
  const validRegimeMatured = maturedInputs.filter(validRegimeRecord);
  const invalidRegimeSnapshotCount = maturedInputs.filter((record) =>
    record?.marketRegimeSnapshot && !validateForecastMarketRegimeSnapshot(record.marketRegimeSnapshot, record).ok,
  ).length;
  const unclassifiedRegimeMaturedCount = maturedInputs.length - validRegimeMatured.length - invalidRegimeSnapshotCount;
  const minimumRegimeCoveragePct = Math.max(50, Math.min(100, Number(options.regimeEnsembleMinimumCoveragePct ?? 70)));
  const regimeCoveragePct = maturedInputs.length ? (validRegimeMatured.length / maturedInputs.length) * 100 : 0;
  const coverageReady = maturedInputs.length > 0 && invalidRegimeSnapshotCount === 0 && regimeCoveragePct >= minimumRegimeCoveragePct;
  const coverageBlockers = [];
  if (!maturedInputs.length) coverageBlockers.push('REGIME_ENSEMBLE_MATURED_STACK_HISTORY_REQUIRED');
  if (invalidRegimeSnapshotCount) coverageBlockers.push('REGIME_ENSEMBLE_INVALID_MARKET_REGIME_SNAPSHOTS_EXCLUDED');
  if (regimeCoveragePct < minimumRegimeCoveragePct) coverageBlockers.push('REGIME_ENSEMBLE_MATURED_COVERAGE_TOO_LOW');
  const coverage = {
    status: coverageReady ? 'REGIME_ENSEMBLE_COVERAGE_READY' : 'REGIME_ENSEMBLE_COVERAGE_NOT_READY',
    maturedStackInputCount: maturedInputs.length,
    validRegimeMaturedStackInputCount: validRegimeMatured.length,
    unclassifiedRegimeMaturedCount,
    invalidRegimeSnapshotCount,
    regimeCoveragePct: Number(regimeCoveragePct.toFixed(2)),
    minimumRegimeCoveragePct,
    coverageReady,
    blockers: coverageBlockers,
  };

  const byRegime = new Map();
  for (const record of validRegimeMatured) {
    const key = record.marketRegimeSnapshot.regimeKey;
    const items = byRegime.get(key) || [];
    items.push(record);
    byRegime.set(key, items);
  }
  const regimes = [...byRegime.values()]
    .map((items) => evaluateRegime(items, coverage, { ...options, generatedAt: options.generatedAt }))
    .sort((left, right) => String(left.regimeKey).localeCompare(String(right.regimeKey)));

  const pooledStatus = buildForecastStackedEnsembleResearchStatus({
    generatedAt: options.generatedAt,
    records: maturedInputs,
    options,
  });
  const readyRegimeCount = regimes.filter((regime) => regime.status === 'REGIME_ENSEMBLE_RESEARCH_READY').length;
  return {
    historicalPatternPolicyVersion: lineage[0]?.historicalPatternPolicyVersion || null,
    factorScorePolicyVersion: lineage[0]?.factorScorePolicyVersion || null,
    assetClass: lineage[0]?.assetClass || 'UNKNOWN',
    horizon: lineage[0]?.horizon || 'UNKNOWN',
    status: readyRegimeCount ? 'REGIME_ENSEMBLE_RESEARCH_AVAILABLE' : 'REGIME_ENSEMBLE_RESEARCH_NOT_READY',
    lineageRecordCount: lineage.length,
    maturedStackInputCount: maturedInputs.length,
    coverage,
    regimeCount: regimes.length,
    readyRegimeCount,
    regimes,
    pooledReference: compactPooledReference(pooledStatus),
    pooledReferenceMaySatisfyRegimeReadiness: false,
    researchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    decisionImpact: 'NONE',
  };
}

export function buildForecastRegimeStackedEnsembleResearchStatus(input = {}) {
  const records = Array.isArray(input.records) ? input.records : Array.isArray(input.archive?.records) ? input.archive.records : [];
  const lineage = records.filter(stackLineageRecord);
  const groupsMap = new Map();
  for (const record of lineage) {
    const key = modelGroupKey(record);
    const items = groupsMap.get(key) || [];
    items.push(record);
    groupsMap.set(key, items);
  }
  const options = { ...(input.options || {}), generatedAt: input.generatedAt };
  const groups = [...groupsMap.values()]
    .map((items) => evaluateModelGroup(items, options))
    .sort((left, right) => [left.historicalPatternPolicyVersion, left.factorScorePolicyVersion, left.assetClass, left.horizon].join('|')
      .localeCompare([right.historicalPatternPolicyVersion, right.factorScorePolicyVersion, right.assetClass, right.horizon].join('|')));
  const readyRegimeCount = groups.reduce((sum, group) => sum + group.readyRegimeCount, 0);
  const maturedStackInputCount = groups.reduce((sum, group) => sum + group.maturedStackInputCount, 0);
  const validRegimeMaturedStackInputCount = groups.reduce((sum, group) => sum + group.coverage.validRegimeMaturedStackInputCount, 0);
  return {
    format: 'investor-control-forecast-regime-stacked-ensemble-research',
    version: 1,
    policyVersion: FORECAST_REGIME_STACKED_ENSEMBLE_RESEARCH_VERSION,
    contract: FORECAST_REGIME_STACKED_ENSEMBLE_CONTRACT,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    source: 'IMMUTABLE_FORECAST_TIME_REGIME_PREQUENTIAL_PATTERN_PLUS_FACTOR_RESEARCH_ONLY',
    status: readyRegimeCount ? 'RESEARCH_ONLY_READY_REGIMES_EXIST' : 'RESEARCH_ONLY',
    lineageRecordCount: lineage.length,
    maturedStackInputCount,
    validRegimeMaturedStackInputCount,
    groupCount: groups.length,
    regimeCount: groups.reduce((sum, group) => sum + group.regimeCount, 0),
    readyRegimeCount,
    groups,
    methodology: {
      model: 'DETERMINISTIC_L2_LOGISTIC_STACK_REUSED_FROM_V1821',
      trainingRule: 'FOR_EACH_TARGET_TRAIN_ONLY_ON_SAME_IMMUTABLE_FORECAST_TIME_REGIME_OUTCOMES_REALIZED_STRICTLY_BEFORE_TARGET_FORECAST_TIME',
      pooledComparator: 'V1821_POOLED_STACK_DIAGNOSTIC_ONLY',
      pooledComparatorCanPromoteRegime: false,
      legacyRegimeBackfillAllowed: false,
    },
    researchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    decisionImpact: 'NONE',
  };
}
