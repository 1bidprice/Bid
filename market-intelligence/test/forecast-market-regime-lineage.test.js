import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildForecastMarketRegimeSnapshot,
  validateForecastMarketRegimeSnapshot,
} from '../src/forecast-market-regime.js';
import {
  createLiveShadowForecastRecords,
  mergeForecastOutcomeLedger,
} from '../src/forecast-outcome-ledger.js';
import { verifyForecastOutcomeArchive } from '../scripts/verify-forecast-outcome-archive.js';

const DAY_SECONDS = 86_400;
const START = Date.UTC(2024, 0, 1) / 1000;

function benchmarkSeries() {
  const candles = [];
  let close = 100;
  for (let index = 0; index < 280; index += 1) {
    const drift = index < 210
      ? (index % 4 === 0 ? 0.018 : index % 4 === 1 ? -0.012 : index % 4 === 2 ? 0.011 : -0.006)
      : 0.002;
    close *= 1 + drift;
    candles.push({
      timestamp: START + index * DAY_SECONDS,
      open: close,
      high: close * 1.002,
      low: close * 0.998,
      close,
      volume: 1_000_000,
    });
  }
  return {
    usable: true,
    symbol: 'SPY',
    providerSymbol: 'SPY',
    source: 'synthetic canonical benchmark',
    sourceQuality: 'TEST',
    candles,
  };
}

function regimeSnapshot() {
  const series = benchmarkSeries();
  const capturedAt = new Date(series.candles.at(-1).timestamp * 1000).toISOString();
  const snapshot = buildForecastMarketRegimeSnapshot({ series, capturedAt, benchmarkSymbol: 'SPY' });
  assert.equal(snapshot.status, 'REGIME_READY');
  return snapshot;
}

function dossier(forecastAt) {
  return {
    companyId: 'company:test',
    companyName: 'Test Corp',
    listing: { symbol: 'TEST', mic: 'XNAS', exchange: 'NASDAQ', currency: 'USD' },
    referencePrice: { value: 100, timestamp: forecastAt, currency: 'USD', source: 'test quote' },
  };
}

function shadow(forecastAt, marketRegimeSnapshot = undefined) {
  return {
    format: 'investor-control-shadow-forecast',
    version: 1,
    policyVersion: '2026-08-11.2',
    generatedAt: forecastAt,
    companyId: 'company:test',
    instrumentId: 'instrument:test',
    displayName: 'Test Corp',
    symbol: 'TEST',
    assetClass: 'EQUITY',
    mode: 'SHADOW_ONLY',
    decisionImpact: 'NONE',
    finalActionEligible: false,
    ...(marketRegimeSnapshot ? { marketRegimeSnapshot } : {}),
    historicalPatternForecast: {
      policyVersion: 'pattern-test-v1',
      asOf: forecastAt,
      currentPattern: { regime: 'TREND_UP' },
      horizons: {
        month1: {
          rawProbabilityPositive: 0.61,
          tradingDays: 21,
          expectedReturnPct: 2.4,
          distribution: { p25: -1.2, p50: 2.1, p75: 5.3 },
          patternConfidenceScore: 67,
        },
      },
    },
    multiFactorResearch: { horizons: {} },
    forecast: { horizons: { month1: { probabilityPositive: null, evidenceQualityScore: 72 } } },
    existingFinalActionSnapshot: null,
  };
}

function recordsFor(regime = undefined, forecastAtOverride = null) {
  const forecastAt = forecastAtOverride || regime?.capturedAt || regimeSnapshot().capturedAt;
  return createLiveShadowForecastRecords([shadow(forecastAt, regime)], [dossier(forecastAt)]);
}

function archive(records) {
  return {
    format: 'investor-control-forecast-outcome-archive',
    version: 1,
    records,
    summary: {
      recordCount: records.length,
      openCount: records.filter((record) => record.status === 'OPEN').length,
      maturedCount: records.filter((record) => record.status === 'MATURED').length,
    },
  };
}

test('runtime wiring keeps benchmark history in memory and passes it only to shadow research', () => {
  const daily = fs.readFileSync(new URL('../src/run-daily-intelligence.js', import.meta.url), 'utf8');
  const autonomous = fs.readFileSync(new URL('../src/run-autonomous-intelligence.js', import.meta.url), 'utf8');
  const shadowSource = fs.readFileSync(new URL('../src/shadow-forecast-engine.js', import.meta.url), 'utf8');
  assert.match(daily, /benchmarkSeriesCollector\.set\(company\.companyId, historyResult\.benchmarkSeries\)/);
  assert.match(autonomous, /const benchmarkSeriesCollector = new Map\(\)/);
  assert.match(autonomous, /historicalSeriesCollector, benchmarkSeriesCollector, classificationSnapshots/);
  assert.match(autonomous, /benchmarkSeriesCollector,\s*longHistoryResearchCollector/);
  assert.match(shadowSource, /buildForecastMarketRegimeSnapshot/);
  assert.match(shadowSource, /marketRegimeSnapshot/);
});

test('market regime metadata does not change forecast identity', () => {
  const regime = regimeSnapshot();
  const withRegime = recordsFor(regime)[0];
  const withoutRegime = recordsFor(undefined)[0];
  assert.equal(withRegime.forecastId, withoutRegime.forecastId);
  assert.ok(withRegime.marketRegimeSnapshot);
  assert.equal(Object.prototype.hasOwnProperty.call(withoutRegime, 'marketRegimeSnapshot'), false);
});

test('only a valid forecast-time READY regime snapshot is frozen on a new OOS record', () => {
  const regime = regimeSnapshot();
  const record = recordsFor(regime)[0];
  assert.equal(validateForecastMarketRegimeSnapshot(record.marketRegimeSnapshot, record).ok, true);
  assert.equal(record.marketRegimeSnapshot.researchOnly, true);
  assert.equal(record.marketRegimeSnapshot.finalActionEligible, false);
  assert.equal(record.marketRegimeSnapshot.decisionImpact, 'NONE');
  assert.equal(Object.prototype.hasOwnProperty.call(record.marketRegimeSnapshot, 'candles'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(record.marketRegimeSnapshot, 'series'), false);
});

test('NOT_READY or tampered regime metadata is not persisted into new OOS records', () => {
  const valid = regimeSnapshot();
  const notReady = { ...valid, status: 'REGIME_NOT_READY', regimeKey: null, riskTone: null };
  const future = { ...valid, capturedAt: new Date(new Date(valid.capturedAt).getTime() + DAY_SECONDS * 1000).toISOString() };
  assert.equal(Object.prototype.hasOwnProperty.call(recordsFor(notReady)[0], 'marketRegimeSnapshot'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(recordsFor(future, valid.capturedAt)[0], 'marketRegimeSnapshot'), false);
});

test('legacy forecast identity without regime cannot be backfilled during maturation merge', () => {
  const regime = regimeSnapshot();
  const legacy = recordsFor(undefined)[0];
  const incoming = {
    ...recordsFor(regime)[0],
    status: 'MATURED',
    positiveOutcome: 1,
    realisedOutcome: { timestamp: new Date(new Date(legacy.forecastAt).getTime() + 21 * DAY_SECONDS * 1000).toISOString(), close: 103, realisedReturnPct: 3 },
    outcomeEvaluatedAt: new Date(new Date(legacy.forecastAt).getTime() + 22 * DAY_SECONDS * 1000).toISOString(),
  };
  assert.equal(legacy.forecastId, incoming.forecastId);
  const merged = mergeForecastOutcomeLedger([legacy], [incoming]);
  assert.equal(merged[0].status, 'MATURED');
  assert.equal(Object.prototype.hasOwnProperty.call(merged[0], 'marketRegimeSnapshot'), false);
});

test('forecast-time regime already present on an OOS identity is preserved exactly through maturation', () => {
  const regime = regimeSnapshot();
  const existing = recordsFor(regime)[0];
  const incoming = {
    ...existing,
    marketRegimeSnapshot: undefined,
    status: 'MATURED',
    positiveOutcome: 1,
    realisedOutcome: { timestamp: new Date(new Date(existing.forecastAt).getTime() + 21 * DAY_SECONDS * 1000).toISOString(), close: 104, realisedReturnPct: 4 },
    outcomeEvaluatedAt: new Date(new Date(existing.forecastAt).getTime() + 22 * DAY_SECONDS * 1000).toISOString(),
  };
  delete incoming.marketRegimeSnapshot;
  const merged = mergeForecastOutcomeLedger([existing], [incoming]);
  assert.deepEqual(merged[0].marketRegimeSnapshot, existing.marketRegimeSnapshot);
});

test('archive verifier remains backward compatible with legacy records that have no regime snapshot', () => {
  const legacy = recordsFor(undefined)[0];
  const result = verifyForecastOutcomeArchive(archive([legacy]));
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('archive verifier rejects future or decision-authority regime metadata', () => {
  const regime = regimeSnapshot();
  const base = recordsFor(regime)[0];
  const future = structuredClone(base);
  future.marketRegimeSnapshot.benchmarkAsOf = new Date(new Date(base.forecastAt).getTime() + DAY_SECONDS * 1000).toISOString();
  const futureResult = verifyForecastOutcomeArchive(archive([future]));
  assert.equal(futureResult.ok, false);
  assert.ok(futureResult.errors.some((error) => error.includes('MARKET_REGIME_DATA_AFTER_FORECAST')));

  const authority = structuredClone(base);
  authority.marketRegimeSnapshot.finalActionEligible = true;
  authority.marketRegimeSnapshot.decisionImpact = 'BUY';
  const authorityResult = verifyForecastOutcomeArchive(archive([authority]));
  assert.equal(authorityResult.ok, false);
  assert.ok(authorityResult.errors.some((error) => error.includes('MARKET_REGIME_FINAL_ACTION_FORBIDDEN')));
  assert.ok(authorityResult.errors.some((error) => error.includes('MARKET_REGIME_DECISION_IMPACT_FORBIDDEN')));
});

test('archive verifier rejects raw benchmark series leakage inside a regime snapshot', () => {
  const regime = regimeSnapshot();
  const record = recordsFor(regime)[0];
  record.marketRegimeSnapshot.series = { candles: benchmarkSeries().candles };
  const result = verifyForecastOutcomeArchive(archive([record]));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('MARKET_REGIME_RAW_SERIES_FORBIDDEN')));
});
