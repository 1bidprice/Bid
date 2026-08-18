import { validateForecastMarketRegimeSnapshot } from './forecast-market-regime.js';
import { evaluateOosSampleIndependence } from './forecast-oos-sample-independence.js';
import { evaluateOosOutcomeWindowIndependence } from './forecast-oos-outcome-window-independence.js';
import { evaluateOosInstrumentConcentration } from './forecast-oos-instrument-concentration.js';
import { evaluateOosTaxonomyConcentration } from './forecast-oos-taxonomy-concentration.js';

export const FORECAST_REGIME_FACTOR_ATTRIBUTION_VERSION = '2026-08-12.1';

function strictNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function binaryOutcome(value) {
  return value === 0 || value === 1;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function mean(values = []) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function liveFactorLineage(record) {
  return record?.validationMode === 'LIVE_SHADOW_OOS' &&
    typeof record?.factorFeatureVectorPolicyVersion === 'string' &&
    record.factorFeatureVectorPolicyVersion.trim().length > 0 &&
    typeof record?.factorScorePolicyVersion === 'string' &&
    record.factorScorePolicyVersion.trim().length > 0 &&
    Array.isArray(record?.factorDomainSnapshot);
}

function matured(record) {
  return record?.status === 'MATURED' && binaryOutcome(record?.positiveOutcome);
}

function validRegimeRecord(record) {
  return matured(record) &&
    record?.marketRegimeSnapshot &&
    validateForecastMarketRegimeSnapshot(record.marketRegimeSnapshot, record).ok;
}

function modelGroupKey(record = {}) {
  return `${record.factorFeatureVectorPolicyVersion}|${record.factorScorePolicyVersion}|${record.assetClass || 'UNKNOWN'}|${record.horizon || 'UNKNOWN'}`;
}

function rocAuc(observations = []) {
  const valid = observations
    .filter((item) => binaryOutcome(item?.outcome) && Number.isFinite(item?.value))
    .map((item) => ({ score: item.value, outcome: item.outcome }))
    .sort((a, b) => a.score - b.score);
  const positiveCount = valid.filter((item) => item.outcome === 1).length;
  const negativeCount = valid.length - positiveCount;
  if (!positiveCount || !negativeCount) return null;
  let positiveRankSum = 0;
  let index = 0;
  while (index < valid.length) {
    let end = index + 1;
    while (end < valid.length && valid[end].score === valid[index].score) end += 1;
    const averageRank = ((index + 1) + end) / 2;
    for (let cursor = index; cursor < end; cursor += 1) {
      if (valid[cursor].outcome === 1) positiveRankSum += averageRank;
    }
    index = end;
  }
  return (positiveRankSum - positiveCount * (positiveCount + 1) / 2) / (positiveCount * negativeCount);
}

function tailSpread(observations = [], fraction = 0.25) {
  const valid = observations
    .filter((item) => binaryOutcome(item?.outcome) && Number.isFinite(item?.value))
    .slice()
    .sort((a, b) => a.value - b.value);
  if (!valid.length) return {
    tailSampleSize: 0,
    topPositiveRate: null,
    bottomPositiveRate: null,
    positiveRateSpread: null,
    topMeanRealisedReturnPct: null,
    bottomMeanRealisedReturnPct: null,
    realisedReturnSpreadPct: null,
  };
  const size = Math.max(1, Math.floor(valid.length * Math.max(0.1, Math.min(0.4, Number(fraction) || 0.25))));
  const bottom = valid.slice(0, size);
  const top = valid.slice(-size);
  const topPositiveRate = mean(top.map((item) => item.outcome));
  const bottomPositiveRate = mean(bottom.map((item) => item.outcome));
  const topReturn = mean(top.map((item) => item.realisedReturnPct).filter(Number.isFinite));
  const bottomReturn = mean(bottom.map((item) => item.realisedReturnPct).filter(Number.isFinite));
  return {
    tailSampleSize: size,
    topPositiveRate: round(topPositiveRate),
    bottomPositiveRate: round(bottomPositiveRate),
    positiveRateSpread: round(topPositiveRate !== null && bottomPositiveRate !== null ? topPositiveRate - bottomPositiveRate : null),
    topMeanRealisedReturnPct: round(topReturn),
    bottomMeanRealisedReturnPct: round(bottomReturn),
    realisedReturnSpreadPct: round(topReturn !== null && bottomReturn !== null ? topReturn - bottomReturn : null),
  };
}

function recordObservation(record, value) {
  return {
    value,
    outcome: record.positiveOutcome,
    realisedReturnPct: strictNumber(record?.realisedOutcome?.realisedReturnPct),
    record,
  };
}

function domainValue(record, domain) {
  const snapshot = (record.factorDomainSnapshot || []).find((item) => item?.domain === domain);
  const value = strictNumber(snapshot?.value);
  return value !== null && value >= -1 && value <= 1 ? value : null;
}

function latentScoreValue(record) {
  const value = strictNumber(record?.latentFactorScore);
  if (record?.factorScoreStatus !== 'LATENT_SCORE_READY') return null;
  return value !== null && value >= -1 && value <= 1 ? value : null;
}

function evaluateSignal(records, valueSelector, context, options = {}) {
  const observations = [];
  const contributingRecords = [];
  for (const record of records) {
    const value = valueSelector(record);
    if (value === null) continue;
    observations.push(recordObservation(record, value));
    contributingRecords.push(record);
  }

  const minimumMaturedSample = Math.max(30, Number(options.minimumSignalMaturedSample || 60));
  const minimumClassCount = Math.max(5, Number(options.minimumSignalClassCount || 10));
  const minimumFeatureCoveragePct = Math.max(50, Math.min(100, Number(options.minimumSignalFeatureCoveragePct || 70)));
  const supportAuc = Number(options.supportAuc ?? 0.55);
  const inversionAuc = Number(options.inversionAuc ?? 0.45);
  const positiveCount = observations.filter((item) => item.outcome === 1).length;
  const negativeCount = observations.length - positiveCount;
  const featureCoveragePct = records.length ? (observations.length / records.length) * 100 : 0;
  const auc = rocAuc(observations);
  const spread = tailSpread(observations, options.tailFraction || 0.25);
  const sampleIndependence = evaluateOosSampleIndependence(contributingRecords, {
    minimumDistinctForecastDates: options.minimumDistinctForecastDates ?? 20,
    minimumDistinctInstruments: options.minimumDistinctInstruments ?? 8,
    maximumSingleForecastDateSharePct: options.maximumSingleForecastDateSharePct ?? 15,
  });
  const outcomeWindowIndependence = evaluateOosOutcomeWindowIndependence(contributingRecords, {
    minimumEffectiveNonOverlappingWindows: options.minimumEffectiveNonOverlappingWindows ?? 8,
  });
  const instrumentConcentration = evaluateOosInstrumentConcentration(contributingRecords, {
    maximumSingleInstrumentSharePct: options.maximumSingleInstrumentSharePct ?? 30,
    minimumEffectiveInstrumentCount: options.minimumEffectiveInstrumentCount ?? 5,
  });
  const taxonomyConcentration = evaluateOosTaxonomyConcentration(contributingRecords, {
    minimumClassificationCoveragePct: options.minimumClassificationCoveragePct ?? 80,
    materialTaxonomyMinimumSharePct: options.materialTaxonomyMinimumSharePct ?? 15,
    materialTaxonomyMinimumRecordCount: options.materialTaxonomyMinimumRecordCount ?? 30,
    maximumSingleNativeClusterSharePct: options.maximumSingleNativeClusterSharePct ?? 40,
    minimumEffectiveNativeClusterCount: options.minimumEffectiveNativeClusterCount ?? 3,
  });

  const blockers = [];
  if (!context.regimeCoverageReady) blockers.push('REGIME_FACTOR_LINEAGE_COVERAGE_NOT_READY');
  if (observations.length < minimumMaturedSample) blockers.push('REGIME_FACTOR_MATURED_OOS_SAMPLE_TOO_SMALL');
  if (positiveCount < minimumClassCount) blockers.push('REGIME_FACTOR_POSITIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (negativeCount < minimumClassCount) blockers.push('REGIME_FACTOR_NEGATIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (featureCoveragePct < minimumFeatureCoveragePct) blockers.push('REGIME_FACTOR_FEATURE_COVERAGE_TOO_LOW');
  blockers.push(...sampleIndependence.blockers);
  blockers.push(...outcomeWindowIndependence.blockers);
  blockers.push(...instrumentConcentration.blockers);
  blockers.push(...taxonomyConcentration.blockers);
  const uniqueBlockers = [...new Set(blockers)];

  let signal = 'INCONCLUSIVE_IN_REGIME';
  if (!uniqueBlockers.length) {
    if (Number.isFinite(auc) && auc >= supportAuc && Number(spread.positiveRateSpread) > 0 && Number(spread.realisedReturnSpreadPct) > 0) {
      signal = 'SUPPORTED_IN_REGIME';
    } else if (Number.isFinite(auc) && auc <= inversionAuc && Number(spread.positiveRateSpread) < 0 && Number(spread.realisedReturnSpreadPct) < 0) {
      signal = 'INVERTED_IN_REGIME';
    }
  }

  return {
    status: uniqueBlockers.length ? 'REGIME_FACTOR_RESEARCH_NOT_READY' : 'REGIME_FACTOR_RESEARCH_READY',
    signal,
    maturedSampleSize: observations.length,
    positiveCount,
    negativeCount,
    lineageCoverageCount: observations.length,
    lineageCoveragePct: round(featureCoveragePct, 2),
    rocAuc: round(auc),
    topBottom: spread,
    sampleIndependence,
    outcomeWindowIndependence,
    instrumentConcentration,
    taxonomyConcentration,
    thresholds: {
      minimumMaturedSample,
      minimumClassCount,
      minimumFeatureCoveragePct,
      supportAuc,
      inversionAuc,
    },
    blockers: uniqueBlockers,
    researchOnly: true,
    automaticRegimeWeightingEnabled: false,
    automaticFactorReweightingEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
  };
}

function evaluateRegime(records, groupCoverage, options = {}) {
  const snapshot = records[0]?.marketRegimeSnapshot || null;
  const context = { regimeCoverageReady: groupCoverage.coverageReady };
  const latentScore = evaluateSignal(records, latentScoreValue, context, options);
  const domains = [...new Set(records.flatMap((record) =>
    (record.factorDomainSnapshot || []).map((item) => item?.domain).filter(Boolean),
  ))].sort().map((domain) => ({
    domain,
    ...evaluateSignal(records, (record) => domainValue(record, domain), context, options),
  }));
  return {
    regimeKey: snapshot?.regimeKey || null,
    riskTone: snapshot?.riskTone || null,
    trendRegime: snapshot?.trendRegime || null,
    momentumRegime: snapshot?.momentumRegime || null,
    volatilityRegime: snapshot?.volatilityRegime || null,
    benchmarkSymbol: snapshot?.benchmarkSymbol || null,
    maturedRegimeRecordCount: records.length,
    latentFactorScore: latentScore,
    domainCount: domains.length,
    supportedDomainCount: domains.filter((item) => item.signal === 'SUPPORTED_IN_REGIME').length,
    invertedDomainCount: domains.filter((item) => item.signal === 'INVERTED_IN_REGIME').length,
    researchReadyDomainCount: domains.filter((item) => item.status === 'REGIME_FACTOR_RESEARCH_READY').length,
    domains,
    researchOnly: true,
    automaticRegimeWeightingEnabled: false,
    automaticFactorReweightingEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
  };
}

function evaluateGroup(records, options = {}) {
  const lineage = records.filter(liveFactorLineage);
  const maturedLineage = lineage.filter(matured);
  const validRegimeMatured = maturedLineage.filter(validRegimeRecord);
  const invalidRegimeSnapshotCount = maturedLineage.filter((record) =>
    record?.marketRegimeSnapshot && !validateForecastMarketRegimeSnapshot(record.marketRegimeSnapshot, record).ok,
  ).length;
  const minimumRegimeCoveragePct = Math.max(50, Math.min(100, Number(options.minimumRegimeCoveragePct || 70)));
  const regimeCoveragePct = maturedLineage.length ? (validRegimeMatured.length / maturedLineage.length) * 100 : 0;
  const coverageReady = maturedLineage.length > 0 && invalidRegimeSnapshotCount === 0 && regimeCoveragePct >= minimumRegimeCoveragePct;
  const coverageBlockers = [];
  if (!maturedLineage.length) coverageBlockers.push('MATURED_FACTOR_OOS_HISTORY_REQUIRED');
  if (invalidRegimeSnapshotCount) coverageBlockers.push('INVALID_MARKET_REGIME_SNAPSHOTS_EXCLUDED');
  if (regimeCoveragePct < minimumRegimeCoveragePct) coverageBlockers.push('MARKET_REGIME_FACTOR_MATURED_COVERAGE_TOO_LOW');
  const coverage = {
    status: coverageReady ? 'REGIME_FACTOR_COVERAGE_READY' : 'REGIME_FACTOR_COVERAGE_NOT_READY',
    maturedFactorOosCount: maturedLineage.length,
    validRegimeMaturedFactorCount: validRegimeMatured.length,
    unclassifiedRegimeMaturedFactorCount: maturedLineage.length - validRegimeMatured.length - invalidRegimeSnapshotCount,
    invalidRegimeSnapshotCount,
    regimeCoveragePct: round(regimeCoveragePct, 2),
    minimumRegimeCoveragePct,
    coverageReady,
    blockers: coverageBlockers,
  };

  const byRegime = new Map();
  for (const record of validRegimeMatured) {
    const key = record.marketRegimeSnapshot.regimeKey;
    const group = byRegime.get(key) || [];
    group.push(record);
    byRegime.set(key, group);
  }
  const regimes = [...byRegime.values()]
    .map((regimeRecords) => evaluateRegime(regimeRecords, coverage, options))
    .sort((a, b) => String(a.regimeKey).localeCompare(String(b.regimeKey)));

  return {
    factorFeatureVectorPolicyVersion: lineage[0]?.factorFeatureVectorPolicyVersion || null,
    factorScorePolicyVersion: lineage[0]?.factorScorePolicyVersion || null,
    assetClass: lineage[0]?.assetClass || 'UNKNOWN',
    horizon: lineage[0]?.horizon || 'UNKNOWN',
    status: regimes.some((item) => item.researchReadyDomainCount > 0 || item.latentFactorScore.status === 'REGIME_FACTOR_RESEARCH_READY')
      ? 'REGIME_FACTOR_RESEARCH_AVAILABLE'
      : 'REGIME_FACTOR_RESEARCH_NOT_READY',
    lineageRecordCount: lineage.length,
    coverage,
    regimeCount: regimes.length,
    supportedSignalCount: regimes.reduce((sum, regime) => sum + regime.supportedDomainCount + (regime.latentFactorScore.signal === 'SUPPORTED_IN_REGIME' ? 1 : 0), 0),
    invertedSignalCount: regimes.reduce((sum, regime) => sum + regime.invertedDomainCount + (regime.latentFactorScore.signal === 'INVERTED_IN_REGIME' ? 1 : 0), 0),
    regimes,
    researchOnly: true,
    automaticRegimeWeightingEnabled: false,
    automaticFactorReweightingEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
  };
}

export function buildForecastRegimeFactorAttributionStatus(input = {}) {
  const lineage = (Array.isArray(input.records) ? input.records : input.archive?.records || []).filter(liveFactorLineage);
  const groupsMap = new Map();
  for (const record of lineage) {
    const key = modelGroupKey(record);
    const group = groupsMap.get(key) || [];
    group.push(record);
    groupsMap.set(key, group);
  }
  const groups = [...groupsMap.values()]
    .map((records) => evaluateGroup(records, input.options || {}))
    .sort((a, b) =>
      String(a.factorFeatureVectorPolicyVersion).localeCompare(String(b.factorFeatureVectorPolicyVersion)) ||
      String(a.factorScorePolicyVersion).localeCompare(String(b.factorScorePolicyVersion)) ||
      String(a.assetClass).localeCompare(String(b.assetClass)) ||
      String(a.horizon).localeCompare(String(b.horizon)),
    );
  return {
    format: 'investor-control-forecast-regime-factor-attribution-status',
    version: 1,
    policyVersion: FORECAST_REGIME_FACTOR_ATTRIBUTION_VERSION,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    source: 'IMMUTABLE_REGIME_AND_FACTOR_OOS_SNAPSHOTS_ONLY',
    status: lineage.length ? 'RESEARCH_ONLY' : 'NO_REGIME_FACTOR_OOS_LINEAGE',
    lineageRecordCount: lineage.length,
    groupCount: groups.length,
    supportedSignalCount: groups.reduce((sum, group) => sum + group.supportedSignalCount, 0),
    invertedSignalCount: groups.reduce((sum, group) => sum + group.invertedSignalCount, 0),
    groups,
    researchOnly: true,
    automaticRegimeWeightingEnabled: false,
    automaticFactorReweightingEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
  };
}
