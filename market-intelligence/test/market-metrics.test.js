import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFinnhubCandles } from '../src/adapters/finnhub-candles.js';
import { calculateMarketMetrics } from '../src/market-metrics.js';

function series({ start = 10, dailyGrowth = 0.001, volume = 1_000_000, count = 220, symbol = 'TEST' } = {}) {
  const candles = [];
  let close = start;
  for (let index = 0; index < count; index += 1) {
    close *= 1 + dailyGrowth + ((index % 7) - 3) * 0.0002;
    candles.push({
      timestamp: 1_700_000_000 + index * 86_400,
      close,
      open: close * 0.998,
      high: close * 1.01,
      low: close * 0.99,
      volume,
    });
  }
  return { symbol, currency: 'USD', candles };
}

test('historical metrics calculate volatility, liquidity, trend and relative strength deterministically', () => {
  const company = series({ dailyGrowth: 0.002, volume: 2_000_000, symbol: 'SPCE' });
  const benchmark = series({ dailyGrowth: 0.0006, volume: 50_000_000, symbol: 'SPY' });
  const metrics = calculateMarketMetrics(company, benchmark, {
    companyId: 'company:virgin-galactic-holdings',
    symbol: 'SPCE',
    benchmarkSymbol: 'SPY',
    currency: 'USD',
    generatedAt: '2026-07-27T12:00:00.000Z',
  });

  assert.equal(metrics.observationCount, 220);
  assert.equal(metrics.readiness.priceHistoryReady, true);
  assert.equal(metrics.readiness.liquidityReady, true);
  assert.equal(metrics.readiness.relativeStrengthReady, true);
  assert.equal(metrics.readiness.marketMetricsReady, true);
  assert.ok(metrics.returnsPct.d60 > 0);
  assert.ok(metrics.relativeStrength.excessReturnPct > 0);
  assert.ok(metrics.liquidity.averageDailyValueTraded20 > 10_000_000);
  assert.ok(metrics.trend.sma200 > 0);
  assert.ok(metrics.risk.annualizedVolatility60Pct >= 0);
});

test('short history cannot pass autonomous market readiness', () => {
  const metrics = calculateMarketMetrics(series({ count: 40 }), null, {
    symbol: 'TEST',
    benchmarkSymbol: 'SPY',
  });
  assert.equal(metrics.readiness.priceHistoryReady, false);
  assert.equal(metrics.readiness.relativeStrengthReady, false);
  assert.equal(metrics.readiness.marketMetricsReady, false);
});

test('Finnhub candle normalization rejects no-data payloads and aligns arrays safely', () => {
  const missing = normalizeFinnhubCandles({ s: 'no_data' }, { symbol: 'SPCE' });
  assert.equal(missing.usable, false);
  assert.deepEqual(missing.candles, []);

  const normalized = normalizeFinnhubCandles({
    s: 'ok',
    t: [3, 1, 2],
    c: [13, 11, 12],
    o: [12.5, 10.5, 11.5],
    h: [13.5, 11.5, 12.5],
    l: [12, 10, 11],
    v: [300, 100, 200],
  }, { symbol: 'SPCE', currency: 'USD' });
  assert.equal(normalized.usable, true);
  assert.deepEqual(normalized.candles.map((item) => item.timestamp), [1, 2, 3]);
  assert.deepEqual(normalized.candles.map((item) => item.volume), [100, 200, 300]);
});
