import { evaluateForecastCalibration } from './forecast-calibration.js';
import { validateForecastMarketRegimeSnapshot } from './forecast-market-regime.js';
import { evaluateOosSampleIndependence } from './forecast-oos-sample-independence.js';
import { evaluateOosOutcomeWindowIndependence } from './forecast-oos-outcome-window-independence.js';
import { evaluateOosInstrumentConcentration } from './forecast-oos-instrument-concentration.js';

export const FORECAST_REGIME_LEARNING_STATUS_VERSION = '2026-08-12.1';

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

function median(values = []) {
  const valid = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function liveOos(record) {
  return record?.validationMode === 'LIVE_SHADOW_OOS' &&
    typeof record?.historicalPatternPolicyVersion === 'string' &&
    record.historicalPatternPolicyVersion.trim().length > 0;
}

function matured(record) {
  return record?.status === 'MATURED' && binaryOutcome(record?.positiveOutcome);
}

function modelGroupKey(record = {}) {
  return `${record.historicalPatternPolicyVersion || 'NO_PATTERN_VERSION'}|${record.assetClass || 'UNKNOWN'}|${record.horizon || 'UNKNOWN'}`;
}

function validRegimeRecord(record) {
  if (!matured(record) || !record?.marketRegimeSnapshot) return false;
  return validateForecastMarketRegimeSnapshot(record.marketRegimeSnapshot, record).ok;
}

function regimeKey(record = {}) {
  return record?.marketRegimeSnapshot?.regimeKey || null;
}

function validProbabilityRecord(record) {
  const probability = strictNumber(record?.rawProbabilityPositive);
  return probability !== null && probability >= 0 && probability <= 1 && binaryOutcome(record?.positiveOutcome);
}

function regimeMetrics(records = []) {
  const outcomes = records.map((record) => record.positiveOutcome).filter(binaryOutcome);
  const realisedReturns = records.map((record) => strictNumber(record?.realisedOutcome?.realisedReturnPct)).filter(Number.isFinite);
  const expectedReturns = records.map((record) => strictNumber(record?.expectedReturnPct)).filter(Number.isFinite);
  const forecastErrors = records.map((record) => {
    const expected = strictNumber(record?.expectedReturnPct);
    const realised = strictNumber(record?.realisedOutcome?.realisedReturnPct);
    return expected !== null && realised !== null ? realised - expected : null;
  }).filter(Number.isFinite);
  const probabilities = records.map((record) => strictNumber(record?.rawProbabilityPositive)).filter((value) => value !== null && value >= 0 && value <= 1);
  return {
    positiveRate: outcomes.length ? round(mean(outcomes), 4) : null,
    meanRealisedReturnPct: round(mean(realisedReturns), 4),
    medianRealisedReturnPct: round(median(realisedReturns), 4),
    meanExpectedReturnPct: round(mean(expectedReturns), 4),
    meanForecastErrorPct: round(mean(forecastErrors), 4),
    medianForecastErrorPct: round(median(forecastErrors), 4),
    meanRawProbabilityPositive: round(mean(probabilities), 4),
    realisedReturnSampleSize: realisedReturns.length,
    expectedReturnSampleSize: expectedReturns.length,
    probabilitySampleSize: probabilities.length,
  };
}

function evaluateRegime(records, modelCoverage, options = {}) {
  const sample = records.filter(validRegimeRecord);
  const snapshot = sample[0]?.marketRegimeSnapshot || null;
  const minimumRegimeMaturedSample = Math.max(30, Number(options.minimumRegimeMaturedSample || 60));
  const minimumRegimeClassCount = Math.max(5, Number(options.minimumRegimeClassCount || 10));
  const minimumDistinctForecastDates = Math.max(10, Number(options.minimumRegimeDistinctForecastDates || 20));
  const minimumDistinctInstruments = Math.max(5, Number(options.minimumRegimeDistinctInstruments || 8));
  const maximumSingleForecastDateSharePct = Number(options.maximumRegimeSingleForecastDateSharePct ?? 15);
  const minimumEffectiveNonOverlappingWindows = Math.max(4, Number(options.minimumRegimeEffectiveNonOverlappingWindows || 8));
  const maximumSingleInstrumentSharePct = Number(options.maximumRegimeSingleInstrumentSharePct ?? 30);
  const minimumEffectiveInstrumentCount = Math.max(3, Number(options.minimumRegimeEffectiveInstrumentCount || 5));
  const positiveCount = sample.filter((record) => record.positiveOutcome === 1).length;
  const negativeCount = sample.length - positiveCount;
  const probabilityRecords = sample.filter(validProbabilityRecord);
  const calibration = evaluateForecastCalibration(probabilityRecords, {
    minimumTotal: Math.max(20, Math.min(minimumRegimeMaturedSample, Number(options.minimumRegimeCalibrationSample || 40))),
    binCount: 10,
  });
  const sampleIndependence = evaluateOosSampleIndependence(sample, {
    minimumDistinctForecastDates,
    minimumDistinctInstruments,
    maximumSingleForecastDateSharePct,
  });
  const outcomeWindowIndependence = evaluateOosOutcomeWindowIndependence(sample, {
    minimumEffectiveNonOverlappingWindows,
  });
  const instrumentConcentration = evaluateOosInstrumentConcentration(sample, {
    maximumSingleInstrumentSharePct,
    minimumEffectiveInstrumentCount,
  });
  const blockers = [];
  if (!modelCoverage.coverageReady) blockers.push('REGIME_LINEAGE_COVERAGE_NOT_READY');
  if (sample.length < minimumRegimeMaturedSample) blockers.push('REGIME_MATURED_OOS_SAMPLE_TOO_SMALL');
  if (positiveCount < minimumRegimeClassCount) blockers.push('REGIME_POSITIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (negativeCount < minimumRegimeClassCount) blockers.push('REGIME_NEGATIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (probabilityRecords.length !== sample.length) blockers.push('REGIME_STRICT_PROBABILITY_SAMPLE_INCOMPLETE');
  blockers.push(...sampleIndependence.blockers);
  blockers.push(...outcomeWindowIndependence.blockers);
  blockers.push(...instrumentConcentration.blockers);
  if (calibration.status !== 'OOS_METRICS_READY') blockers.push('REGIME_CALIBRATION_SAMPLE_NOT_READY');
  const uniqueBlockers = [...new Set(blockers)];
  return {
    regimeKey: snapshot?.regimeKey || null,
    riskTone: snapshot?.riskTone || null,
    trendRegime: snapshot?.trendRegime || null,
    momentumRegime: snapshot?.momentumRegime || null,
    volatilityRegime: snapshot?.volatilityRegime || null,
    benchmarkSymbol: snapshot?.benchmarkSymbol || null,
    status: uniqueBlockers.length ? 'REGIME_RESEARCH_NOT_READY' : 'REGIME_RESEARCH_READY',
    maturedSampleSize: sample.length,
    positiveCount,
    negativeCount,
    metrics: regimeMetrics(sample),
    calibration,
    sampleIndependence,
    outcomeWindowIndependence,
    instrumentConcentration,
    thresholds: {
      minimumRegimeMaturedSample,
      minimumRegimeClassCount,
      minimumDistinctForecastDates,
      minimumDistinctInstruments,
      maximumSingleForecastDateSharePct,
      minimumEffectiveNonOverlappingWindows,
      maximumSingleInstrumentSharePct,
      minimumEffectiveInstrumentCount,
    },
    blockers: uniqueBlockers,
    researchOnly: true,
    probabilityCalibrationEnabled: false,
    factorReweightingEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
  };
}

function evaluateModelGroup(records, options = {}) {
  const lineage = records.filter(liveOos);
  const maturedRecords = lineage.filter(matured);
  const regimeMaturedRecords = maturedRecords.filter(validRegimeRecord);
  const invalidRegimeSnapshotCount = maturedRecords.filter((record) =>
    record?.marketRegimeSnapshot && !validateForecastMarketRegimeSnapshot(record.marketRegimeSnapshot, record).ok,
  ).length;
  const minimumRegimeCoveragePct = Math.max(50, Math.min(100, Number(options.minimumRegimeCoveragePct || 70)));
  const regimeCoveragePct = maturedRecords.length ? (regimeMaturedRecords.length / maturedRecords.length) * 100 : 0;
  const coverageReady = maturedRecords.length > 0 && invalidRegimeSnapshotCount === 0 && regimeCoveragePct >= minimumRegimeCoveragePct;
  const coverageBlockers = [];
  if (!maturedRecords.length) coverageBlockers.push('MATURED_OOS_HISTORY_REQUIRED');
  if (invalidRegimeSnapshotCount) coverageBlockers.push('INVALID_MARKET_REGIME_SNAPSHOTS_EXCLUDED');
  if (regimeCoveragePct < minimumRegimeCoveragePct) coverageBlockers.push('MARKET_REGIME_MATURED_COVERAGE_TOO_LOW');
  const coverage = {
    status: coverageReady ? 'REGIME_COVERAGE_READY' : 'REGIME_COVERAGE_NOT_READY',
    maturedOosCount: maturedRecords.length,
    validRegimeMaturedCount: regimeMaturedRecords.length,
    unclassifiedRegimeMaturedCount: maturedRecords.length - regimeMaturedRecords.length - invalidRegimeSnapshotCount,
    invalidRegimeSnapshotCount,
    regimeCoveragePct: round(regimeCoveragePct, 2),
    minimumRegimeCoveragePct,
    coverageReady,
    blockers: coverageBlockers,
  };
  const byRegime = new Map();
  for (const record of regimeMaturedRecords) {
    const key = regimeKey(record);
    if (!key) continue;
    const group = byRegime.get(key) || [];
    group.push(record);
    byRegime.set(key, group);
  }
  const regimes = [...byRegime.values()]
    .map((group) => evaluateRegime(group, coverage, options))
    .sort((a, b) => String(a.regimeKey).localeCompare(String(b.regimeKey)));
  return {
    historicalPatternPolicyVersion: lineage[0]?.historicalPatternPolicyVersion || null,
    assetClass: lineage[0]?.assetClass || 'UNKNOWN',
    horizon: lineage[0]?.horizon || 'UNKNOWN',
    status: regimes.some((item) => item.status === 'REGIME_RESEARCH_READY') ? 'REGIME_RESEARCH_AVAILABLE' : 'REGIME_RESEARCH_NOT_READY',
    lineageRecordCount: lineage.length,
    coverage,
    regimeCount: regimes.length,
    readyRegimeCount: regimes.filter((item) => item.status === 'REGIME_RESEARCH_READY').length,
    regimes,
    researchOnly: true,
    automaticRegimeWeightingEnabled: false,
    probabilityCalibrationEnabled: false,
    factorReweightingEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
  };
}

export function buildForecastRegimeLearningStatus(input = {}) {
  const lineage = (Array.isArray(input.records) ? input.records : input.archive?.records || []).filter(liveOos);
  const byModel = new Map();
  for (const record of lineage) {
    const key = modelGroupKey(record);
    const group = byModel.get(key) || [];
    group.push(record);
    byModel.set(key, group);
  }
  const groups = [...byModel.values()]
    .map((records) => evaluateModelGroup(records, input.options || {}))
    .sort((a, b) =>
      String(a.historicalPatternPolicyVersion).localeCompare(String(b.historicalPatternPolicyVersion)) ||
      String(a.assetClass).localeCompare(String(b.assetClass)) ||
      String(a.horizon).localeCompare(String(b.horizon)),
    );
  return {
    format: 'investor-control-forecast-regime-learning-status',
    version: 1,
    policyVersion: FORECAST_REGIME_LEARNING_STATUS_VERSION,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    source: 'IMMUTABLE_FORECAST_TIME_MARKET_REGIME_OOS_ONLY',
    status: lineage.length ? 'RESEARCH_ONLY' : 'NO_MARKET_REGIME_OOS_LINEAGE',
    lineageRecordCount: lineage.length,
    groupCount: groups.length,
    readyRegimeCount: groups.reduce((sum, group) => sum + group.readyRegimeCount, 0),
    groups,
    researchOnly: true,
    automaticRegimeWeightingEnabled: false,
    probabilityCalibrationEnabled: false,
    factorReweightingEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
  };
}
