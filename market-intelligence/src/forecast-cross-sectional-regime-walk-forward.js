import { normalizeHistoricalSeries } from './historical-pattern-engine.js';
import { runHistoricalPatternWalkForward } from './walk-forward-validator.js';
import { evaluateForecastCalibration } from './forecast-calibration.js';
import { buildForecastMarketRegimeSnapshot, validateForecastMarketRegimeSnapshot } from './forecast-market-regime.js';
import { evaluateOosSampleIndependence } from './forecast-oos-sample-independence.js';
import { evaluateOosOutcomeWindowIndependence } from './forecast-oos-outcome-window-independence.js';
import { evaluateOosInstrumentConcentration } from './forecast-oos-instrument-concentration.js';

export const FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_VERSION = '2026-08-13.1';
export const FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_CONTRACT = 'CROSS_SECTIONAL_HISTORICAL_REGIME_WALK_FORWARD_RESEARCH_V1';
export const FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_EVIDENCE_CLASS = 'HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH';

function iso(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function instrumentIdentity(input = {}) {
  const instrumentId = String(input.instrumentId || input.companyId || '').trim() || null;
  const companyId = String(input.companyId || input.instrumentId || '').trim() || null;
  const symbol = String(input.symbol || input.series?.providerSymbol || input.series?.symbol || '').trim() || null;
  return { instrumentId, companyId, symbol };
}

function candleByIso(candles = []) {
  const map = new Map();
  for (const candle of candles) {
    if (!Number.isFinite(candle?.timestamp)) continue;
    map.set(new Date(candle.timestamp * 1000).toISOString(), candle);
  }
  return map;
}

function referenceAndOutcome(series, record) {
  const candles = normalizeHistoricalSeries(series || { candles: [] });
  const byIso = candleByIso(candles);
  const forecastAt = iso(record?.forecastAt);
  const outcomeAt = iso(record?.outcomeKnownAt);
  const start = forecastAt ? byIso.get(forecastAt) : null;
  const end = outcomeAt ? byIso.get(outcomeAt) : null;
  if (!forecastAt || !outcomeAt || !start || !end || !Number.isFinite(start.close) || !Number.isFinite(end.close) || end.close <= 0 || start.close <= 0) return null;
  return {
    forecastAt,
    outcomeAt,
    referencePrice: {
      value: start.close,
      timestamp: forecastAt,
      currency: null,
      source: 'HISTORICAL_WALK_FORWARD_SERIES',
    },
    realisedOutcome: {
      timestamp: outcomeAt,
      close: end.close,
      realisedReturnPct: finite(record?.realizedReturnPct),
    },
  };
}

function buildHistoricalResearchRecord(instrument, walkForwardRecord, options = {}) {
  const identity = instrumentIdentity(instrument);
  if (!identity.instrumentId) return { record: null, blocker: 'HISTORICAL_WALK_FORWARD_INSTRUMENT_ID_REQUIRED' };
  const times = referenceAndOutcome(instrument.series, walkForwardRecord);
  if (!times) return { record: null, blocker: 'HISTORICAL_WALK_FORWARD_OUTCOME_WINDOW_INVALID' };
  const tradingDays = positiveInteger(walkForwardRecord?.tradingDays);
  if (!tradingDays) return { record: null, blocker: 'HISTORICAL_WALK_FORWARD_TRADING_DAYS_INVALID' };

  const provisional = {
    forecastId: `historical-regime-wf:${identity.instrumentId}:${walkForwardRecord.horizon}:${times.forecastAt}`,
    evidenceClass: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_EVIDENCE_CLASS,
    validationMode: 'WALK_FORWARD_OOS',
    historicalPatternPolicyVersion: walkForwardRecord.historicalPatternPolicyVersion || null,
    instrumentId: identity.instrumentId,
    companyId: identity.companyId,
    symbol: identity.symbol,
    assetClass: instrument.assetClass || walkForwardRecord.assetClass || 'UNKNOWN',
    horizon: walkForwardRecord.horizon,
    tradingDays,
    forecastAt: times.forecastAt,
    forecastSampleDate: times.forecastAt.slice(0, 10),
    outcomeKnownAt: times.outcomeAt,
    referencePrice: times.referencePrice,
    rawProbabilityPositive: finite(walkForwardRecord.rawProbabilityPositive),
    expectedReturnPct: finite(walkForwardRecord.expectedReturnPct),
    positiveOutcome: walkForwardRecord.positiveOutcome === 0 || walkForwardRecord.positiveOutcome === 1 ? walkForwardRecord.positiveOutcome : null,
    realisedOutcome: times.realisedOutcome,
    patternConfidenceScore: finite(walkForwardRecord.patternConfidenceScore),
    selectedAnalogCount: Number(walkForwardRecord.selectedAnalogCount || 0),
    effectiveSampleSize: finite(walkForwardRecord.effectiveSampleSize),
    historicalResearchOnly: true,
    liveArchiveEligible: false,
    liveCalibrationEligible: false,
    factorWeightGovernanceEligible: false,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };

  if (!instrument.benchmarkSeries) return { record: { ...provisional, regimeStatus: 'REGIME_NOT_AVAILABLE', regimeBlockers: ['HISTORICAL_BENCHMARK_SERIES_REQUIRED'] }, blocker: null };
  const regime = buildForecastMarketRegimeSnapshot({
    series: instrument.benchmarkSeries,
    capturedAt: times.forecastAt,
    benchmarkSymbol: instrument.benchmarkSeries.providerSymbol || instrument.benchmarkSeries.symbol || options.benchmarkSymbol || null,
    minimumObservations: options.marketRegimeMinimumObservations || 200,
  });
  const validation = validateForecastMarketRegimeSnapshot(regime, provisional);
  if (!validation.ok) {
    return {
      record: {
        ...provisional,
        regimeStatus: 'REGIME_NOT_AVAILABLE',
        regimeBlockers: [...new Set([...(regime.blockers || []), ...validation.errors])],
      },
      blocker: null,
    };
  }
  return {
    record: {
      ...provisional,
      regimeStatus: 'REGIME_READY',
      marketRegimeSnapshot: regime,
      regimeKey: regime.regimeKey,
    },
    blocker: null,
  };
}

function compactAuditRecord(record = {}) {
  return {
    forecastId: record.forecastId || null,
    evidenceClass: record.evidenceClass || null,
    validationMode: record.validationMode || null,
    instrumentId: record.instrumentId || null,
    assetClass: record.assetClass || 'UNKNOWN',
    horizon: record.horizon || null,
    tradingDays: record.tradingDays || null,
    forecastAt: record.forecastAt || null,
    forecastSampleDate: record.forecastSampleDate || null,
    outcomeKnownAt: record.outcomeKnownAt || null,
    referencePrice: record.referencePrice ? { ...record.referencePrice } : null,
    rawProbabilityPositive: record.rawProbabilityPositive ?? null,
    positiveOutcome: record.positiveOutcome ?? null,
    realisedOutcome: record.realisedOutcome ? { ...record.realisedOutcome } : null,
    regimeStatus: record.regimeStatus || null,
    regimeKey: record.regimeKey || null,
    marketRegimeSnapshot: record.marketRegimeSnapshot ? {
      contract: record.marketRegimeSnapshot.contract,
      policyVersion: record.marketRegimeSnapshot.policyVersion,
      capturedAt: record.marketRegimeSnapshot.capturedAt,
      benchmarkAsOf: record.marketRegimeSnapshot.benchmarkAsOf,
      benchmarkSymbol: record.marketRegimeSnapshot.benchmarkSymbol,
      regimeKey: record.marketRegimeSnapshot.regimeKey,
      riskTone: record.marketRegimeSnapshot.riskTone,
      trendRegime: record.marketRegimeSnapshot.trendRegime,
      momentumRegime: record.marketRegimeSnapshot.momentumRegime,
      volatilityRegime: record.marketRegimeSnapshot.volatilityRegime,
      decisionImpact: record.marketRegimeSnapshot.decisionImpact,
    } : null,
    historicalResearchOnly: record.historicalResearchOnly === true,
    liveArchiveEligible: record.liveArchiveEligible === true,
    liveCalibrationEligible: record.liveCalibrationEligible === true,
    finalActionEligible: record.finalActionEligible === true,
    brokerExecutionEligible: record.brokerExecutionEligible === true,
    decisionImpact: record.decisionImpact || null,
  };
}

function groupKey(record = {}) {
  return [record.historicalPatternPolicyVersion || 'NO_PATTERN_VERSION', record.assetClass || 'UNKNOWN', record.horizon || 'UNKNOWN', record.regimeKey || 'NO_REGIME'].join('|');
}

function evaluateResearchGroup(records = [], options = {}) {
  const sampleIndependence = evaluateOosSampleIndependence(records, {
    minimumDistinctForecastDates: options.minimumDistinctForecastDates ?? 30,
    minimumDistinctInstruments: options.minimumDistinctInstruments ?? 8,
    maximumSingleForecastDateSharePct: options.maximumSingleForecastDateSharePct ?? 15,
  });
  const outcomeWindowIndependence = evaluateOosOutcomeWindowIndependence(records, {
    minimumEffectiveNonOverlappingWindows: options.minimumEffectiveNonOverlappingWindows ?? 12,
  });
  const instrumentConcentration = evaluateOosInstrumentConcentration(records, {
    maximumSingleInstrumentSharePct: options.maximumSingleInstrumentSharePct ?? 25,
    minimumEffectiveInstrumentCount: options.minimumEffectiveInstrumentCount ?? 5,
  });
  const calibration = evaluateForecastCalibration(records, {
    minimumTotal: options.minimumCalibrationSample ?? 60,
    binCount: options.calibrationBinCount ?? 8,
  });
  const blockers = [
    ...sampleIndependence.blockers,
    ...outcomeWindowIndependence.blockers,
    ...instrumentConcentration.blockers,
    ...(calibration.status === 'OOS_METRICS_READY' ? [] : ['HISTORICAL_REGIME_WALK_FORWARD_CALIBRATION_NOT_READY']),
  ];
  const uniqueBlockers = [...new Set(blockers)];
  return {
    historicalPatternPolicyVersion: records[0]?.historicalPatternPolicyVersion || null,
    assetClass: records[0]?.assetClass || 'UNKNOWN',
    horizon: records[0]?.horizon || 'UNKNOWN',
    regimeKey: records[0]?.regimeKey || null,
    riskTone: records[0]?.marketRegimeSnapshot?.riskTone || null,
    trendRegime: records[0]?.marketRegimeSnapshot?.trendRegime || null,
    volatilityRegime: records[0]?.marketRegimeSnapshot?.volatilityRegime || null,
    momentumRegime: records[0]?.marketRegimeSnapshot?.momentumRegime || null,
    status: uniqueBlockers.length ? 'HISTORICAL_REGIME_RESEARCH_NOT_READY' : 'HISTORICAL_REGIME_RESEARCH_READY',
    sampleSize: records.length,
    sampleIndependence,
    outcomeWindowIndependence,
    instrumentConcentration,
    calibration,
    blockers: uniqueBlockers,
    historicalResearchOnly: true,
    liveArchiveEligible: false,
    liveCalibrationEligible: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    decisionImpact: 'NONE',
  };
}

export function buildCrossSectionalRegimeWalkForwardResearch(input = {}) {
  const instruments = Array.isArray(input.instruments) ? input.instruments : [];
  const options = input.options || {};
  const allRecords = [];
  const instrumentSummaries = [];
  const diagnostics = [];

  for (const instrument of instruments) {
    const identity = instrumentIdentity(instrument);
    if (!identity.instrumentId) {
      diagnostics.push({ code: 'HISTORICAL_WALK_FORWARD_INSTRUMENT_ID_REQUIRED', instrumentId: null });
      continue;
    }
    const normalized = normalizeHistoricalSeries(instrument.series || { candles: [] });
    if (normalized.length < Math.max(260, Number(options.minimumInstrumentObservations || 260))) {
      diagnostics.push({ code: 'HISTORICAL_WALK_FORWARD_SERIES_TOO_SHORT', instrumentId: identity.instrumentId, observationCount: normalized.length });
      instrumentSummaries.push({ instrumentId: identity.instrumentId, observationCount: normalized.length, generatedRecordCount: 0 });
      continue;
    }
    const walkForward = runHistoricalPatternWalkForward({
      instrumentId: identity.instrumentId,
      assetClass: instrument.assetClass || 'UNKNOWN',
      series: { candles: normalized },
      horizons: options.horizons || { week1: 5, month1: 21 },
      warmupObservations: options.warmupObservations ?? 260,
      evaluationStep: options.evaluationStep ?? 5,
      minimumForecastsForMetrics: options.minimumForecastsForMetrics ?? 20,
      minAnalogCount: options.minAnalogCount ?? 5,
      maxAnalogs: options.maxAnalogs ?? 40,
      minEffectiveSample: options.minEffectiveSample ?? 4,
      sameRegimeOnly: options.sameInstrumentTrendRegimeOnly !== false,
      minimumHistory: options.minimumHistory ?? 200,
      minimumAnchorSpacing: options.minimumAnchorSpacing,
      periodsPerYear: options.periodsPerYear ?? 252,
      generatedAt: input.generatedAt,
    });
    let generatedRecordCount = 0;
    for (const horizon of Object.values(walkForward.horizons || {})) {
      for (const walkForwardRecord of horizon.records || []) {
        const built = buildHistoricalResearchRecord(instrument, walkForwardRecord, options);
        if (built.blocker) {
          diagnostics.push({ code: built.blocker, instrumentId: identity.instrumentId, horizon: walkForwardRecord.horizon, forecastAt: walkForwardRecord.forecastAt });
          continue;
        }
        if (!built.record) continue;
        allRecords.push(built.record);
        generatedRecordCount += 1;
      }
    }
    instrumentSummaries.push({
      instrumentId: identity.instrumentId,
      assetClass: instrument.assetClass || 'UNKNOWN',
      observationCount: normalized.length,
      generatedRecordCount,
      walkForwardStatus: walkForward.status,
    });
  }

  const validRegimeRecords = allRecords.filter((record) => record.regimeStatus === 'REGIME_READY' && record.regimeKey);
  const groupsMap = new Map();
  for (const record of validRegimeRecords) {
    const key = groupKey(record);
    const items = groupsMap.get(key) || [];
    items.push(record);
    groupsMap.set(key, items);
  }
  const groups = [...groupsMap.values()]
    .map((records) => evaluateResearchGroup(records, options))
    .sort((left, right) => [left.historicalPatternPolicyVersion, left.assetClass, left.horizon, left.regimeKey].join('|')
      .localeCompare([right.historicalPatternPolicyVersion, right.assetClass, right.horizon, right.regimeKey].join('|')));
  const readyGroupCount = groups.filter((group) => group.status === 'HISTORICAL_REGIME_RESEARCH_READY').length;
  const auditSampleLimit = options.includeAuditSamples === true
    ? Math.max(1, Math.min(25, Math.floor(Number(options.auditSampleLimit || 12))))
    : 0;
  const auditSampleRecords = auditSampleLimit ? allRecords.slice(0, auditSampleLimit).map(compactAuditRecord) : [];

  return {
    format: 'investor-control-cross-sectional-regime-walk-forward-research',
    version: 1,
    policyVersion: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_VERSION,
    contract: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_CONTRACT,
    evidenceClass: FORECAST_CROSS_SECTIONAL_REGIME_WALK_FORWARD_EVIDENCE_CLASS,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    status: readyGroupCount ? 'HISTORICAL_RESEARCH_READY_GROUPS_EXIST' : 'HISTORICAL_RESEARCH_ONLY',
    instrumentCount: instruments.length,
    evaluatedInstrumentCount: instrumentSummaries.length,
    generatedRecordCount: allRecords.length,
    validRegimeRecordCount: validRegimeRecords.length,
    regimeUnavailableRecordCount: allRecords.length - validRegimeRecords.length,
    groupCount: groups.length,
    readyGroupCount,
    instrumentSummaries,
    groups,
    diagnostics,
    auditSampleRecords,
    methodology: {
      validationMode: 'WALK_FORWARD_OOS',
      instrumentForecastBoundary: 'EACH_INSTRUMENT_FORECAST_USES_ONLY_ITS_OWN_HISTORY_AVAILABLE_AT_FORECAST_AT',
      regimeBoundary: 'BENCHMARK_REGIME_RECONSTRUCTED_USING_ONLY_BENCHMARK_DATA_AT_OR_BEFORE_FORECAST_AT',
      crossSectionalPooling: 'POOL_ONLY_AFTER_PER_INSTRUMENT_FORECAST_GENERATION',
      historicalClassificationBackfillAllowed: false,
      liveArchiveWriteAllowed: false,
      liveCalibrationUseAllowed: false,
      rawHistoricalRecordExportDefault: 'DISABLED',
    },
    historicalResearchOnly: true,
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
