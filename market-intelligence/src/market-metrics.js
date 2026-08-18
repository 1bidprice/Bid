const TRADING_DAYS = 252;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function median(values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function sampleStandardDeviation(values) {
  const valid = values.filter(Number.isFinite);
  if (valid.length < 2) return null;
  const mean = average(valid);
  const variance = valid.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (valid.length - 1);
  return Math.sqrt(variance);
}

export function normalizeCandles(candles = []) {
  const byTimestamp = new Map();
  for (const candle of candles) {
    const timestamp = finite(candle?.timestamp ?? candle?.t);
    const close = finite(candle?.close ?? candle?.c);
    const volume = finite(candle?.volume ?? candle?.v);
    const high = finite(candle?.high ?? candle?.h);
    const low = finite(candle?.low ?? candle?.l);
    const open = finite(candle?.open ?? candle?.o);
    if (timestamp === null || close === null || close <= 0) continue;
    byTimestamp.set(timestamp, {
      timestamp,
      close,
      volume: volume !== null && volume >= 0 ? volume : null,
      open,
      high,
      low,
    });
  }
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function trailing(values, count) {
  return values.length >= count ? values.slice(-count) : [];
}

function simpleReturn(closes, periods) {
  if (closes.length <= periods) return null;
  const start = closes[closes.length - periods - 1];
  const end = closes.at(-1);
  return start > 0 ? ((end / start) - 1) * 100 : null;
}

function movingAverage(closes, periods) {
  const sample = trailing(closes, periods);
  return sample.length === periods ? average(sample) : null;
}

function annualizedVolatility(closes, periods = 60) {
  const sample = trailing(closes, periods + 1);
  if (sample.length < periods + 1) return null;
  const logReturns = [];
  for (let index = 1; index < sample.length; index += 1) {
    if (sample[index - 1] <= 0 || sample[index] <= 0) continue;
    logReturns.push(Math.log(sample[index] / sample[index - 1]));
  }
  const daily = sampleStandardDeviation(logReturns);
  return daily === null ? null : daily * Math.sqrt(TRADING_DAYS) * 100;
}

function maxDrawdown(closes, periods = 120) {
  const sample = trailing(closes, Math.min(periods, closes.length));
  if (sample.length < 2) return null;
  let peak = sample[0];
  let worst = 0;
  for (const close of sample) {
    peak = Math.max(peak, close);
    const drawdown = peak > 0 ? ((close / peak) - 1) * 100 : 0;
    worst = Math.min(worst, drawdown);
  }
  return worst;
}

function liquidityScore(avgDailyValue) {
  if (!Number.isFinite(avgDailyValue)) return null;
  if (avgDailyValue < 100_000) return 10;
  if (avgDailyValue < 500_000) return 25;
  if (avgDailyValue < 2_000_000) return 45;
  if (avgDailyValue < 10_000_000) return 65;
  if (avgDailyValue < 50_000_000) return 80;
  return 95;
}

function alignedReturn(companyCandles, benchmarkCandles, periods) {
  const companyMap = new Map(companyCandles.map((item) => [item.timestamp, item.close]));
  const aligned = benchmarkCandles
    .filter((item) => companyMap.has(item.timestamp))
    .map((item) => ({ timestamp: item.timestamp, company: companyMap.get(item.timestamp), benchmark: item.close }));
  if (aligned.length <= periods) return null;
  const sample = aligned.slice(-(periods + 1));
  const companyReturn = ((sample.at(-1).company / sample[0].company) - 1) * 100;
  const benchmarkReturn = ((sample.at(-1).benchmark / sample[0].benchmark) - 1) * 100;
  return {
    companyReturn,
    benchmarkReturn,
    relativeStrength: companyReturn - benchmarkReturn,
    alignedObservationCount: sample.length,
  };
}

export function calculateMarketMetrics(series, benchmarkSeries = null, options = {}) {
  const candles = normalizeCandles(series?.candles || series || []);
  const benchmarkCandles = normalizeCandles(benchmarkSeries?.candles || benchmarkSeries || []);
  const closes = candles.map((item) => item.close);
  const latest = candles.at(-1) || null;
  const volumeWindow = trailing(candles, 60);
  const validVolumeCount = volumeWindow.filter((item) => Number.isFinite(item.volume)).length;
  const valueTraded20 = trailing(candles, 20)
    .map((item) => Number.isFinite(item.volume) ? item.close * item.volume : null)
    .filter(Number.isFinite);
  const volumes20 = trailing(candles, 20).map((item) => item.volume).filter(Number.isFinite);
  const relative60 = benchmarkCandles.length ? alignedReturn(candles, benchmarkCandles, 60) : null;

  const return20 = simpleReturn(closes, 20);
  const return60 = simpleReturn(closes, 60);
  const return120 = simpleReturn(closes, 120);
  const sma20 = movingAverage(closes, 20);
  const sma50 = movingAverage(closes, 50);
  const sma200 = movingAverage(closes, 200);
  const avgDailyValueTraded20 = average(valueTraded20);
  const annualizedVolatility60 = annualizedVolatility(closes, 60);
  const drawdown120 = maxDrawdown(closes, 120);
  const priceHistoryReady = candles.length >= Number(options.minimumPriceObservations || 120);
  const volumeCoverage = volumeWindow.length ? validVolumeCount / volumeWindow.length : 0;
  const liquidityReady = candles.length >= 60 && volumeCoverage >= 0.9 && valueTraded20.length >= 18;
  const relativeStrengthReady = Boolean(relative60 && relative60.alignedObservationCount >= 61);
  const marketMetricsReady = priceHistoryReady && liquidityReady && relativeStrengthReady;

  const riskFlags = [];
  if (annualizedVolatility60 !== null && annualizedVolatility60 >= 80) riskFlags.push('EXTREME_VOLATILITY');
  else if (annualizedVolatility60 !== null && annualizedVolatility60 >= 50) riskFlags.push('HIGH_VOLATILITY');
  if (drawdown120 !== null && drawdown120 <= -50) riskFlags.push('SEVERE_DRAWDOWN');
  else if (drawdown120 !== null && drawdown120 <= -30) riskFlags.push('MATERIAL_DRAWDOWN');
  if (liquidityReady && avgDailyValueTraded20 < 500_000) riskFlags.push('LOW_LIQUIDITY');
  if (latest && sma50 !== null && latest.close < sma50) riskFlags.push('BELOW_50_DAY_AVERAGE');
  if (relative60 && relative60.relativeStrength < -15) riskFlags.push('WEAK_RELATIVE_STRENGTH');

  return {
    format: 'investor-control-historical-market-metrics',
    version: 1,
    generatedAt: new Date(options.generatedAt || Date.now()).toISOString(),
    companyId: options.companyId || series?.companyId || null,
    symbol: options.symbol || series?.symbol || null,
    benchmarkSymbol: options.benchmarkSymbol || benchmarkSeries?.symbol || null,
    currency: options.currency || series?.currency || null,
    observationCount: candles.length,
    firstTimestamp: candles[0]?.timestamp || null,
    latestTimestamp: latest?.timestamp || null,
    latestClose: latest?.close || null,
    returnsPct: {
      d20: round(return20, 2),
      d60: round(return60, 2),
      d120: round(return120, 2),
    },
    trend: {
      sma20: round(sma20),
      sma50: round(sma50),
      sma200: round(sma200),
      distanceFromSma20Pct: latest && sma20 ? round(((latest.close / sma20) - 1) * 100, 2) : null,
      distanceFromSma50Pct: latest && sma50 ? round(((latest.close / sma50) - 1) * 100, 2) : null,
      distanceFromSma200Pct: latest && sma200 ? round(((latest.close / sma200) - 1) * 100, 2) : null,
    },
    risk: {
      annualizedVolatility60Pct: round(annualizedVolatility60, 2),
      maxDrawdown120Pct: round(drawdown120, 2),
      flags: riskFlags,
    },
    liquidity: {
      averageDailyValueTraded20: round(avgDailyValueTraded20, 2),
      medianDailyVolume20: round(median(volumes20), 2),
      volumeCoverage60: round(volumeCoverage * 100, 2),
      score: liquidityScore(avgDailyValueTraded20),
    },
    relativeStrength: relative60
      ? {
          period: 60,
          companyReturnPct: round(relative60.companyReturn, 2),
          benchmarkReturnPct: round(relative60.benchmarkReturn, 2),
          excessReturnPct: round(relative60.relativeStrength, 2),
          alignedObservationCount: relative60.alignedObservationCount,
        }
      : null,
    readiness: {
      priceHistoryReady,
      liquidityReady,
      relativeStrengthReady,
      marketMetricsReady,
    },
  };
}
