import { normalizeHistoricalSeries } from './historical-pattern-engine.js';

export const FORECAST_MARKET_REGIME_VERSION = '2026-08-12.1';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function mean(values = []) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function sampleStandardDeviation(values = []) {
  const valid = values.filter(Number.isFinite);
  if (valid.length < 2) return null;
  const average = mean(valid);
  const variance = valid.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (valid.length - 1);
  return Math.sqrt(variance);
}

function simpleReturn(closes, periods) {
  if (closes.length <= periods) return null;
  const start = closes[closes.length - periods - 1];
  const end = closes.at(-1);
  return start > 0 && end > 0 ? ((end / start) - 1) * 100 : null;
}

function movingAverage(closes, periods) {
  if (closes.length < periods) return null;
  return mean(closes.slice(-periods));
}

function annualizedVolatilityAt(closes, index, periods = 20) {
  if (index < periods) return null;
  const returns = [];
  for (let cursor = index - periods + 1; cursor <= index; cursor += 1) {
    const previous = closes[cursor - 1];
    const current = closes[cursor];
    if (previous > 0 && current > 0) returns.push(Math.log(current / previous));
  }
  const deviation = sampleStandardDeviation(returns);
  return deviation === null ? null : deviation * Math.sqrt(252) * 100;
}

function maxDrawdown(closes, periods = 120) {
  const sample = closes.slice(-Math.min(periods, closes.length));
  if (sample.length < 2) return null;
  let peak = sample[0];
  let worst = 0;
  for (const close of sample) {
    peak = Math.max(peak, close);
    worst = Math.min(worst, ((close / peak) - 1) * 100);
  }
  return worst;
}

function percentileRank(values, current) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length || !Number.isFinite(current)) return null;
  const atOrBelow = valid.filter((value) => value <= current).length;
  return (atOrBelow / valid.length) * 100;
}

function trendRegime(close, sma50, sma200, return60) {
  if (![close, sma50, sma200, return60].every(Number.isFinite)) return 'UNKNOWN';
  if (close > sma50 && close > sma200 && return60 > 0) return 'BULL_TREND';
  if (close < sma50 && close < sma200 && return60 < 0) return 'BEAR_TREND';
  return 'MIXED_TREND';
}

function momentumRegime(return20, return60) {
  if (![return20, return60].every(Number.isFinite)) return 'UNKNOWN';
  if (return20 > 0 && return60 > 0) return 'POSITIVE_MOMENTUM';
  if (return20 < 0 && return60 < 0) return 'NEGATIVE_MOMENTUM';
  return 'MIXED_MOMENTUM';
}

function volatilityRegime(percentile) {
  if (!Number.isFinite(percentile)) return 'UNKNOWN';
  if (percentile >= 67) return 'HIGH_VOLATILITY';
  if (percentile <= 33) return 'LOW_VOLATILITY';
  return 'NORMAL_VOLATILITY';
}

function riskTone(trend, momentum, volatility) {
  if (trend === 'BULL_TREND' && momentum === 'POSITIVE_MOMENTUM' && volatility !== 'HIGH_VOLATILITY') return 'RISK_ON';
  if (trend === 'BEAR_TREND') return 'RISK_OFF';
  if (momentum === 'NEGATIVE_MOMENTUM' && volatility === 'HIGH_VOLATILITY') return 'RISK_OFF';
  return 'NEUTRAL';
}

function isoFromSeconds(timestamp) {
  const number = finite(timestamp);
  if (number === null) return null;
  const date = new Date(number * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildForecastMarketRegimeSnapshot(input = {}) {
  const capturedAt = new Date(input.capturedAt || input.generatedAt || Date.now());
  if (Number.isNaN(capturedAt.getTime())) throw new Error('Market regime snapshot requires a valid capturedAt timestamp');
  const capturedAtIso = capturedAt.toISOString();
  const cutoffSeconds = capturedAt.getTime() / 1000;
  const normalized = normalizeHistoricalSeries(input.series || { candles: [] })
    .filter((candle) => candle.timestamp <= cutoffSeconds);
  const minimumObservations = Math.max(200, Number(input.minimumObservations || 200));
  const closes = normalized.map((item) => item.close);
  const latest = normalized.at(-1) || null;
  const latestClose = finite(latest?.close);
  const return20 = simpleReturn(closes, 20);
  const return60 = simpleReturn(closes, 60);
  const return120 = simpleReturn(closes, 120);
  const sma50 = movingAverage(closes, 50);
  const sma200 = movingAverage(closes, 200);
  const currentVol20 = closes.length ? annualizedVolatilityAt(closes, closes.length - 1, 20) : null;
  const currentVol60 = closes.length ? annualizedVolatilityAt(closes, closes.length - 1, 60) : null;
  const volatilityHistory = [];
  const historyStart = Math.max(20, closes.length - 252);
  for (let index = historyStart; index < closes.length; index += 1) {
    const value = annualizedVolatilityAt(closes, index, 20);
    if (Number.isFinite(value)) volatilityHistory.push(value);
  }
  const volPercentile = percentileRank(volatilityHistory, currentVol20);
  const drawdown120 = maxDrawdown(closes, 120);
  const trend = trendRegime(latestClose, sma50, sma200, return60);
  const momentum = momentumRegime(return20, return60);
  const volatility = volatilityRegime(volPercentile);
  const tone = riskTone(trend, momentum, volatility);
  const benchmarkAsOf = isoFromSeconds(latest?.timestamp);
  const blockers = [];
  if (normalized.length < minimumObservations) blockers.push('MARKET_REGIME_HISTORY_TOO_SHORT');
  if (!benchmarkAsOf) blockers.push('MARKET_REGIME_BENCHMARK_ASOF_MISSING');
  if (trend === 'UNKNOWN') blockers.push('MARKET_REGIME_TREND_UNAVAILABLE');
  if (momentum === 'UNKNOWN') blockers.push('MARKET_REGIME_MOMENTUM_UNAVAILABLE');
  if (volatility === 'UNKNOWN') blockers.push('MARKET_REGIME_VOLATILITY_UNAVAILABLE');

  const status = blockers.length ? 'REGIME_NOT_READY' : 'REGIME_READY';
  return {
    contract: 'FORECAST_TIME_MARKET_REGIME_SNAPSHOT_V1',
    policyVersion: FORECAST_MARKET_REGIME_VERSION,
    capturedAt: capturedAtIso,
    benchmarkAsOf,
    benchmarkSymbol: input.benchmarkSymbol || input.series?.providerSymbol || input.series?.symbol || null,
    benchmarkSource: input.series?.source || null,
    benchmarkSourceQuality: input.series?.sourceQuality || null,
    observationCount: normalized.length,
    status,
    regimeKey: status === 'REGIME_READY' ? `${tone}|${trend}|${volatility}|${momentum}` : null,
    riskTone: status === 'REGIME_READY' ? tone : null,
    trendRegime: trend,
    momentumRegime: momentum,
    volatilityRegime: volatility,
    metrics: {
      latestClose: round(latestClose, 6),
      return20Pct: round(return20),
      return60Pct: round(return60),
      return120Pct: round(return120),
      sma50: round(sma50, 6),
      sma200: round(sma200, 6),
      annualizedVolatility20Pct: round(currentVol20),
      annualizedVolatility60Pct: round(currentVol60),
      volatility20Percentile: round(volPercentile, 2),
      maxDrawdown120Pct: round(drawdown120),
    },
    blockers,
    researchOnly: true,
    modelDerived: true,
    finalActionEligible: false,
    decisionImpact: 'NONE',
  };
}

export function validateForecastMarketRegimeSnapshot(snapshot, forecastRecord = null) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { ok: false, errors: ['MARKET_REGIME_SNAPSHOT_REQUIRED'] };
  if (snapshot.contract !== 'FORECAST_TIME_MARKET_REGIME_SNAPSHOT_V1') errors.push('MARKET_REGIME_CONTRACT_INVALID');
  if (snapshot.policyVersion !== FORECAST_MARKET_REGIME_VERSION) errors.push('MARKET_REGIME_POLICY_VERSION_INVALID');
  if (snapshot.status !== 'REGIME_READY') errors.push('MARKET_REGIME_NOT_READY');
  if (snapshot.researchOnly !== true) errors.push('MARKET_REGIME_RESEARCH_ONLY_REQUIRED');
  if (snapshot.modelDerived !== true) errors.push('MARKET_REGIME_MODEL_DERIVED_REQUIRED');
  if (snapshot.finalActionEligible !== false) errors.push('MARKET_REGIME_FINAL_ACTION_FORBIDDEN');
  if (snapshot.decisionImpact !== 'NONE') errors.push('MARKET_REGIME_DECISION_IMPACT_FORBIDDEN');
  if (!snapshot.regimeKey || !snapshot.riskTone || !snapshot.trendRegime || !snapshot.volatilityRegime || !snapshot.momentumRegime) errors.push('MARKET_REGIME_IDENTITY_INCOMPLETE');
  if (!snapshot.benchmarkAsOf || !snapshot.capturedAt) errors.push('MARKET_REGIME_TIMESTAMPS_REQUIRED');
  const capturedAt = new Date(snapshot.capturedAt).getTime();
  const benchmarkAsOf = new Date(snapshot.benchmarkAsOf).getTime();
  if (!Number.isFinite(capturedAt) || !Number.isFinite(benchmarkAsOf)) errors.push('MARKET_REGIME_TIMESTAMPS_INVALID');
  if (Number.isFinite(capturedAt) && Number.isFinite(benchmarkAsOf) && benchmarkAsOf > capturedAt) errors.push('MARKET_REGIME_BENCHMARK_AFTER_CAPTURE');
  if (forecastRecord) {
    const forecastAt = new Date(forecastRecord.forecastAt || forecastRecord.generatedAt || 0).getTime();
    if (!Number.isFinite(forecastAt)) errors.push('MARKET_REGIME_FORECAST_TIMESTAMP_INVALID');
    if (Number.isFinite(forecastAt) && Number.isFinite(capturedAt) && capturedAt > forecastAt) errors.push('MARKET_REGIME_CAPTURE_AFTER_FORECAST');
    if (Number.isFinite(forecastAt) && Number.isFinite(benchmarkAsOf) && benchmarkAsOf > forecastAt) errors.push('MARKET_REGIME_DATA_AFTER_FORECAST');
  }
  return { ok: errors.length === 0, errors };
}
