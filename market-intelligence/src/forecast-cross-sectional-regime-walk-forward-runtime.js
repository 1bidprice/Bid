import {
  buildCrossSectionalRegimeWalkForwardResearch,
  FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_CONTRACT,
  FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_EVIDENCE_CLASS,
  FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_VERSION,
} from './forecast-cross-sectional-regime-walk-forward.js';

export const FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RUNTIME_VERSION = '2026-08-13.2';
export const FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RUNTIME_CONTRACT = 'BOUNDED_CADENCE_CONTROLLED_HISTORICAL_RESEARCH_RUNTIME_V1';
export const FORECAST_HISTORICAL_UNIVERSE_COVERAGE_CONTRACT = 'HISTORICAL_WALK_FORWARD_UNIVERSE_COVERAGE_V1';

const MAX_COVERAGE_DIAGNOSTIC_ITEMS = 40;

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function safeMap(value) {
  return value instanceof Map ? value : new Map();
}

function companyIdFromDossier(dossier = {}) {
  return String(dossier.companyId || dossier.company?.companyId || '').trim() || null;
}

function symbolFromDossier(dossier = {}) {
  return String(
    dossier?.instrumentProfile?.primaryListing?.symbol ||
    dossier?.primaryListing?.symbol ||
    dossier?.company?.primaryListing?.symbol ||
    dossier?.symbol ||
    '',
  ).trim() || null;
}

function assetClassFromDossier(dossier = {}) {
  return String(
    dossier?.instrumentProfile?.assetClass ||
    dossier?.instrumentRoute?.assetClass ||
    dossier?.assetClass ||
    'EQUITY',
  ).trim() || 'EQUITY';
}

function safeHistoryIdentity(companyId, series = {}) {
  return {
    companyId: String(companyId || '').trim() || null,
    candleCount: Array.isArray(series?.candles) ? series.candles.length : 0,
    source: String(series?.source || '').trim() || null,
    sourceQuality: String(series?.sourceQuality || '').trim() || null,
  };
}

function candidateIdentity(candidate = {}) {
  return {
    instrumentId: candidate.instrumentId || null,
    companyId: candidate.companyId || null,
    symbol: candidate.symbol || null,
    assetClass: candidate.assetClass || null,
    candleCount: Array.isArray(candidate?.series?.candles) ? candidate.series.candles.length : 0,
    source: String(candidate?.series?.source || '').trim() || null,
    sourceQuality: String(candidate?.series?.sourceQuality || '').trim() || null,
    benchmarkAvailable: Boolean(candidate?.benchmarkSeries && Array.isArray(candidate.benchmarkSeries.candles) && candidate.benchmarkSeries.candles.length),
  };
}

function historyLengthSummary(candidates = []) {
  const lengths = candidates
    .map((candidate) => Array.isArray(candidate?.series?.candles) ? candidate.series.candles.length : 0)
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((left, right) => left - right);
  if (!lengths.length) return { minimum: 0, median: 0, maximum: 0 };
  const midpoint = Math.floor(lengths.length / 2);
  const median = lengths.length % 2
    ? lengths[midpoint]
    : Number(((lengths[midpoint - 1] + lengths[midpoint]) / 2).toFixed(2));
  return {
    minimum: lengths[0],
    median,
    maximum: lengths[lengths.length - 1],
  };
}

function incrementReason(reasonCounts, code) {
  reasonCounts[code] = (reasonCounts[code] || 0) + 1;
}

export function buildHistoricalWalkForwardRuntimeInstrumentSet(input = {}) {
  const historicalSeries = safeMap(input.historicalSeriesByCompany);
  const benchmarkSeries = safeMap(input.benchmarkSeriesByCompany);
  const dossiers = Array.isArray(input.researchDossiers) ? input.researchDossiers : [];
  const maximumInstrumentCount = integer(input.maximumInstrumentCount, 24, 2, 40);
  const candidates = [];
  const acceptedCompanyIds = new Set();
  const dossierCompanyIds = new Set();
  const exclusionReasonCounts = {};
  const excluded = [];

  for (const dossier of dossiers) {
    const companyId = companyIdFromDossier(dossier);
    if (companyId) dossierCompanyIds.add(companyId);
    if (!companyId) {
      incrementReason(exclusionReasonCounts, 'COMPANY_ID_MISSING');
      if (excluded.length < MAX_COVERAGE_DIAGNOSTIC_ITEMS) {
        excluded.push({ companyId: null, symbol: symbolFromDossier(dossier), reason: 'COMPANY_ID_MISSING' });
      }
      continue;
    }
    if (acceptedCompanyIds.has(companyId)) {
      incrementReason(exclusionReasonCounts, 'DUPLICATE_ACCEPTED_COMPANY_ID');
      if (excluded.length < MAX_COVERAGE_DIAGNOSTIC_ITEMS) {
        excluded.push({ companyId, symbol: symbolFromDossier(dossier), reason: 'DUPLICATE_ACCEPTED_COMPANY_ID' });
      }
      continue;
    }
    const series = historicalSeries.get(companyId);
    if (!series) {
      incrementReason(exclusionReasonCounts, 'HISTORICAL_SERIES_MISSING');
      if (excluded.length < MAX_COVERAGE_DIAGNOSTIC_ITEMS) {
        excluded.push({ companyId, symbol: symbolFromDossier(dossier), reason: 'HISTORICAL_SERIES_MISSING' });
      }
      continue;
    }
    if (!Array.isArray(series.candles) || !series.candles.length) {
      incrementReason(exclusionReasonCounts, 'HISTORICAL_CANDLES_MISSING_OR_EMPTY');
      if (excluded.length < MAX_COVERAGE_DIAGNOSTIC_ITEMS) {
        excluded.push({ companyId, symbol: symbolFromDossier(dossier), reason: 'HISTORICAL_CANDLES_MISSING_OR_EMPTY' });
      }
      continue;
    }
    const benchmark = benchmarkSeries.get(companyId) || null;
    acceptedCompanyIds.add(companyId);
    candidates.push({
      instrumentId: String(dossier?.instrumentProfile?.instrumentId || companyId),
      companyId,
      symbol: symbolFromDossier(dossier),
      assetClass: assetClassFromDossier(dossier),
      series,
      benchmarkSeries: benchmark,
    });
  }

  candidates.sort((left, right) =>
    Number(right.series?.candles?.length || 0) - Number(left.series?.candles?.length || 0) ||
    String(left.companyId).localeCompare(String(right.companyId)),
  );

  const selectedInstruments = candidates.slice(0, maximumInstrumentCount);
  const omittedByBound = candidates.slice(maximumInstrumentCount);
  const loadedHistoriesWithoutDossier = [];
  let loadedHistoryWithoutDossierCount = 0;
  for (const [companyId, series] of historicalSeries.entries()) {
    if (dossierCompanyIds.has(String(companyId))) continue;
    loadedHistoryWithoutDossierCount += 1;
    if (loadedHistoriesWithoutDossier.length < MAX_COVERAGE_DIAGNOSTIC_ITEMS) {
      loadedHistoriesWithoutDossier.push(safeHistoryIdentity(companyId, series));
    }
  }

  const eligibleWithBenchmarkCount = candidates.filter((candidate) =>
    candidate?.benchmarkSeries && Array.isArray(candidate.benchmarkSeries.candles) && candidate.benchmarkSeries.candles.length,
  ).length;

  const universeCoverage = {
    format: 'investor-control-historical-walk-forward-universe-coverage',
    version: 1,
    contract: FORECAST_HISTORICAL_UNIVERSE_COVERAGE_CONTRACT,
    maximumInstrumentCount,
    dossierCount: dossiers.length,
    uniqueDossierCompanyCount: dossierCompanyIds.size,
    loadedHistoricalSeriesCount: historicalSeries.size,
    loadedBenchmarkSeriesCount: benchmarkSeries.size,
    eligibleInstrumentCount: candidates.length,
    selectedInstrumentCount: selectedInstruments.length,
    omittedByBoundCount: omittedByBound.length,
    excludedDossierCount: Object.values(exclusionReasonCounts).reduce((sum, count) => sum + count, 0),
    loadedHistoryWithoutDossierCount,
    eligibleWithBenchmarkCount,
    eligibleWithoutBenchmarkCount: candidates.length - eligibleWithBenchmarkCount,
    exclusionReasonCounts,
    historyLengthCandles: historyLengthSummary(candidates),
    selectedInstruments: selectedInstruments.map(candidateIdentity),
    omittedByBound: omittedByBound.slice(0, MAX_COVERAGE_DIAGNOSTIC_ITEMS).map(candidateIdentity),
    excludedDossiers: excluded,
    loadedHistoriesWithoutDossier,
    diagnosticsTruncated: {
      excludedDossiers: Object.values(exclusionReasonCounts).reduce((sum, count) => sum + count, 0) > excluded.length,
      omittedByBound: omittedByBound.length > MAX_COVERAGE_DIAGNOSTIC_ITEMS,
      loadedHistoriesWithoutDossier: loadedHistoryWithoutDossierCount > loadedHistoriesWithoutDossier.length,
    },
    rawHistoricalCandlesIncluded: false,
    selectionRulesChanged: false,
    thresholdsChanged: false,
    networkFetchPerformed: false,
    historicalResearchOnly: true,
    decisionImpact: 'NONE',
  };

  return {
    maximumInstrumentCount,
    eligibleInstrumentCount: candidates.length,
    selectedInstruments,
    selectedInstrumentCount: selectedInstruments.length,
    omittedInstrumentCount: omittedByBound.length,
    universeCoverage,
  };
}

function disabledStatus(input = {}) {
  return {
    format: 'investor-control-cross-sectional-regime-walk-forward-runtime-status',
    version: 1,
    runtimePolicyVersion: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RUNTIME_VERSION,
    runtimeContract: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RUNTIME_CONTRACT,
    researchPolicyVersion: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_VERSION,
    researchContract: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_CONTRACT,
    evidenceClass: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_EVIDENCE_CLASS,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    executionState: 'DISABLED_BY_CADENCE',
    status: 'HISTORICAL_RESEARCH_NOT_EXECUTED',
    cadenceRequested: false,
    eligibleInstrumentCount: 0,
    selectedInstrumentCount: 0,
    omittedInstrumentCount: 0,
    generatedRecordCount: 0,
    validRegimeRecordCount: 0,
    groupCount: 0,
    readyGroupCount: 0,
    universeCoverage: null,
    research: null,
    rawHistoricalRecordExported: false,
    networkFetchPerformedByRuntime: false,
    liveArchiveEligible: false,
    liveCalibrationEligible: false,
    factorWeightGovernanceEligible: false,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

export function buildCrossSectionalRegimeWalkForwardRuntimeStatus(input = {}) {
  if (input.enabled !== true) return disabledStatus(input);

  const set = buildHistoricalWalkForwardRuntimeInstrumentSet({
    researchDossiers: input.researchDossiers,
    historicalSeriesByCompany: input.historicalSeriesByCompany,
    benchmarkSeriesByCompany: input.benchmarkSeriesByCompany,
    maximumInstrumentCount: input.maximumInstrumentCount,
  });
  const research = buildCrossSectionalRegimeWalkForwardResearch({
    generatedAt: input.generatedAt,
    instruments: set.selectedInstruments,
    options: {
      ...(input.options || {}),
      includeAuditSamples: false,
    },
  });

  return {
    format: 'investor-control-cross-sectional-regime-walk-forward-runtime-status',
    version: 1,
    runtimePolicyVersion: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RUNTIME_VERSION,
    runtimeContract: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RUNTIME_CONTRACT,
    researchPolicyVersion: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_VERSION,
    researchContract: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_CONTRACT,
    evidenceClass: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_EVIDENCE_CLASS,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    executionState: 'ENABLED_RESEARCH_ONLY',
    status: research.status,
    cadenceRequested: true,
    maximumInstrumentCount: set.maximumInstrumentCount,
    eligibleInstrumentCount: set.eligibleInstrumentCount,
    selectedInstrumentCount: set.selectedInstrumentCount,
    omittedInstrumentCount: set.omittedInstrumentCount,
    generatedRecordCount: research.generatedRecordCount,
    validRegimeRecordCount: research.validRegimeRecordCount,
    groupCount: research.groupCount,
    readyGroupCount: research.readyGroupCount,
    universeCoverage: set.universeCoverage,
    research,
    rawHistoricalRecordExported: false,
    networkFetchPerformedByRuntime: false,
    liveArchiveEligible: false,
    liveCalibrationEligible: false,
    factorWeightGovernanceEligible: false,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}
