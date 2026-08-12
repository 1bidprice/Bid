import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProfessionalHistoricalMetrics } from '../src/professional-market-data.js';

const COMPANY = {
  companyId: 'sec-cik:1015383',
  legalName: 'Outdoor Holding Company',
  displayName: 'Outdoor Holding Company',
  primaryListing: { exchange: 'Nasdaq', symbol: 'POWW', mic: 'XNAS' },
  listings: [{ exchange: 'Nasdaq', symbol: 'POWW', mic: 'XNAS', currency: 'USD', active: true }],
  country: 'US',
  currency: 'USD',
};

const DAY_MS = 86_400_000;
const ORIGIN = Date.parse('2026-01-01T20:00:00.000Z');

function daysEnding(endDay, count) {
  const end = Date.parse(`${endDay}T20:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => new Date(end - (count - 1 - index) * DAY_MS).toISOString().slice(0, 10));
}

function closeForDay(day, base) {
  const index = Math.round((Date.parse(`${day}T20:00:00.000Z`) - ORIGIN) / DAY_MS);
  return Number((base + index * 0.01).toFixed(6));
}

function chartPayload(symbol, days, base) {
  const timestamps = days.map((day) => Math.floor(Date.parse(`${day}T20:00:00.000Z`) / 1000));
  const closes = days.map((day) => closeForDay(day, base));
  const latestTimestamp = timestamps.at(-1);
  const latestClose = closes.at(-1);
  return {
    chart: {
      result: [{
        meta: {
          symbol,
          currency: 'USD',
          exchangeName: 'NMS',
          exchangeTimezoneName: 'America/New_York',
          instrumentType: 'EQUITY',
          regularMarketPrice: latestClose,
          previousClose: latestClose,
          regularMarketTime: latestTimestamp,
          currentTradingPeriod: {
            regular: { start: latestTimestamp + 86_400, end: latestTimestamp + 86_400 + 24_000 },
          },
        },
        timestamp: timestamps,
        indicators: {
          quote: [{
            close: closes,
            open: closes.map((value) => value * 0.995),
            high: closes.map((value) => value * 1.005),
            low: closes.map((value) => value * 0.99),
            volume: closes.map(() => 2_000_000),
          }],
          adjclose: [{ adjclose: closes }],
        },
      }],
      error: null,
    },
  };
}

function response(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

function makeFetcher({ baseCompany, recentCompany, benchmark }) {
  return async (url) => {
    const parsed = new URL(String(url));
    const isCompany = parsed.pathname.includes('/POWW');
    if (isCompany && parsed.searchParams.get('range') === '1mo') return response(recentCompany);
    if (isCompany) return response(baseCompany);
    if (parsed.pathname.includes('/SPY')) return response(benchmark);
    throw new Error(`Unexpected fixture URL: ${url}`);
  };
}

function marketSnapshot(previousClose) {
  return {
    usable: true,
    currentPrice: previousClose * 0.97,
    previousClose,
    quoteAt: '2026-08-12T15:00:00.000Z',
    generatedAt: '2026-08-12T15:00:00.000Z',
  };
}

test('lagging long Yahoo history is recovered only by a recent series that reaches benchmark session and matches overlap', async () => {
  const baseCompany = chartPayload('POWW', daysEnding('2026-08-10', 220), 10);
  const recentCompany = chartPayload('POWW', daysEnding('2026-08-11', 30), 10);
  const benchmark = chartPayload('SPY', daysEnding('2026-08-11', 220), 500);
  const freshClose = closeForDay('2026-08-11', 10);

  const result = await fetchProfessionalHistoricalMetrics(COMPANY, {
    fetchImpl: makeFetcher({ baseCompany, recentCompany, benchmark }),
    generatedAt: '2026-08-12T15:00:00.000Z',
    marketSnapshot: marketSnapshot(freshClose),
    benchmarkCache: new Map(),
  });

  assert.equal(result.metrics.dataQuality.crossCheckReady, true);
  assert.equal(result.metrics.readiness.marketMetricsReady, true);
  assert.equal(result.metrics.dataQuality.validation.latestDate, '2026-08-11');
  assert.equal(result.metrics.dataQuality.validation.benchmarkLatestDate, '2026-08-11');
  assert.equal(result.metrics.dataQuality.validation.reason, 'MATCHED');
  assert.equal(result.metrics.dataQuality.validation.freshnessRecovery.status, 'RECOVERY_READY');
  assert.ok(result.metrics.dataQuality.validation.freshnessRecovery.overlapCount >= 5);
  assert.equal(result.diagnostics.some((item) => item.code === 'MARKET_HISTORY_FRESHNESS_RECOVERED'), true);
});

test('lagging history remains blocked when recent Yahoo refresh still does not reach benchmark completed session', async () => {
  const baseCompany = chartPayload('POWW', daysEnding('2026-08-10', 220), 10);
  const recentCompany = chartPayload('POWW', daysEnding('2026-08-10', 30), 10);
  const benchmark = chartPayload('SPY', daysEnding('2026-08-11', 220), 500);
  const previousClose = closeForDay('2026-08-11', 10);

  const result = await fetchProfessionalHistoricalMetrics(COMPANY, {
    fetchImpl: makeFetcher({ baseCompany, recentCompany, benchmark }),
    generatedAt: '2026-08-12T15:00:00.000Z',
    marketSnapshot: marketSnapshot(previousClose),
    benchmarkCache: new Map(),
  });

  assert.equal(result.metrics.dataQuality.crossCheckReady, false);
  assert.equal(result.metrics.readiness.marketMetricsReady, false);
  assert.equal(result.metrics.dataQuality.validation.reason, 'HISTORY_LAGS_BENCHMARK_SESSION');
  const rejected = result.diagnostics.find((item) => item.code === 'MARKET_HISTORY_FRESHNESS_RECOVERY_REJECTED');
  assert.ok(rejected);
  assert.ok(rejected.blockers.includes('HISTORY_RECOVERY_TARGET_SESSION_NOT_REACHED'));
});
