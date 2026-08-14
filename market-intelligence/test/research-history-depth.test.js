import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProfessionalHistoricalMetrics, resolveYahooHistoryRange } from '../src/professional-market-data.js';

const COMPANY = {
  companyId: 'company:research-depth-test',
  legalName: 'Research Depth Test S.A.',
  displayName: 'Research Depth Test',
  primaryListing: { exchange: 'Euronext Athens', symbol: 'RDT', mic: 'XATH' },
  listings: [{ exchange: 'Euronext Athens', symbol: 'RDT', mic: 'XATH', currency: 'EUR', active: true }],
  country: 'GR',
  currency: 'EUR',
  marketData: {
    yahooSymbols: ['RDT.AT'],
    benchmarkYahooSymbols: ['GD.AT'],
  },
};

function chartPayload(symbol, startPrice) {
  const count = 1_100;
  const timestamp = [];
  const close = [];
  const open = [];
  const high = [];
  const low = [];
  const volume = [];
  const adjclose = [];
  const base = Math.floor(new Date('2023-08-10T14:00:00.000Z').getTime() / 1000);
  let price = startPrice;
  for (let index = 0; index < count; index += 1) {
    price *= 1.0005;
    timestamp.push(base + index * 86_400);
    close.push(price);
    open.push(price * 0.998);
    high.push(price * 1.01);
    low.push(price * 0.99);
    volume.push(2_000_000);
    adjclose.push(price);
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
          adjclose: [{ adjclose }],
        },
      }],
      error: null,
    },
  };
}

test('research lookback maps to bounded Yahoo ranges without changing production default', () => {
  assert.equal(resolveYahooHistoryRange({}), '2y');
  assert.equal(resolveYahooHistoryRange({ lookbackDays: 730 }), '2y');
  assert.equal(resolveYahooHistoryRange({ lookbackDays: 1825 }), '5y');
  assert.equal(resolveYahooHistoryRange({ lookbackDays: 3650 }), '10y');
  assert.equal(resolveYahooHistoryRange({ lookbackDays: 3651 }), 'max');
});

test('five-year research depth is requested for both company and benchmark history', async () => {
  const companyPayload = chartPayload('RDT.AT', 10);
  const benchmarkPayload = chartPayload('GD.AT', 1_500);
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => String(url).includes('RDT.AT') ? companyPayload : benchmarkPayload,
    };
  };
  const latest = companyPayload.chart.result[0].indicators.quote[0].close.at(-1);
  const quoteAt = new Date(companyPayload.chart.result[0].meta.regularMarketTime * 1000).toISOString();

  const result = await fetchProfessionalHistoricalMetrics(COMPANY, {
    fetchImpl,
    generatedAt: '2026-08-13T18:00:00.000Z',
    lookbackDays: 1825,
    marketSnapshot: {
      usable: true,
      currentPrice: latest,
      previousClose: latest,
      quoteAt,
      generatedAt: quoteAt,
    },
    benchmarkCache: new Map(),
  });

  assert.equal(result.series?.usable, true);
  assert.equal(result.benchmarkSeries?.usable, true);
  assert.ok(requestedUrls.some((url) => url.includes('/RDT.AT?') && url.includes('range=5y')));
  assert.ok(requestedUrls.some((url) => url.includes('/GD.AT?') && url.includes('range=5y')));
});
