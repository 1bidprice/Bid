import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calibrateForecastProbability,
  evaluateForecastCalibration,
  evaluateForecastPromotionGate,
} from '../src/forecast-calibration.js';

function calibratedHistory(count = 400, validationMode = 'WALK_FORWARD_OOS') {
  const records = [];
  for (let i = 0; i < count; i += 1) {
    const bucket = i % 10;
    const probability = (bucket + 0.5) / 10;
    const threshold = ((i * 37) % 100) / 100;
    records.push({
      rawProbabilityPositive: probability,
      positiveOutcome: threshold < probability ? 1 : 0,
      validationMode,
      timestamp: `t${i}`,
    });
  }
  return records;
}

test('calibration ignores non-OOS records', () => {
  const records = calibratedHistory(120);
  records.push(...Array.from({ length: 500 }, () => ({ probability: 0.99, outcome: 1, validationMode: 'IN_SAMPLE' })));
  const summary = evaluateForecastCalibration(records, { minimumTotal: 100 });
  assert.equal(summary.sampleSize, 120);
  assert.equal(summary.status, 'OOS_METRICS_READY');
  assert.deepEqual(summary.validationModes, ['WALK_FORWARD_OOS']);
});

test('matured live shadow outcomes are valid OOS calibration evidence while in-sample records remain excluded', () => {
  const records = [
    ...calibratedHistory(60, 'WALK_FORWARD_OOS'),
    ...calibratedHistory(60, 'LIVE_SHADOW_OOS'),
    ...calibratedHistory(500, 'IN_SAMPLE'),
  ];
  const summary = evaluateForecastCalibration(records, { minimumTotal: 100 });
  assert.equal(summary.sampleSize, 120);
  assert.equal(summary.status, 'OOS_METRICS_READY');
  assert.deepEqual(summary.validationModes, ['LIVE_SHADOW_OOS', 'WALK_FORWARD_OOS']);
});

test('probability calibration fails closed without enough OOS history', () => {
  const result = calibrateForecastProbability(0.72, calibratedHistory(40), { minimumTotal: 100 });
  assert.equal(result.status, 'NOT_CALIBRATED');
  assert.equal(result.calibratedProbability, null);
});

test('calibration produces an empirical OOS probability only when local support is sufficient', () => {
  const records = calibratedHistory(500);
  const result = calibrateForecastProbability(0.72, records, { minimumTotal: 100, minimumBin: 20 });
  assert.equal(result.status, 'CALIBRATED');
  assert.ok(result.calibratedProbability > 0 && result.calibratedProbability < 1);
  assert.ok(result.localSampleSize >= 20);
  assert.equal(result.method, 'OOS_HISTOGRAM_BETA_SHRINKAGE');
});

test('promotion gate requires sample, probabilistic skill and calibration accuracy together', () => {
  const blocked = evaluateForecastPromotionGate({
    status: 'OOS_METRICS_READY',
    sampleSize: 300,
    skillVsBaseRatePct: 2,
    expectedCalibrationError: 0.04,
  });
  assert.equal(blocked.forecastMayInfluenceFinalAction, false);
  assert.ok(blocked.blockers.includes('INSUFFICIENT_PROBABILISTIC_SKILL'));

  const allowed = evaluateForecastPromotionGate({
    status: 'OOS_METRICS_READY',
    sampleSize: 300,
    skillVsBaseRatePct: 12,
    expectedCalibrationError: 0.04,
  });
  assert.equal(allowed.status, 'PROMOTION_ELIGIBLE');
  assert.equal(allowed.forecastMayInfluenceFinalAction, true);
});
