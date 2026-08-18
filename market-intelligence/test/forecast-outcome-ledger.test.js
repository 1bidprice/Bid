import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLiveShadowForecastRecords,
  evaluateLiveShadowForecastRecord,
  mergeForecastOutcomeLedger,
  summarizeForecastOutcomeLedger,
} from '../src/forecast-outcome-ledger.js';

function candles(count = 80, start = 1_800_000_000) {
  return {
    candles: Array.from({ length: count }, (_, i) => ({
      timestamp: start + i * 86_400,
      close: 100 + i,
      volume: 1_000_000,
    })),
  };
}

function shadow(generatedAt = '2027-01-15T00:00:00.000Z') {
  return {
    policyVersion: 'shadow-v1',
    generatedAt,
    companyId: 'company:ABC',
    instrumentId: 'company:ABC',
    displayName: 'ABC Corp',
    symbol: 'ABC',
    assetClass: 'EQUITY',
    mode: 'SHADOW_ONLY',
    decisionImpact: 'NONE',
    finalActionEligible: false,
    existingFinalActionSnapshot: { status: 'FINAL', marketAction: 'HOLD' },
    historicalPatternForecast: {
      policyVersion: 'pattern-v1',
      asOf: generatedAt,
      currentPattern: { regime: 'BULL_TREND' },
      horizons: {
        week1: { tradingDays: 5, rawProbabilityPositive: 0.62, expectedReturnPct: 1.8, distribution: { medianReturnPct: 1.2 }, patternConfidenceScore: 55 },
        month1: { tradingDays: 21, rawProbabilityPositive: 0.68, expectedReturnPct: 4.4, distribution: { medianReturnPct: 3.7 }, patternConfidenceScore: 61 },
      },
    },
    forecast: {
      horizons: {
        week1: { probabilityPositive: null, evidenceQualityScore: 82 },
        month1: { probabilityPositive: null, evidenceQualityScore: 82 },
      },
    },
  };
}

function dossier(referenceTimestamp = '2027-01-15T00:00:00.000Z') {
  return {
    companyId: 'company:ABC',
    referencePrice: {
      value: 100,
      timestamp: referenceTimestamp,
      currency: 'USD',
      source: 'verified-reference',
    },
  };
}

test('live shadow forecasts become append-only OPEN OOS outcome records per horizon', () => {
  const records = createLiveShadowForecastRecords([shadow()], [dossier()]);
  assert.equal(records.length, 2);
  assert.ok(records.every((record) => record.validationMode === 'LIVE_SHADOW_OOS'));
  assert.ok(records.every((record) => record.status === 'OPEN'));
  assert.ok(records.every((record) => record.decisionImpact === 'NONE'));
  assert.equal(new Set(records.map((record) => record.forecastId)).size, 2);
  const again = createLiveShadowForecastRecords([shadow()], [dossier()]);
  assert.deepEqual(again.map((record) => record.forecastId), records.map((record) => record.forecastId));
});

test('live shadow record stays OPEN until its future trading-session outcome exists', () => {
  const start = 1_800_000_000;
  const referenceTimestamp = new Date(start * 1000).toISOString();
  const record = createLiveShadowForecastRecords([shadow(referenceTimestamp)], [dossier(referenceTimestamp)])[0];
  const early = evaluateLiveShadowForecastRecord(record, candles(5, start), { evaluatedAt: '2027-02-01T00:00:00.000Z' });
  assert.equal(early.status, 'OPEN');
  assert.equal(early.positiveOutcome, null);
});

test('live shadow record matures from future market data and records the realised outcome', () => {
  const start = 1_800_000_000;
  const referenceTimestamp = new Date(start * 1000).toISOString();
  const record = createLiveShadowForecastRecords([shadow(referenceTimestamp)], [dossier(referenceTimestamp)])[0];
  const matured = evaluateLiveShadowForecastRecord(record, candles(10, start), { evaluatedAt: '2027-02-01T00:00:00.000Z' });
  assert.equal(matured.status, 'MATURED');
  assert.equal(matured.positiveOutcome, 1);
  assert.equal(matured.realisedOutcome.close, 105);
  assert.equal(matured.realisedOutcome.realisedReturnPct, 5);
});

test('ledger merge never replaces a matured result with an older open copy', () => {
  const start = 1_800_000_000;
  const referenceTimestamp = new Date(start * 1000).toISOString();
  const open = createLiveShadowForecastRecords([shadow(referenceTimestamp)], [dossier(referenceTimestamp)])[0];
  const matured = evaluateLiveShadowForecastRecord(open, candles(10, start));
  const merged = mergeForecastOutcomeLedger([matured], [open]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'MATURED');
  assert.equal(merged[0].positiveOutcome, 1);
});

test('matured LIVE_SHADOW_OOS records are eligible for calibration summaries while in-sample data is not', () => {
  const records = Array.from({ length: 20 }, (_, i) => ({
    forecastId: `forecast:${i}`,
    validationMode: 'LIVE_SHADOW_OOS',
    assetClass: 'EQUITY',
    horizon: 'month1',
    status: 'MATURED',
    rawProbabilityPositive: i % 2 ? 0.7 : 0.3,
    positiveOutcome: i % 2 ? 1 : 0,
  }));
  records.push({
    forecastId: 'forecast:insample',
    validationMode: 'IN_SAMPLE',
    assetClass: 'EQUITY',
    horizon: 'month1',
    status: 'MATURED',
    rawProbabilityPositive: 0.99,
    positiveOutcome: 1,
  });
  const summary = summarizeForecastOutcomeLedger(records, { minimumTotal: 20, binCount: 4 });
  assert.equal(summary.maturedCount, 21);
  assert.equal(summary.groups.length, 1);
  assert.equal(summary.groups[0].calibration.sampleSize, 20);
  assert.equal(summary.groups[0].calibration.status, 'OOS_METRICS_READY');
  assert.deepEqual(summary.groups[0].calibration.validationModes, ['LIVE_SHADOW_OOS']);
});
