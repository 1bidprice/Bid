import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistoricalPatternForecast,
  normalizeHistoricalSeries,
} from '../src/historical-pattern-engine.js';

function cyclicalSeries(count = 1800) {
  const candles = [];
  for (let i = 0; i < count; i += 1) {
    const cycle = Math.sin((2 * Math.PI * i) / 100);
    const secondary = 0.6 * Math.sin((2 * Math.PI * i) / 25);
    const close = 100 + 0.025 * i + 8 * cycle + secondary;
    candles.push({
      timestamp: 1_700_000_000 + i * 86_400,
      open: close * 0.998,
      high: close * 1.006,
      low: close * 0.994,
      close,
      volume: 1_000_000 * (1 + 0.15 * Math.cos((2 * Math.PI * i) / 50)),
    });
  }
  return { candles };
}

test('normalization sorts, deduplicates and rejects invalid closes', () => {
  const result = normalizeHistoricalSeries([
    { timestamp: 2, close: 11 },
    { timestamp: 1, close: 10 },
    { timestamp: 2, close: 12 },
    { timestamp: 3, close: 0 },
  ]);
  assert.deepEqual(result.map((item) => [item.timestamp, item.close]), [[1, 10], [2, 12]]);
});

test('historical forecast never uses outcomes after as-of and purges overlapping analog anchors', () => {
  const series = cyclicalSeries();
  const asOfIndex = 1500;
  const asOfTimestamp = series.candles[asOfIndex].timestamp;
  const forecast = buildHistoricalPatternForecast({
    instrumentId: 'SYNTH',
    assetClass: 'EQUITY',
    series,
    asOfTimestamp,
    horizons: { month1: 21 },
    minAnalogCount: 12,
    maxAnalogs: 30,
  });
  const month = forecast.horizons.month1;
  assert.equal(month.status, 'RESEARCH_READY_UNCALIBRATED');
  assert.equal(month.finalActionEligible, false);
  assert.equal(month.probabilityPositive, null);
  assert.ok(month.rawProbabilityPositive >= 0 && month.rawProbabilityPositive <= 1);
  assert.ok(month.sample.selectedAnalogCount >= 12);
  assert.ok(month.analogs.every((item) => item.outcomeKnownByAsOf === true));
  const indexes = month.analogs.map((item) => item.anchorIndex).sort((a, b) => a - b);
  for (let i = 1; i < indexes.length; i += 1) {
    assert.ok(indexes[i] - indexes[i - 1] >= 21, `overlapping analog anchors: ${indexes[i - 1]} and ${indexes[i]}`);
  }
});

test('future mutations after as-of cannot change the forecast', () => {
  const original = cyclicalSeries();
  const asOfIndex = 1400;
  const asOfTimestamp = original.candles[asOfIndex].timestamp;
  const mutated = structuredClone(original);
  for (let i = asOfIndex + 1; i < mutated.candles.length; i += 1) {
    mutated.candles[i].close *= (i % 2 ? 8 : 0.12);
    mutated.candles[i].volume *= 25;
  }
  const options = {
    instrumentId: 'SYNTH',
    assetClass: 'EQUITY',
    asOfTimestamp,
    horizons: { month1: 21, month3: 63 },
    minAnalogCount: 10,
    maxAnalogs: 24,
  };
  const before = buildHistoricalPatternForecast({ ...options, series: original });
  const after = buildHistoricalPatternForecast({ ...options, series: mutated });
  assert.deepEqual(after.currentPattern, before.currentPattern);
  assert.deepEqual(after.horizons, before.horizons);
});

test('forecast remains research-only until walk-forward calibration exists', () => {
  const series = cyclicalSeries();
  const forecast = buildHistoricalPatternForecast({
    instrumentId: 'BTC-USD',
    assetClass: 'CRYPTO',
    series,
    asOfTimestamp: series.candles[1600].timestamp,
    horizons: { week1: 5 },
    minAnalogCount: 12,
  });
  assert.equal(forecast.periodsPerYear, 365);
  assert.equal(forecast.calibrationStatus, 'NOT_CALIBRATED');
  assert.equal(forecast.finalActionEligible, false);
  assert.match(forecast.probabilitySemantics, /walk-forward calibration/i);
});

test('insufficient history fails closed instead of inventing a probability', () => {
  const short = cyclicalSeries(150);
  const forecast = buildHistoricalPatternForecast({
    instrumentId: 'SHORT',
    assetClass: 'EQUITY',
    series: short,
    horizons: { month1: 21 },
  });
  assert.equal(forecast.status, 'INSUFFICIENT_HISTORY');
  assert.equal(forecast.finalActionEligible, false);
  assert.equal(forecast.currentPattern, null);
});
