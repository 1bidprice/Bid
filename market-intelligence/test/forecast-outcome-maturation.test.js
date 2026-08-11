import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDueForecastOutcomeHistory } from '../src/forecast-outcome-maturation.js';

function openRecord({ companyId = 'sec-cik:123', symbol = 'ABC', tradingDays = 1, reference = '2026-08-10T20:00:00.000Z', listing = null } = {}) {
  return {
    forecastId: `forecast:${companyId}:${tradingDays}`,
    validationMode: 'LIVE_SHADOW_OOS',
    status: 'OPEN',
    companyId,
    displayName: 'Archived Company',
    symbol,
    listing,
    tradingDays,
    forecastAt: reference,
    referencePrice: { value: 100, timestamp: reference, currency: 'USD', source: 'canonical' },
  };
}

function validatedSeries(sourceQuality = 'PRIMARY_LICENSED') {
  return {
    usable: true,
    source: sourceQuality === 'PRIMARY_LICENSED' ? 'Finnhub Historical' : 'Yahoo Finance Chart',
    sourceQuality,
    candles: Array.from({ length: 300 }, (_, index) => ({ timestamp: 1_700_000_000 + index * 86_400, close: 100 + index / 10 })),
  };
}

test('due archived US forecast can fetch validated outcome history even when company is absent from today universe', async () => {
  const calls = [];
  const result = await collectDueForecastOutcomeHistory({
    generatedAt: '2026-08-12T20:00:00.000Z',
    existingRecords: [openRecord()],
    universe: [],
    historicalSeriesCollector: new Map(),
    options: {
      outcomeMaturationHistoryFetcher: async (company) => {
        calls.push(company);
        return { series: validatedSeries(), diagnostics: [] };
      },
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].country, 'US');
  assert.equal(calls[0].primaryListing.symbol, 'ABC');
  assert.equal(result.collector.get('sec-cik:123').sourceQuality, 'PRIMARY_LICENSED');
  assert.equal(result.summary.readyCount, 1);
  assert.equal(result.summary.finalActionImpact, 'NONE');
});

test('not-yet-due forecast performs no network work', async () => {
  let calls = 0;
  const result = await collectDueForecastOutcomeHistory({
    generatedAt: '2026-08-11T08:00:00.000Z',
    existingRecords: [openRecord({ tradingDays: 5 })],
    historicalSeriesCollector: new Map(),
    options: { outcomeMaturationHistoryFetcher: async () => { calls += 1; return { series: validatedSeries(), diagnostics: [] }; } },
  });
  assert.equal(calls, 0);
  assert.equal(result.summary.dueRecordCount, 0);
  assert.equal(result.collector.size, 0);
});

test('current canonical series suppresses redundant archive-only fetch', async () => {
  let calls = 0;
  const current = validatedSeries();
  const result = await collectDueForecastOutcomeHistory({
    generatedAt: '2026-08-12T20:00:00.000Z',
    existingRecords: [openRecord()],
    historicalSeriesCollector: new Map([['sec-cik:123', current]]),
    options: { outcomeMaturationHistoryFetcher: async () => { calls += 1; return { series: validatedSeries(), diagnostics: [] }; } },
  });
  assert.equal(calls, 0);
  assert.equal(result.summary.alreadyCoveredCompanyCount, 1);
  assert.equal(result.collector.size, 0);
});

test('secondary outcome history is accepted only with explicit recent canonical cross-check', async () => {
  const rejected = await collectDueForecastOutcomeHistory({
    generatedAt: '2026-08-12T20:00:00.000Z',
    existingRecords: [openRecord()],
    historicalSeriesCollector: new Map(),
    options: { outcomeMaturationHistoryFetcher: async () => ({ series: validatedSeries('SECONDARY_VALIDATED'), diagnostics: [] }) },
  });
  assert.equal(rejected.summary.readyCount, 0);
  assert.equal(rejected.summary.rejectedCount, 1);
  assert.equal(rejected.collector.size, 0);

  const accepted = await collectDueForecastOutcomeHistory({
    generatedAt: '2026-08-12T20:00:00.000Z',
    existingRecords: [openRecord()],
    historicalSeriesCollector: new Map(),
    options: {
      outcomeMaturationHistoryFetcher: async () => ({
        series: validatedSeries('SECONDARY_VALIDATED'),
        diagnostics: [{ code: 'VALIDATED_HISTORY_FALLBACK_ACTIVE', crossCheckReady: true }],
      }),
    },
  });
  assert.equal(accepted.summary.readyCount, 1);
  assert.equal(accepted.collector.size, 1);
});

test('multiple due horizons for one archived company trigger only one bounded history fetch', async () => {
  let calls = 0;
  const records = [openRecord({ tradingDays: 1 }), openRecord({ tradingDays: 5 })];
  const result = await collectDueForecastOutcomeHistory({
    generatedAt: '2026-08-20T20:00:00.000Z',
    existingRecords: records,
    historicalSeriesCollector: new Map(),
    options: { outcomeMaturationHistoryFetcher: async () => { calls += 1; return { series: validatedSeries(), diagnostics: [] }; } },
  });
  assert.equal(result.summary.dueRecordCount, 2);
  assert.equal(result.summary.dueCompanyCount, 1);
  assert.equal(calls, 1);
  assert.equal(result.summary.fetchedCount, 1);
});

test('archived Athens identity can be reconstructed from the immutable listing snapshot', async () => {
  const record = openRecord({
    companyId: 'company:xath:term-999',
    symbol: 'TEST',
    listing: { symbol: 'TEST', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' },
  });
  let reconstructed = null;
  const result = await collectDueForecastOutcomeHistory({
    generatedAt: '2026-08-12T20:00:00.000Z',
    existingRecords: [record],
    historicalSeriesCollector: new Map(),
    options: {
      outcomeMaturationHistoryFetcher: async (company) => {
        reconstructed = company;
        return { series: validatedSeries(), diagnostics: [] };
      },
    },
  });
  assert.equal(reconstructed.country, 'GR');
  assert.equal(reconstructed.primaryListing.mic, 'XATH');
  assert.equal(result.summary.readyCount, 1);
});
