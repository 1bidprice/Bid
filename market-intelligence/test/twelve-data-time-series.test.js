import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTwelveDataTimeSeries, normalizeTwelveDataTimeSeries } from '../src/adapters/twelve-data-time-series.js';

test('Twelve Data normalizer sorts ascending, deduplicates timestamps and keeps raw close only', () => {
  const payload = {
    meta: { symbol: 'ABC', interval: '1day', currency: 'USD', exchange: 'NASDAQ', mic_code: 'XNAS', type: 'Common Stock' },
    values: [
      { datetime: '2026-08-11', open: '10.0', high: '11.0', low: '9.5', close: '10.5', volume: '1000' },
      { datetime: '2026-08-09', open: '9.0', high: '10.0', low: '8.5', close: '9.5', volume: '900' },
      { datetime: '2026-08-10', close: 'not-a-number', volume: '950' },
      { datetime: '2026-08-11', close: '10.7', volume: '1100' },
    ],
  };
  const series = normalizeTwelveDataTimeSeries(payload, { generatedAt: '2026-08-11T12:00:00Z', sourceUrl: 'https://api.twelvedata.com/time_series?symbol=ABC' });
  assert.equal(series.usable, true);
  assert.equal(series.sourceQuality, 'SECONDARY_UNVALIDATED');
  assert.equal(series.adjustment, 'RAW_CLOSE');
  assert.equal(series.researchOnly, true);
  assert.equal(series.decisionEligible, false);
  assert.equal(series.executionEligible, false);
  assert.equal(series.candles.length, 2);
  assert.ok(series.candles[0].timestamp < series.candles[1].timestamp);
  assert.equal(series.candles[1].close, 10.7);
  assert.equal(series.candles[1].rawClose, 10.7);
  assert.equal(series.candles[1].adjustedClose, null);
});

test('Twelve Data fetch fails closed without an API key and performs no network call', async () => {
  let calls = 0;
  const result = await fetchTwelveDataTimeSeries('ABC', { fetchImpl: async () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.equal(result.series, null);
  assert.ok(result.diagnostics.some((item) => item.code === 'TWELVE_DATA_API_KEY_MISSING'));
});

test('Twelve Data request carries symbol, daily interval, output size and MIC but never serializes the API key into sourceUrl', async () => {
  let requestedUrl = null;
  const apiKey = 'super-secret-key';
  const result = await fetchTwelveDataTimeSeries('ABC', {
    apiKey,
    outputsize: 180,
    micCode: 'XNAS',
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        async json() {
          return {
            meta: { symbol: 'ABC', interval: '1day', currency: 'USD', exchange: 'NASDAQ', mic_code: 'XNAS', type: 'Common Stock' },
            values: [{ datetime: '2026-08-11', close: '10.5', volume: '1000' }],
          };
        },
      };
    },
  });
  assert.match(requestedUrl, /symbol=ABC/);
  assert.match(requestedUrl, /interval=1day/);
  assert.match(requestedUrl, /outputsize=180/);
  assert.match(requestedUrl, /mic_code=XNAS/);
  assert.match(requestedUrl, /apikey=super-secret-key/);
  assert.equal(result.series.usable, true);
  assert.doesNotMatch(result.series.sourceUrl, /super-secret-key/);
  assert.ok(!JSON.stringify(result.diagnostics).includes(apiKey));
});

test('Twelve Data provider and HTTP rate-limit failures remain unusable diagnostics', async () => {
  const httpLimited = await fetchTwelveDataTimeSeries('ABC', {
    apiKey: 'key',
    fetchImpl: async () => ({ ok: false, status: 429 }),
  });
  assert.equal(httpLimited.series, null);
  assert.ok(httpLimited.diagnostics.some((item) => item.code === 'TWELVE_DATA_RATE_LIMITED'));

  const providerLimited = await fetchTwelveDataTimeSeries('ABC', {
    apiKey: 'key',
    fetchImpl: async () => ({
      ok: true,
      async json() { return { status: 'error', code: 429, message: 'rate limit' }; },
    }),
  });
  assert.equal(providerLimited.series, null);
  assert.ok(providerLimited.diagnostics.some((item) => item.code === 'TWELVE_DATA_RATE_LIMITED'));
});
