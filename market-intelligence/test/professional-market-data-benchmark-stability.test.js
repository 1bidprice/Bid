import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProfessionalHistoricalMetrics } from '../src/professional-market-data.js';

const ATHENS = {
  companyId: 'company:benchmark-stability-a',
  legalName: 'Benchmark Stability A S.A.',
  displayName: 'Benchmark Stability A',
  primaryListing: { exchange: 'Euronext Athens', symbol: 'CREDIA', mic: 'XATH' },
  listings: [{ exchange: 'Euronext Athens', symbol: 'CREDIA', mic: 'XATH', currency: 'EUR', active: true }],
  country: 'GR',
  currency: 'EUR',
  marketData: {
    yahooSymbols: ['CREDIA.AT'],
    benchmarkYahooSymbols: ['GD.AT'],
  },
};

function chartPayload({ symbol, count, start = 100, growth = 0.0005 }) {
  const timestamp = [];
  const close = [];
  const open = [];
  const high = [];
  const low = [];
  const volume = [];
  const adjusted = [];
  let price = start;
  const base = Math.floor(new Date('2023-08-01T14:00:00.000Z').getTime() / 1000);
  for (let index = 0; index < count; index += 1) {
    price *= 1 + growth + ((index % 7) - 3) * 0.00003;
    timestamp.push(base + index * 86_400);
    close.push(price);
    adjusted.push(price);
    open.push(price * 0.998);
    high.push(price * 1.006);
    low.push(price * 0.994);
    volume.push(2_000_000);
  }
  return {
    chart: {
      result: [{
        meta: {
          symbol,
          currency: 'EUR',
          exchangeName: 'ATH',
          exchangeTimezoneName: 'Europe/Athens',
          instrumentType: 'EQUITY',
          regularMarketPrice: close.at(-1),
          previousClose: close.at(-1),
          regularMarketTime: timestamp.at(-1),
          currentTradingPeriod: {
            regular: {
              start: timestamp.at(-1) + 86_400,
              end: timestamp.at(-1) + 86_400 + 24_000,
            },
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

function marketSnapshotFrom(payload) {
  const result = payload.chart.result[0];
  const latest = result.indicators.quote[0].close.at(-1);
  return {
    usable: true,
    currentPrice: latest,
    previousClose: latest,
    quoteAt: new Date(result.meta.regularMarketTime * 1000).toISOString(),
    generatedAt: '2026-08-14T15:00:00.000Z',
  };
}

test('five-year Athens benchmark rejects shallow responses, retries, then reuses one verified cache entry', async () => {
  const companyPayload = chartPayload({ symbol: 'CREDIA.AT', count: 1_100, start: 0.7, growth: 0.0008 });
  const shallowBenchmark = chartPayload({ symbol: 'GD.AT', count: 300, start: 1_800 });
  const deepBenchmark = chartPayload({ symbol: 'GD.AT', count: 1_100, start: 1_800 });
  const cache = new Map();
  let benchmarkRequestCount = 0;

  const fetchImpl = async (url) => {
    if (String(url).includes('CREDIA.AT')) {
      return { ok: true, status: 200, json: async () => companyPayload };
    }
    if (String(url).includes('GD.AT')) {
      benchmarkRequestCount += 1;
      const payload = benchmarkRequestCount <= 2 ? shallowBenchmark : deepBenchmark;
      return { ok: true, status: 200, json: async () => payload };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const first = await fetchProfessionalHistoricalMetrics(ATHENS, {
    fetchImpl,
    generatedAt: '2026-08-14T15:00:00.000Z',
    lookbackDays: 1_825,
    benchmarkCache: cache,
    benchmarkRetryDelayMs: 0,
    marketSnapshot: marketSnapshotFrom(companyPayload),
  });

  assert.equal(first.benchmarkSeries?.usable, true);
  assert.equal(first.benchmarkSeries?.candles?.length, 1_100);
  assert.equal(benchmarkRequestCount, 3);
  assert.ok(first.diagnostics.some((item) => item.code === 'YAHOO_MARKET_HISTORY_TOO_SHALLOW'));
  assert.ok(first.diagnostics.some((item) => item.code === 'MARKET_BENCHMARK_RETRYING'));
  assert.ok(first.diagnostics.some((item) => item.code === 'MARKET_BENCHMARK_RECOVERED_AFTER_RETRY'));

  const second = await fetchProfessionalHistoricalMetrics({ ...ATHENS, companyId: 'company:benchmark-stability-b' }, {
    fetchImpl,
    generatedAt: '2026-08-14T15:00:00.000Z',
    lookbackDays: 1_825,
    benchmarkCache: cache,
    benchmarkRetryDelayMs: 0,
    marketSnapshot: marketSnapshotFrom(companyPayload),
  });

  assert.equal(second.benchmarkSeries?.candles?.length, 1_100);
  assert.equal(benchmarkRequestCount, 3);
  assert.ok(second.diagnostics.some((item) => item.code === 'MARKET_BENCHMARK_CACHE_HIT'));
});

test('five-year Athens benchmark exhausts bounded retries once per run and stays fail-closed', async () => {
  const companyPayload = chartPayload({ symbol: 'CREDIA.AT', count: 1_100, start: 0.7, growth: 0.0008 });
  const shallowBenchmark = chartPayload({ symbol: 'GD.AT', count: 300, start: 1_800 });
  const cache = new Map();
  let benchmarkRequestCount = 0;

  const fetchImpl = async (url) => {
    if (String(url).includes('CREDIA.AT')) {
      return { ok: true, status: 200, json: async () => companyPayload };
    }
    if (String(url).includes('GD.AT')) {
      benchmarkRequestCount += 1;
      return { ok: true, status: 200, json: async () => shallowBenchmark };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const first = await fetchProfessionalHistoricalMetrics(ATHENS, {
    fetchImpl,
    generatedAt: '2026-08-14T15:00:00.000Z',
    lookbackDays: 1_825,
    benchmarkCache: cache,
    benchmarkRetryDelayMs: 0,
    marketSnapshot: marketSnapshotFrom(companyPayload),
  });

  assert.equal(first.benchmarkSeries, null);
  assert.equal(benchmarkRequestCount, 4);
  assert.ok(first.diagnostics.some((item) => item.code === 'MARKET_BENCHMARK_RETRY_EXHAUSTED'));
  assert.ok(first.diagnostics.some((item) => item.code === 'MARKET_BENCHMARK_UNAVAILABLE'));

  const second = await fetchProfessionalHistoricalMetrics({ ...ATHENS, companyId: 'company:benchmark-stability-b' }, {
    fetchImpl,
    generatedAt: '2026-08-14T15:00:00.000Z',
    lookbackDays: 1_825,
    benchmarkCache: cache,
    benchmarkRetryDelayMs: 0,
    marketSnapshot: marketSnapshotFrom(companyPayload),
  });

  assert.equal(second.benchmarkSeries, null);
  assert.equal(benchmarkRequestCount, 4);
  assert.ok(second.diagnostics.some((item) => item.code === 'MARKET_BENCHMARK_RETRY_EXHAUSTED_CACHED'));
});

test('Athens benchmark keeps configured alias first but recovers through canonical GD.AT fallback', async () => {
  const companyPayload = chartPayload({ symbol: 'CREDIA.AT', count: 1_100, start: 0.7, growth: 0.0008 });
  const deepBenchmark = chartPayload({ symbol: 'GD.AT', count: 1_100, start: 1_800 });
  const configuredOnlyBadAlias = {
    ...ATHENS,
    companyId: 'company:benchmark-configured-bad-alias',
    marketData: {
      ...ATHENS.marketData,
      benchmarkYahooSymbols: ['^ATG'],
    },
  };
  let configuredAliasRequestCount = 0;
  let canonicalFallbackRequestCount = 0;

  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('CREDIA.AT')) {
      return { ok: true, status: 200, json: async () => companyPayload };
    }
    if (value.includes('%5EATG')) {
      configuredAliasRequestCount += 1;
      return { ok: false, status: 503, json: async () => ({}) };
    }
    if (value.includes('GD.AT')) {
      canonicalFallbackRequestCount += 1;
      return { ok: true, status: 200, json: async () => deepBenchmark };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await fetchProfessionalHistoricalMetrics(configuredOnlyBadAlias, {
    fetchImpl,
    generatedAt: '2026-08-14T15:00:00.000Z',
    lookbackDays: 1_825,
    benchmarkCache: new Map(),
    benchmarkRetryDelayMs: 0,
    marketSnapshot: marketSnapshotFrom(companyPayload),
  });

  assert.equal(configuredAliasRequestCount, 2);
  assert.equal(canonicalFallbackRequestCount, 1);
  assert.equal(result.benchmarkSeries?.usable, true);
  assert.equal(result.benchmarkSeries?.providerSymbol, 'GD.AT');
  assert.equal(result.benchmarkSeries?.candles?.length, 1_100);
  assert.ok(result.diagnostics.some((item) => item.code === 'YAHOO_MARKET_REQUEST_FAILED' && item.providerSymbol === '^ATG'));
  assert.ok(result.diagnostics.some((item) => item.code === 'SECONDARY_MARKET_DATA_USED' && item.providerSymbol === 'GD.AT'));
});
