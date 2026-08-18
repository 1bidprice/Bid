import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProfessionalHistoricalMetrics } from '../src/professional-market-data.js';

const POWW = {
  companyId: 'sec-cik:1015383',
  legalName: 'Outdoor Holding Company',
  displayName: 'Outdoor Holding Company',
  primaryListing: { exchange: 'Nasdaq', symbol: 'POWW', mic: 'XNAS' },
  listings: [{ exchange: 'Nasdaq', symbol: 'POWW', mic: 'XNAS', currency: 'USD', active: true }],
  country: 'US',
  currency: 'USD',
};

function chartPayload({ symbol, count = 220, start = 2.0, growth = 0.001, base = '2025-12-01T21:00:00.000Z' }) {
  const timestamp = [];
  const close = [];
  const open = [];
  const high = [];
  const low = [];
  const volume = [];
  const adjusted = [];
  let price = start;
  const baseSeconds = Math.floor(new Date(base).getTime() / 1000);
  for (let index = 0; index < count; index += 1) {
    price *= 1 + growth;
    timestamp.push(baseSeconds + index * 86_400);
    close.push(price);
    adjusted.push(price);
    open.push(price * 0.99);
    high.push(price * 1.01);
    low.push(price * 0.98);
    volume.push(2_000_000);
  }
  return {
    chart: {
      result: [{
        meta: {
          symbol,
          currency: 'USD',
          exchangeName: 'NMS',
          exchangeTimezoneName: 'America/New_York',
          instrumentType: 'EQUITY',
          regularMarketPrice: close.at(-1),
          previousClose: close.at(-1),
          regularMarketTime: timestamp.at(-1),
          currentTradingPeriod: {
            regular: { start: timestamp.at(-1) + 86_400, end: timestamp.at(-1) + 86_400 + 24_000 },
          },
        },
        timestamp,
        indicators: {
          quote: [{ close, open, high, low, volume }],
          adjclose: [{ adjclose: adjusted }],
        },
      }],
      error: null,
    },
  };
}

function latestRawClose(payload) {
  return payload.chart.result[0].indicators.quote[0].close.at(-1);
}

function latestTimestamp(payload) {
  return payload.chart.result[0].timestamp.at(-1);
}

function fetcher(companyPayload, benchmarkPayload) {
  return async (url) => ({
    ok: true,
    status: 200,
    json: async () => String(url).includes('POWW') ? companyPayload : benchmarkPayload,
  });
}

test('history that lags the benchmark complete session is blocked before price-deviation cross-check', async () => {
  const companyPayload = chartPayload({ symbol: 'POWW', count: 220 });
  const benchmarkPayload = chartPayload({ symbol: 'SPY', count: 221, start: 500 });
  const staleClose = latestRawClose(companyPayload);
  const benchmarkLatestAt = new Date(latestTimestamp(benchmarkPayload) * 1000).toISOString();

  const result = await fetchProfessionalHistoricalMetrics(POWW, {
    fetchImpl: fetcher(companyPayload, benchmarkPayload),
    generatedAt: benchmarkLatestAt,
    marketSnapshot: {
      usable: true,
      currentPrice: staleClose,
      previousClose: staleClose,
      quoteAt: benchmarkLatestAt,
    },
    benchmarkCache: new Map(),
  });

  assert.equal(result.metrics.dataQuality.crossCheckReady, false);
  assert.equal(result.metrics.readiness.marketMetricsReady, false);
  assert.equal(result.metrics.dataQuality.validation.reason, 'HISTORY_LAGS_BENCHMARK_SESSION');
  assert.equal(result.metrics.dataQuality.validation.deviationPct, null);
  assert.notEqual(result.metrics.dataQuality.validation.latestDate, result.metrics.dataQuality.validation.benchmarkLatestDate);
  const diagnostic = result.diagnostics.find((item) => item.code === 'MARKET_HISTORY_CROSSCHECK_FAILED');
  assert.equal(diagnostic.reason, 'HISTORY_LAGS_BENCHMARK_SESSION');
  assert.equal(diagnostic.latestDate, result.metrics.dataQuality.validation.latestDate);
  assert.equal(diagnostic.benchmarkLatestDate, result.metrics.dataQuality.validation.benchmarkLatestDate);
});

test('large current-session move does not invalidate history when company and benchmark share the last completed session', async () => {
  const companyPayload = chartPayload({ symbol: 'POWW', count: 220 });
  const benchmarkPayload = chartPayload({ symbol: 'SPY', count: 220, start: 500 });
  const priorClose = latestRawClose(companyPayload);
  const completedSessionAt = latestTimestamp(companyPayload) * 1000;
  const quoteAt = new Date(completedSessionAt + 86_400_000).toISOString();

  const result = await fetchProfessionalHistoricalMetrics(POWW, {
    fetchImpl: fetcher(companyPayload, benchmarkPayload),
    generatedAt: quoteAt,
    marketSnapshot: {
      usable: true,
      currentPrice: priorClose * 0.8,
      previousClose: priorClose,
      quoteAt,
    },
    benchmarkCache: new Map(),
  });

  assert.equal(result.metrics.dataQuality.validation.latestDate, result.metrics.dataQuality.validation.benchmarkLatestDate);
  assert.notEqual(result.metrics.dataQuality.validation.latestDate, result.metrics.dataQuality.validation.quoteDate);
  assert.equal(result.metrics.dataQuality.validation.reference, priorClose);
  assert.equal(result.metrics.dataQuality.validation.deviationPct, 0);
  assert.equal(result.metrics.dataQuality.validation.reason, 'MATCHED');
  assert.equal(result.metrics.dataQuality.crossCheckReady, true);
  assert.equal(result.metrics.readiness.marketMetricsReady, true);
});
