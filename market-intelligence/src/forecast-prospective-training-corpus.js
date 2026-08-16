import { normalizeHistoricalSeries } from './historical-pattern-engine.js';
import { runHistoricalPatternWalkForward } from './walk-forward-validator.js';
import { buildHistoricalMarketFactorSnapshot, HISTORICAL_MARKET_FACTOR_VERSION } from './forecast-historical-market-factor.js';
import { buildForecastMarketRegimeSnapshot, validateForecastMarketRegimeSnapshot } from './forecast-market-regime.js';

export const PROSPECTIVE_TRAINING_CORPUS_CONTRACT = 'PROSPECTIVE_FROZEN_HISTORICAL_TRAINING_CORPUS_V1';
export const PROSPECTIVE_TRAINING_CORPUS_VERSION = '2026-08-16.1';
export const PROSPECTIVE_TRAINING_CORPUS_REFERENCE_SOURCE_COMMIT = '0e13074f1e8d89c5f52f3825c07203f0e62f20a8';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function iso(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
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

function buildTrainingRecord(instrument, walkForwardRecord, options = {}) {
  const identity = instrumentIdentity(instrument);
  if (!identity.instrumentId) return { record: null, blocker: 'HISTORICAL_WALK_FORWARD_INSTRUMENT_ID_REQUIRED' };
  const times = referenceAndOutcome(instrument.series, walkForwardRecord);
  if (!times) return { record: null, blocker: 'HISTORICAL_WALK_FORWARD_OUTCOME_WINDOW_INVALID' };
  const tradingDays = Number(walkForwardRecord?.tradingDays);
  if (!Number.isInteger(tradingDays) || tradingDays <= 0) return { record: null, blocker: 'HISTORICAL_WALK_FORWARD_TRADING_DAYS_INVALID' };

  const assetClass = instrument.assetClass || walkForwardRecord.assetClass || 'UNKNOWN';
  const factor = buildHistoricalMarketFactorSnapshot({
    instrumentId: identity.instrumentId,
    companyId: identity.companyId,
    symbol: identity.symbol,
    assetClass,
    horizon: walkForwardRecord.horizon,
    forecastAt: times.forecastAt,
    series: instrument.series || {},
    benchmarkSeries: instrument.benchmarkSeries || {},
    benchmarkSymbol: instrument.benchmarkSeries?.providerSymbol || instrument.benchmarkSeries?.symbol || options.benchmarkSymbol || null,
  });

  const provisional = {
    forecastId: `historical-regime-wf:${identity.instrumentId}:${walkForwardRecord.horizon}:${times.forecastAt}`,
    evidenceClass: 'HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH',
    validationMode: 'WALK_FORWARD_OOS',
    status: 'MATURED',
    historicalPatternPolicyVersion: walkForwardRecord.historicalPatternPolicyVersion || null,
    historicalMarketFactorPolicyVersion: HISTORICAL_MARKET_FACTOR_VERSION,
    historicalMarketFactorStatus: factor.status,
    historicalMarketFactorScore: finite(factor.historicalMarketFactorScore),
    historicalMarketFactorSnapshot: factor,
    instrumentId: identity.instrumentId,
    companyId: identity.companyId,
    symbol: identity.symbol,
    assetClass,
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

  if (!instrument.benchmarkSeries) {
    return {
      record: { ...provisional, regimeStatus: 'REGIME_NOT_AVAILABLE', regimeBlockers: ['HISTORICAL_BENCHMARK_SERIES_REQUIRED'] },
      blocker: null,
    };
  }
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

export function buildProspectiveFrozenTrainingCorpus(input = {}) {
  const instruments = Array.isArray(input.instruments) ? input.instruments : [];
  const options = input.options || {};
  const allRecords = [];
  const diagnostics = [];
  const instrumentSummaries = [];

  for (const instrument of instruments) {
    const identity = instrumentIdentity(instrument);
    if (!identity.instrumentId) {
      diagnostics.push({ code: 'HISTORICAL_WALK_FORWARD_INSTRUMENT_ID_REQUIRED', instrumentId: null });
      continue;
    }
    const normalized = normalizeHistoricalSeries(instrument.series || { candles: [] });
    if (normalized.length < Math.max(260, Number(options.minimumInstrumentObservations || 260))) {
      diagnostics.push({ code: 'HISTORICAL_WALK_FORWARD_SERIES_TOO_SHORT', instrumentId: identity.instrumentId, observationCount: normalized.length });
      instrumentSummaries.push({ instrumentId: identity.instrumentId, observationCount: normalized.length, generatedRecordCount: 0, validRegimeRecordCount: 0 });
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
    let validRegimeRecordCount = 0;
    for (const horizon of Object.values(walkForward.horizons || {})) {
      for (const walkForwardRecord of horizon.records || []) {
        const built = buildTrainingRecord(instrument, walkForwardRecord, options);
        if (built.blocker) {
          diagnostics.push({ code: built.blocker, instrumentId: identity.instrumentId, horizon: walkForwardRecord.horizon, forecastAt: walkForwardRecord.forecastAt });
          continue;
        }
        if (!built.record) continue;
        allRecords.push(built.record);
        generatedRecordCount += 1;
        if (built.record.regimeStatus === 'REGIME_READY' && built.record.regimeKey) validRegimeRecordCount += 1;
      }
    }
    instrumentSummaries.push({
      instrumentId: identity.instrumentId,
      assetClass: instrument.assetClass || 'UNKNOWN',
      observationCount: normalized.length,
      generatedRecordCount,
      validRegimeRecordCount,
      walkForwardStatus: walkForward.status,
    });
  }

  const validRegimeRecords = allRecords.filter((record) => record.regimeStatus === 'REGIME_READY' && record.regimeKey);
  return {
    contract: PROSPECTIVE_TRAINING_CORPUS_CONTRACT,
    policyVersion: PROSPECTIVE_TRAINING_CORPUS_VERSION,
    referenceSourceCommit: PROSPECTIVE_TRAINING_CORPUS_REFERENCE_SOURCE_COMMIT,
    instrumentCount: instruments.length,
    generatedRecordCount: allRecords.length,
    validRegimeRecordCount: validRegimeRecords.length,
    regimeCoveragePct: allRecords.length ? Number(((validRegimeRecords.length / allRecords.length) * 100).toFixed(4)) : 0,
    records: validRegimeRecords,
    instrumentSummaries,
    diagnostics,
    internalTrainingOnly: true,
    rawRecordsMayBePublished: false,
    rawHistoricalCandlesIncluded: false,
    prospectiveResearchOnly: true,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}
