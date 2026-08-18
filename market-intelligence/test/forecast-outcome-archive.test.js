import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveShadowForecastRecords, mergeForecastOutcomeLedger } from '../src/forecast-outcome-ledger.js';
import { mergeForecastOutcomeArchives, runForecastOutcomeArchiveCycle } from '../src/forecast-outcome-archive.js';

function shadow(generatedAt, referenceAsOf = generatedAt) {
  return {
    policyVersion: 'shadow-v2',
    generatedAt,
    companyId: 'company:ABC',
    instrumentId: 'company:ABC',
    displayName: 'ABC Corp',
    symbol: 'ABC',
    assetClass: 'EQUITY',
    mode: 'SHADOW_ONLY',
    decisionImpact: 'NONE',
    existingFinalActionSnapshot: { status: 'FINAL', marketAction: 'HOLD' },
    historicalPatternForecast: {
      policyVersion: 'pattern-v2',
      asOf: referenceAsOf,
      currentPattern: { regime: 'BULL_TREND' },
      horizons: {
        week1: { tradingDays: 5, rawProbabilityPositive: 0.61, expectedReturnPct: 1.4, distribution: { medianReturnPct: 1.1 }, patternConfidenceScore: 54 },
        month1: { tradingDays: 21, rawProbabilityPositive: 0.66, expectedReturnPct: 3.8, distribution: { medianReturnPct: 3.1 }, patternConfidenceScore: 60 },
      },
    },
    forecast: { horizons: { week1: { probabilityPositive: null, evidenceQualityScore: 80 }, month1: { probabilityPositive: null, evidenceQualityScore: 80 } } },
  };
}

function dossier(timestamp, value = 100) {
  return {
    companyId: 'company:ABC',
    referencePrice: { value, timestamp, currency: 'USD', source: 'canonical' },
  };
}

function marketSeries(startSeconds, count = 10) {
  return {
    usable: true,
    source: 'Finnhub Historical',
    candles: Array.from({ length: count }, (_, index) => ({
      timestamp: startSeconds + index * 86_400,
      close: 100 + index,
      volume: 1_000_000,
    })),
  };
}

test('multiple production runs on the same trading date create the same OOS forecast identities', () => {
  const firstAt = '2027-01-15T14:00:00.000Z';
  const laterAt = '2027-01-15T20:00:00.000Z';
  const first = createLiveShadowForecastRecords([shadow(firstAt)], [dossier(firstAt)]);
  const later = createLiveShadowForecastRecords([shadow(laterAt)], [dossier(laterAt, 101)]);
  assert.deepEqual(first.map((item) => item.forecastId), later.map((item) => item.forecastId));
  assert.ok(first.every((item) => item.forecastSampleDate === '2027-01-15'));
  const merged = mergeForecastOutcomeLedger(first, later);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].referencePrice.value, 100);
});

test('a new trading date creates a new independent daily forecast identity', () => {
  const firstAt = '2027-01-15T20:00:00.000Z';
  const nextAt = '2027-01-16T20:00:00.000Z';
  const first = createLiveShadowForecastRecords([shadow(firstAt)], [dossier(firstAt)]);
  const next = createLiveShadowForecastRecords([shadow(nextAt)], [dossier(nextAt)]);
  assert.notDeepEqual(first.map((item) => item.forecastId), next.map((item) => item.forecastId));
});

test('archive cycle appends daily shadow forecasts and matures only horizons observable in canonical future sessions', () => {
  const start = 1_800_000_000;
  const reference = new Date(start * 1000).toISOString();
  const cycle = runForecastOutcomeArchiveCycle({
    generatedAt: new Date((start + 9 * 86_400) * 1000).toISOString(),
    existingRecords: [],
    shadowForecasts: [shadow(reference, reference)],
    researchDossiers: [dossier(reference)],
    historicalSeriesCollector: new Map([['company:ABC', marketSeries(start, 10)]]),
    options: { forecastCalibrationMinimumTotal: 20 },
  });
  assert.equal(cycle.format, 'investor-control-forecast-outcome-archive');
  assert.equal(cycle.records.length, 2);
  assert.equal(cycle.records.find((item) => item.horizon === 'week1').status, 'MATURED');
  assert.equal(cycle.records.find((item) => item.horizon === 'month1').status, 'OPEN');
  assert.equal(cycle.evaluation.maturedThisRun, 1);
  assert.equal(cycle.summary.maturedCount, 1);
  assert.equal(cycle.summary.openCount, 1);
});

test('archive cycle preserves open records when canonical market history is unavailable rather than inventing outcomes', () => {
  const generatedAt = '2027-01-15T20:00:00.000Z';
  const cycle = runForecastOutcomeArchiveCycle({
    generatedAt,
    shadowForecasts: [shadow(generatedAt)],
    researchDossiers: [dossier(generatedAt)],
    historicalSeriesCollector: new Map(),
  });
  assert.equal(cycle.records.length, 2);
  assert.ok(cycle.records.every((item) => item.status === 'OPEN'));
  assert.equal(cycle.evaluation.missingCanonicalSeriesCount, 2);
});

test('transactional archive merge preserves remote MATURED outcomes over an incoming stale OPEN copy', () => {
  const start = 1_800_000_000;
  const reference = new Date(start * 1000).toISOString();
  const maturedArchive = runForecastOutcomeArchiveCycle({
    generatedAt: new Date((start + 9 * 86_400) * 1000).toISOString(),
    shadowForecasts: [shadow(reference)],
    researchDossiers: [dossier(reference)],
    historicalSeriesCollector: new Map([['company:ABC', marketSeries(start, 10)]]),
  });
  const staleOpenRecords = createLiveShadowForecastRecords([shadow(reference)], [dossier(reference)]);
  const incoming = { format: 'investor-control-forecast-outcome-archive', version: 1, updatedAt: reference, records: staleOpenRecords };
  const merged = mergeForecastOutcomeArchives(maturedArchive, incoming, { updatedAt: '2027-02-01T00:00:00.000Z' });
  const week = merged.records.find((item) => item.horizon === 'week1');
  assert.equal(week.status, 'MATURED');
  assert.equal(week.positiveOutcome, 1);
  assert.equal(new Set(merged.records.map((item) => item.forecastId)).size, merged.records.length);
});
