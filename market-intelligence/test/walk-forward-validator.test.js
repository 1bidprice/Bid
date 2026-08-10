import test from 'node:test';
import assert from 'node:assert/strict';
import { runHistoricalPatternWalkForward } from '../src/walk-forward-validator.js';

function cyclicalSeries(count = 1500) {
  const candles = [];
  for (let i = 0; i < count; i += 1) {
    const cycle = Math.sin((2 * Math.PI * i) / 80);
    const close = 100 + 0.02 * i + 7 * cycle;
    candles.push({
      timestamp: 1_680_000_000 + i * 86_400,
      close,
      volume: 800_000 * (1 + 0.1 * Math.cos((2 * Math.PI * i) / 40)),
    });
  }
  return { candles };
}

test('walk-forward records are strict OOS forecasts with outcomes after forecast time', () => {
  const result = runHistoricalPatternWalkForward({
    instrumentId: 'SYNTH',
    assetClass: 'EQUITY',
    series: cyclicalSeries(),
    horizons: { month1: 21 },
    warmupObservations: 600,
    evaluationStep: 42,
    minAnalogCount: 10,
    maxAnalogs: 25,
    minimumForecastsForMetrics: 20,
  });
  const month = result.horizons.month1;
  assert.ok(month.records.length >= 10);
  assert.ok(month.records.every((record) => record.validationMode === 'WALK_FORWARD_OOS'));
  assert.ok(month.records.every((record) => new Date(record.outcomeKnownAt) > new Date(record.forecastAt)));
  assert.ok(month.records.every((record) => record.rawProbabilityPositive >= 0 && record.rawProbabilityPositive <= 1));
  assert.equal(result.finalActionEligible, false);
});

test('walk-forward calibration only becomes available after the configured OOS sample threshold', () => {
  const series = cyclicalSeries(1050);
  const blocked = runHistoricalPatternWalkForward({
    instrumentId: 'SYNTH',
    assetClass: 'EQUITY',
    series,
    horizons: { month1: 21 },
    warmupObservations: 650,
    evaluationStep: 84,
    minAnalogCount: 8,
    minimumForecastsForMetrics: 50,
  });
  assert.equal(blocked.horizons.month1.calibration.status, 'INSUFFICIENT_OOS_HISTORY');
});

test('walk-forward validator preserves asset class and never promotes itself directly to an action', () => {
  const result = runHistoricalPatternWalkForward({
    instrumentId: 'BTC-USD',
    assetClass: 'CRYPTO',
    series: cyclicalSeries(1200),
    periodsPerYear: 365,
    horizons: { week1: 5 },
    warmupObservations: 600,
    evaluationStep: 60,
    minAnalogCount: 10,
    minimumForecastsForMetrics: 20,
  });
  assert.equal(result.assetClass, 'CRYPTO');
  assert.equal(result.methodology.validationMode, 'EXPANDING_WINDOW_WALK_FORWARD');
  assert.equal(result.finalActionEligible, false);
});
