import test from 'node:test';
import assert from 'node:assert/strict';
import { screenBroadEquityMarketCandidates } from '../src/broad-equity-market-screen.js';

function candidate(symbol, fundamentalScore, annualRevenue, shares, equity) {
  return {
    instrumentId: `listing:XNAS:${symbol}`,
    companyId: `sec-cik:${symbol}`,
    displayName: `${symbol} Corp`,
    currency: 'USD',
    primaryListing: { symbol, mic: 'XNAS', exchange: 'Nasdaq', currency: 'USD' },
    broadScreen: {
      score: fundamentalScore,
      finalActionEligible: false,
      rawSignals: { annualRevenue, sharesOutstanding: shares, equity },
    },
  };
}

const candidates = [
  candidate('AAA', 92, 1_000_000_000, 10_000_000, 700_000_000),
  candidate('BBB', 95, 500_000_000, 100_000_000, 300_000_000),
  candidate('CCC', 78, 900_000_000, 18_000_000, 600_000_000),
  candidate('DDD', 74, 1_200_000_000, 20_000_000, 850_000_000),
  candidate('EEE', 70, 800_000_000, 25_000_000, 500_000_000),
];

function seriesFor(symbol) {
  const configs = {
    SPY: { start: 100, end: 115, volume: 90_000_000 },
    AAA: { start: 48, end: 80, volume: 5_000_000 },
    BBB: { start: 52, end: 58, volume: 2_000_000 },
    CCC: { start: 45, end: 62, volume: 3_000_000 },
    DDD: { start: 55, end: 66, volume: 2_500_000 },
    EEE: { start: 60, end: 57, volume: 1_500_000 },
  };
  const config = configs[symbol];
  const count = 260;
  const startTs = 1735689600;
  const timestamp = [];
  const close = [];
  const open = [];
  const high = [];
  const low = [];
  const volume = [];
  for (let i = 0; i < count; i += 1) {
    const progress = i / (count - 1);
    const value = config.start + (config.end - config.start) * progress + Math.sin(i / 9) * 0.35;
    timestamp.push(startTs + i * 86400);
    close.push(value);
    open.push(value * 0.998);
    high.push(value * 1.01);
    low.push(value * 0.99);
    volume.push(config.volume);
  }
  return {
    chart: {
      error: null,
      result: [{
        meta: {
          symbol,
          currency: 'USD',
          exchangeName: 'NMS',
          exchangeTimezoneName: 'America/New_York',
          regularMarketPrice: close.at(-1),
          previousClose: close.at(-2),
          regularMarketTime: timestamp.at(-1),
          currentTradingPeriod: { regular: { start: 1, end: 2 } },
        },
        timestamp,
        indicators: { quote: [{ close, open, high, low, volume }], adjclose: [{ adjclose: close }] },
      }],
    },
  };
}

const fetchImpl = async (url) => {
  const match = String(url).match(/\/chart\/([^?]+)/);
  const symbol = decodeURIComponent(match?.[1] || '');
  const payload = seriesFor(symbol);
  return { ok: true, json: async () => payload };
};

test('mid-stage market screen combines fundamentals, relative valuation, momentum and liquidity before deep analysis', async () => {
  const result = await screenBroadEquityMarketCandidates(candidates, {
    fetchImpl,
    now: '2026-08-09T12:00:00.000Z',
    benchmarkSymbol: 'SPY',
    concurrency: 3,
    limit: 3,
  });

  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.inputCount, 5);
  assert.equal(result.scorableCount, 5);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates[0].primaryListing.symbol, 'AAA');
  const aaa = result.candidates[0].broadScreen.marketScreen;
  const bbb = result.candidates.find((item) => item.primaryListing.symbol === 'BBB')?.broadScreen.marketScreen;
  assert.equal(aaa.finalActionEligible, false);
  assert.ok(aaa.preliminaryPriceToSales < 1);
  assert.ok(aaa.momentumScore > 70);
  assert.ok(aaa.score > 70);
  if (bbb) assert.ok(aaa.valuationScore > bbb.valuationScore);
});

test('market screen fails closed when benchmark history is unavailable', async () => {
  const result = await screenBroadEquityMarketCandidates(candidates, {
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    now: '2026-08-09T12:00:00.000Z',
  });
  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.candidates.length, 0);
  assert.ok(result.diagnostics.some((item) => item.code === 'BROAD_MARKET_BENCHMARK_UNAVAILABLE'));
});
