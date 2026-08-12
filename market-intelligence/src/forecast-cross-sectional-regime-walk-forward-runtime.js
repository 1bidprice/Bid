import {
  buildCrossSectionalRegimeWalkForwardResearch,
  FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_CONTRACT,
  FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_EVIDENCE_CLASS,
  FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_VERSION,
} from './forecast-cross-sectional-regime-walk-forward.js';

export const FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RUNTIME_VERSION = '2026-08-13.1';
export const FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RUNTIME_CONTRACT = 'BOUNDED_CADENCE_CONTROLLED_HISTORICAL_RESEARCH_RUNTIME_V1';

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

export function buildHistoricalWalkForwardRuntimeInstrumentSet(input = {}) {
  const historicalSeries = safeMap(input.historicalSeriesByCompany);
  const benchmarkSeries = safeMap(input.benchmarkSeriesByCompany);
  const dossiers = Array.isArray(input.researchDossiers) ? input.researchDossiers : [];
  const maximumInstrumentCount = integer(input.maximumInstrumentCount, 24, 2, 40);
  const candidates = [];
  const seen = new Set();

  for (const dossier of dossiers) {
    const companyId = companyIdFromDossier(dossier);
    if (!companyId || seen.has(companyId)) continue;
    const series = historicalSeries.get(companyId);
    if (!series || !Array.isArray(series.candles) || !series.candles.length) continue;
    const benchmark = benchmarkSeries.get(companyId) || null;
    seen.add(companyId);
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
  return {
    maximumInstrumentCount,
    eligibleInstrumentCount: candidates.length,
    selectedInstruments: candidates.slice(0, maximumInstrumentCount),
    selectedInstrumentCount: Math.min(candidates.length, maximumInstrumentCount),
    omittedInstrumentCount: Math.max(0, candidates.length - maximumInstrumentCount),
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
