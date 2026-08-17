import { buildHistoricalPatternForecast } from './historical-pattern-engine.js';
import { buildHistoricalMarketFactorSnapshot, HISTORICAL_MARKET_FACTOR_VERSION } from './forecast-historical-market-factor.js';
import { buildForecastMarketRegimeSnapshot, validateForecastMarketRegimeSnapshot } from './forecast-market-regime.js';

export const PROSPECTIVE_TARGET_BUILDER_CONTRACT = 'PROSPECTIVE_FROZEN_TARGET_FEATURE_BUILDER_V1';
export const PROSPECTIVE_TARGET_BUILDER_VERSION = '2026-08-17.1';

function latestCandle(series = {}) {
  const candles = Array.isArray(series?.candles) ? series.candles : [];
  return candles.filter((candle) => Number.isFinite(Number(candle?.timestamp))).sort((a, b) => Number(a.timestamp) - Number(b.timestamp)).at(-1) || null;
}

function isoFromSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return new Date(number * 1000).toISOString();
}

export function latestCompletedSessionIso(series = {}) {
  return isoFromSeconds(latestCandle(series)?.timestamp);
}

export function latestCompletedSessionDate(series = {}) {
  return latestCompletedSessionIso(series)?.slice(0, 10) || null;
}

export function buildProspectiveFrozenTarget(input = {}) {
  const company = input.company || {};
  const series = input.series || {};
  const benchmarkSeries = input.benchmarkSeries || {};
  const horizon = String(input.horizon || '').trim();
  const tradingDays = Math.max(1, Math.trunc(Number(input.tradingDays || 0)));
  const instrumentId = String(company.companyId || input.instrumentId || '').trim() || null;
  const symbol = String(company.primaryListing?.symbol || input.symbol || series.providerSymbol || series.symbol || '').trim() || null;
  const assetClass = String(input.assetClass || 'EQUITY');
  const forecastAt = latestCompletedSessionIso(series);
  const blockers = [];

  if (!instrumentId) blockers.push('PROSPECTIVE_TARGET_INSTRUMENT_ID_REQUIRED');
  if (!symbol) blockers.push('PROSPECTIVE_TARGET_SYMBOL_REQUIRED');
  if (!horizon) blockers.push('PROSPECTIVE_TARGET_HORIZON_REQUIRED');
  if (!forecastAt) blockers.push('PROSPECTIVE_TARGET_COMPLETED_SESSION_REQUIRED');

  const pattern = forecastAt ? buildHistoricalPatternForecast({
    instrumentId,
    assetClass,
    series,
    asOfTimestamp: Date.parse(forecastAt) / 1000,
    horizons: { [horizon]: tradingDays },
    periodsPerYear: input.periodsPerYear || 252,
    minimumHistory: input.minimumHistory || 200,
    minAnalogCount: input.minAnalogCount || 5,
    maxAnalogs: input.maxAnalogs || 40,
    minEffectiveSample: input.minEffectiveSample || 4,
    sameRegimeOnly: input.sameRegimeOnly !== false,
    minimumAnchorSpacing: input.minimumAnchorSpacing || tradingDays,
  }) : null;
  const horizonForecast = pattern?.horizons?.[horizon] || null;
  if (horizonForecast?.status !== 'RESEARCH_READY_UNCALIBRATED') blockers.push('PROSPECTIVE_TARGET_PATTERN_NOT_READY');

  const marketFactor = forecastAt ? buildHistoricalMarketFactorSnapshot({
    instrumentId,
    companyId: instrumentId,
    symbol,
    assetClass,
    horizon,
    forecastAt,
    series,
    benchmarkSeries,
    benchmarkSymbol: benchmarkSeries?.providerSymbol || benchmarkSeries?.symbol || 'SPY',
  }) : null;
  if (marketFactor?.status !== 'HISTORICAL_MARKET_FACTOR_READY') blockers.push('PROSPECTIVE_TARGET_MARKET_FACTOR_NOT_READY');

  const regime = forecastAt ? buildForecastMarketRegimeSnapshot({
    series: benchmarkSeries,
    capturedAt: forecastAt,
    benchmarkSymbol: benchmarkSeries?.providerSymbol || benchmarkSeries?.symbol || 'SPY',
    minimumObservations: input.marketRegimeMinimumObservations || 200,
  }) : null;
  const regimeValidation = regime ? validateForecastMarketRegimeSnapshot(regime, { forecastAt }) : { ok: false, errors: ['MARKET_REGIME_SNAPSHOT_REQUIRED'] };
  if (!regimeValidation.ok) blockers.push('PROSPECTIVE_TARGET_REGIME_NOT_READY');

  const target = {
    forecastId: forecastAt && instrumentId && horizon ? `prospective:${instrumentId}:${horizon}:${forecastAt}` : null,
    historicalPatternPolicyVersion: pattern?.policyVersion || null,
    historicalMarketFactorPolicyVersion: HISTORICAL_MARKET_FACTOR_VERSION,
    historicalMarketFactorStatus: marketFactor?.status || 'HISTORICAL_MARKET_FACTOR_BLOCKED',
    historicalMarketFactorScore: marketFactor?.historicalMarketFactorScore ?? null,
    historicalMarketFactorSnapshot: marketFactor,
    instrumentId,
    companyId: instrumentId,
    symbol,
    assetClass,
    horizon,
    tradingDays,
    forecastAt,
    rawProbabilityPositive: horizonForecast?.rawProbabilityPositive ?? null,
    expectedReturnPct: horizonForecast?.expectedReturnPct ?? null,
    regimeStatus: regimeValidation.ok ? 'REGIME_READY' : 'REGIME_NOT_AVAILABLE',
    regimeKey: regimeValidation.ok ? regime.regimeKey : null,
    marketRegimeSnapshot: regimeValidation.ok ? regime : null,
    prospectiveResearchOnly: true,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };

  return {
    contract: PROSPECTIVE_TARGET_BUILDER_CONTRACT,
    policyVersion: PROSPECTIVE_TARGET_BUILDER_VERSION,
    status: blockers.length ? 'PROSPECTIVE_TARGET_NOT_READY' : 'PROSPECTIVE_TARGET_READY',
    ready: blockers.length === 0,
    target,
    companyLatestCompletedSession: latestCompletedSessionIso(series),
    benchmarkLatestCompletedSession: latestCompletedSessionIso(benchmarkSeries),
    blockers: [...new Set(blockers)],
    targetContainsOutcome: false,
    prospectiveResearchOnly: true,
    decisionImpact: 'NONE',
  };
}
