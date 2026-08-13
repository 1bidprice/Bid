import { calculateMarketMetrics } from './market-metrics.js';
import { synthesizeForecastDrivers } from './forecast-driver-synthesis.js';
import { buildForecastFeatureVector, FORECAST_FACTOR_DOMAIN_WEIGHTS } from './forecast-feature-vector.js';

export const HISTORICAL_MARKET_FACTOR_VERSION = '2026-08-13.1';
export const HISTORICAL_MARKET_FACTOR_CONTRACT = 'HISTORICAL_MARKET_FACTOR_SNAPSHOT_V1';

function iso(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value, minimum = -1, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function seriesCandles(series = {}) {
  return Array.isArray(series?.candles) ? series.candles : Array.isArray(series) ? series : [];
}

function candleTimestampSeconds(candle = {}) {
  const value = Number(candle?.timestamp ?? candle?.t);
  return Number.isFinite(value) ? value : null;
}

function truncateSeries(series = {}, forecastAt) {
  const cutoffMs = Date.parse(forecastAt || '');
  if (!Number.isFinite(cutoffMs)) return { ...series, candles: [] };
  const cutoffSeconds = cutoffMs / 1000;
  const candles = seriesCandles(series)
    .filter((candle) => {
      const timestamp = candleTimestampSeconds(candle);
      return timestamp !== null && timestamp <= cutoffSeconds;
    })
    .sort((left, right) => candleTimestampSeconds(left) - candleTimestampSeconds(right));
  return {
    ...(Array.isArray(series) ? {} : series),
    candles,
  };
}

function lastCandleIso(series = {}) {
  const candles = seriesCandles(series);
  const timestamp = candleTimestampSeconds(candles.at(-1));
  return timestamp === null ? null : new Date(timestamp * 1000).toISOString();
}

function blockedSnapshot(base, blockers, details = {}) {
  return {
    ...base,
    status: 'HISTORICAL_MARKET_FACTOR_BLOCKED',
    historicalMarketFactorScore: null,
    domainContributions: [],
    blockers: [...new Set(blockers)],
    ...details,
  };
}

export function buildHistoricalMarketFactorSnapshot(input = {}) {
  const forecastAt = iso(input.forecastAt);
  const instrumentId = String(input.instrumentId || input.companyId || '').trim() || null;
  const assetClass = String(input.assetClass || 'UNKNOWN');
  const horizon = String(input.horizon || '').trim() || null;
  const base = {
    format: 'investor-control-historical-market-factor-snapshot',
    version: 1,
    policyVersion: HISTORICAL_MARKET_FACTOR_VERSION,
    contract: HISTORICAL_MARKET_FACTOR_CONTRACT,
    instrumentId,
    assetClass,
    horizon,
    forecastAt,
    usesOnlyMarketHistoryAvailableAtForecastTime: true,
    fundamentalsBackfilled: false,
    valuationBackfilled: false,
    qualityBackfilled: false,
    growthBackfilled: false,
    catalystsBackfilled: false,
    newsBackfilled: false,
    liquidityUsedAsReturnFactor: false,
    historicalResearchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };

  if (!forecastAt) return blockedSnapshot(base, ['HISTORICAL_MARKET_FACTOR_FORECAST_TIME_REQUIRED']);
  if (!instrumentId) return blockedSnapshot(base, ['HISTORICAL_MARKET_FACTOR_INSTRUMENT_ID_REQUIRED']);

  const companySeries = truncateSeries(input.series || {}, forecastAt);
  const benchmarkSeries = truncateSeries(input.benchmarkSeries || {}, forecastAt);
  const companyObservationCount = seriesCandles(companySeries).length;
  const benchmarkObservationCount = seriesCandles(benchmarkSeries).length;
  const companyHistoryAsOf = lastCandleIso(companySeries);
  const benchmarkHistoryAsOf = lastCandleIso(benchmarkSeries);
  const blockers = [];
  if (companyObservationCount < 200) blockers.push('HISTORICAL_MARKET_FACTOR_COMPANY_HISTORY_TOO_SHORT');
  if (benchmarkObservationCount < 200) blockers.push('HISTORICAL_MARKET_FACTOR_BENCHMARK_HISTORY_TOO_SHORT');

  const market = calculateMarketMetrics(companySeries, benchmarkSeries, {
    generatedAt: forecastAt,
    companyId: instrumentId,
    symbol: input.symbol || companySeries?.symbol || companySeries?.providerSymbol || null,
    benchmarkSymbol: benchmarkSeries?.symbol || benchmarkSeries?.providerSymbol || input.benchmarkSymbol || null,
    minimumPriceObservations: 200,
  });
  if (market?.readiness?.priceHistoryReady !== true) blockers.push('HISTORICAL_MARKET_FACTOR_PRICE_HISTORY_NOT_READY');
  if (market?.readiness?.relativeStrengthReady !== true) blockers.push('HISTORICAL_MARKET_FACTOR_RELATIVE_STRENGTH_NOT_READY');

  const driverSynthesis = synthesizeForecastDrivers({
    dossier: {
      companyId: instrumentId,
      metrics: { market },
      readiness: {},
    },
    opportunity: {},
  });
  const featureVector = buildForecastFeatureVector({
    instrumentId,
    assetClass,
    horizon,
    driverSynthesis,
  });
  const momentum = featureVector.features.find((feature) => feature.domain === 'MOMENTUM') || null;
  const risk = featureVector.features.find((feature) => feature.domain === 'RISK') || null;
  if (momentum?.available !== true || finite(momentum?.value) === null) blockers.push('HISTORICAL_MARKET_FACTOR_MOMENTUM_NOT_READY');
  if (risk?.available !== true || finite(risk?.value) === null) blockers.push('HISTORICAL_MARKET_FACTOR_RISK_NOT_READY');

  const context = {
    companyObservationCount,
    benchmarkObservationCount,
    companyHistoryAsOf,
    benchmarkHistoryAsOf,
    marketReadiness: {
      priceHistoryReady: market?.readiness?.priceHistoryReady === true,
      relativeStrengthReady: market?.readiness?.relativeStrengthReady === true,
    },
  };
  if (blockers.length) return blockedSnapshot(base, blockers, context);

  const momentumWeight = FORECAST_FACTOR_DOMAIN_WEIGHTS.MOMENTUM;
  const riskWeight = FORECAST_FACTOR_DOMAIN_WEIGHTS.RISK;
  const availableWeight = momentumWeight + riskWeight;
  const score = clamp(((momentum.value * momentumWeight) + (risk.value * riskWeight)) / availableWeight);

  return {
    ...base,
    status: 'HISTORICAL_MARKET_FACTOR_READY',
    historicalMarketFactorScore: round(score),
    availableDomainCount: 2,
    availableWeight: round(availableWeight, 4),
    domainContributions: [
      {
        domain: 'MOMENTUM',
        value: round(momentum.value),
        weight: momentumWeight,
        normalizedWeight: round(momentumWeight / availableWeight, 4),
        verifiedDriverCount: Number(momentum.verifiedDriverCount || 0),
        driverNames: Array.isArray(momentum.driverNames) ? momentum.driverNames : [],
      },
      {
        domain: 'RISK',
        value: round(risk.value),
        weight: riskWeight,
        normalizedWeight: round(riskWeight / availableWeight, 4),
        verifiedDriverCount: Number(risk.verifiedDriverCount || 0),
        driverNames: Array.isArray(risk.driverNames) ? risk.driverNames : [],
      },
    ],
    ...context,
    blockers: [],
    methodology: {
      featureSource: 'TRUNCATED_COMPANY_AND_BENCHMARK_MARKET_HISTORY_ONLY',
      allowedDomains: ['MOMENTUM', 'RISK'],
      excludedDomains: ['VALUATION', 'QUALITY', 'GROWTH', 'FUNDAMENTAL', 'CATALYST', 'EXECUTION', 'PORTFOLIO'],
      weighting: 'CANONICAL_FORECAST_FACTOR_DOMAIN_WEIGHTS_RENORMALIZED_OVER_MOMENTUM_AND_RISK',
      companyHistoryCutoffRule: 'CANDLES_AT_OR_BEFORE_FORECAST_TIME_ONLY',
      benchmarkHistoryCutoffRule: 'CANDLES_AT_OR_BEFORE_FORECAST_TIME_ONLY',
      scoreSemantics: 'MARKET_ONLY_LATENT_RESEARCH_FACTOR_NOT_A_PROBABILITY',
    },
  };
}
