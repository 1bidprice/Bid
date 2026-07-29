import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeYahooChart } from '../src/adapters/yahoo-chart.js';
import { normalizeEuronextAthensQuote } from '../src/adapters/euronext-athens-quote.js';
import { extractEuronextAthensAnnouncements } from '../src/adapters/euronext-athens-announcements.js';
import { fetchProfessionalHistoricalMetrics } from '../src/professional-market-data.js';

const CREDIA = {
  companyId: 'company:crediabank',
  legalName: 'CrediaBank S.A.',
  displayName: 'CrediaBank',
  primaryListing: { exchange: 'Euronext Athens', symbol: 'CREDIA', mic: 'XATH' },
  listings: [{ exchange: 'Euronext Athens', symbol: 'CREDIA', mic: 'XATH', currency: 'EUR', active: true }],
  country: 'GR',
  currency: 'EUR',
  marketData: {
    yahooSymbols: ['CREDIA.AT'],
    benchmarkYahooSymbols: ['GD.AT'],
  },
};

function chartPayload({ symbol, start = 1, growth = 0.001, volume = 2_000_000, count = 220 }) {
  const timestamp = [];
  const close = [];
  const open = [];
  const high = [];
  const low = [];
  const volumes = [];
  const adjusted = [];
  let price = start;
  const base = Math.floor(new Date('2025-09-23T14:00:00.000Z').getTime() / 1000);
  for (let index = 0; index < count; index += 1) {
    price *= 1 + growth + ((index % 5) - 2) * 0.0001;
    timestamp.push(base + index * 86_400);
    close.push(price);
    adjusted.push(price * 0.999);
    open.push(price * 0.997);
    high.push(price * 1.01);
    low.push(price * 0.99);
    volumes.push(volume);
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
            regular: { start: timestamp.at(-1) + 86_400, end: timestamp.at(-1) + 86_400 + 24_000 },
          },
        },
        timestamp,
        indicators: {
          quote: [{ close, open, high, low, volume: volumes }],
          adjclose: [{ adjclose: adjusted }],
        },
      }],
      error: null,
    },
  };
}

test('Yahoo chart normalizer preserves raw close and uses adjusted close for return calculations', () => {
  const payload = chartPayload({ symbol: 'CREDIA.AT', count: 3 });
  const series = normalizeYahooChart(payload, {
    symbol: 'CREDIA',
    providerSymbol: 'CREDIA.AT',
    generatedAt: '2026-07-30T00:00:00.000Z',
  });
  assert.equal(series.usable, true);
  assert.equal(series.sourceQuality, 'SECONDARY_VALIDATED');
  assert.equal(series.candles.length, 3);
  assert.notEqual(series.candles[2].close, series.candles[2].rawClose);
  assert.equal(series.previousClose, payload.chart.result[0].meta.previousClose);
});

test('official Euronext Athens quote parser exposes delayed data without inventing an exchange timestamp', () => {
  const html = `
    <div>Last Traded Price 0,9250 EUR</div>
    <div>Previous Close 0,9350 EUR</div>
    <div>Opening Price 0,9400 EUR</div>
    <div>Daily High Price 0,9450 EUR</div>
    <div>Daily Low Price 0,9200 EUR</div>
    <div>Total Volume 1.234.567</div>
  `;
  const snapshot = normalizeEuronextAthensQuote(html, CREDIA, {
    generatedAt: '2026-07-30T00:00:00.000Z',
  });
  assert.equal(snapshot.usable, true);
  assert.equal(snapshot.currentPrice, 0.925);
  assert.equal(snapshot.previousClose, 0.935);
  assert.equal(snapshot.dailyChangePct, -1.07);
  assert.equal(snapshot.sourceQuality, 'OFFICIAL_DELAYED');
  assert.equal(snapshot.quoteTimestampVerified, false);
  assert.equal(snapshot.timestampMeaning, 'RETRIEVAL_TIME_FOR_OFFICIAL_DELAYED_VALUE');
});

test('Euronext Athens announcement parser creates primary-source evidence', () => {
  const html = `
    <table><tr><td>29/07/2026 17:45</td><td><a href="/node/123456">CrediaBank publishes regulated information</a></td></tr></table>
  `;
  const records = extractEuronextAthensAnnouncements(html, {
    companyId: CREDIA.companyId,
    retrievedAt: '2026-07-30T00:00:00.000Z',
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].isPrimarySource, true);
  assert.equal(records[0].sourceType, 'EXCHANGE_ANNOUNCEMENT');
  assert.match(records[0].sourceUrl, /athens\.euronext\.com\/node\/123456/);
});

test('validated secondary history becomes market-ready only after current-price and benchmark cross-checks', async () => {
  const companyPayload = chartPayload({ symbol: 'CREDIA.AT', start: 0.7, growth: 0.0015, volume: 3_000_000 });
  const benchmarkPayload = chartPayload({ symbol: 'GD.AT', start: 1_800, growth: 0.0005, volume: 100_000_000 });
  const latestRawClose = companyPayload.chart.result[0].indicators.quote[0].close.at(-1);
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    json: async () => String(url).includes('CREDIA.AT') ? companyPayload : benchmarkPayload,
  });
  const result = await fetchProfessionalHistoricalMetrics(CREDIA, {
    fetchImpl,
    generatedAt: '2026-07-30T00:00:00.000Z',
    marketSnapshot: {
      usable: true,
      currentPrice: latestRawClose,
      previousClose: latestRawClose,
      quoteAt: '2026-07-30T00:00:00.000Z',
    },
    benchmarkCache: new Map(),
  });
  assert.equal(result.series.sourceQuality, 'SECONDARY_VALIDATED');
  assert.equal(result.metrics.dataQuality.crossCheckReady, true);
  assert.equal(result.metrics.dataQuality.benchmarkReady, true);
  assert.equal(result.metrics.readiness.marketMetricsReady, true);
  assert.ok(result.metrics.liquidity.averageDailyValueTraded20 > 1_000_000);
});
