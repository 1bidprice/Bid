import { normalizeHistoricalSeries } from './historical-pattern-engine.js';

export const MINBEIS_SIMPLE_BASELINE_VERSION = '2026-09-23.1';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const alpha = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < values.length; index += 1) {
    current = (values[index] * alpha) + (current * (1 - alpha));
  }
  return current;
}

function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) return null;
  const sample = values.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < sample.length; index += 1) {
    const change = sample[index] - sample[index - 1];
    if (change > 0) gains += change;
    if (change < 0) losses += Math.abs(change);
  }
  const averageGain = gains / period;
  const averageLoss = losses / period;
  if (averageLoss === 0) return averageGain > 0 ? 100 : 50;
  const rs = averageGain / averageLoss;
  return 100 - (100 / (1 + rs));
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function anchorIndex(candles, decisionAt) {
  const target = new Date(decisionAt).getTime() / 1000;
  if (!Number.isFinite(target)) return -1;
  let index = -1;
  for (let cursor = 0; cursor < candles.length; cursor += 1) {
    if (candles[cursor].timestamp <= target) index = cursor;
    else break;
  }
  return index;
}

export function buildMinbeisSimpleBaselineSnapshot(series, decisionAt) {
  const candles = normalizeHistoricalSeries(series);
  const index = anchorIndex(candles, decisionAt);
  if (index < 59) {
    return {
      format: 'minbeis-simple-baseline-snapshot',
      version: 1,
      policyVersion: MINBEIS_SIMPLE_BASELINE_VERSION,
      status: 'NOT_READY',
      action: null,
      blockers: ['BASELINE_HISTORY_TOO_SHORT'],
      decisionImpact: 'NONE',
      finalActionEligible: false,
    };
  }

  const history = candles.slice(0, index + 1);
  const closes = history.map((item) => finite(item.close)).filter(Number.isFinite);
  const volumes = history.map((item) => finite(item.volume));
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const currentVolume = finite(history.at(-1)?.volume);
  const averageVolume20 = mean(volumes.slice(-20));
  const volumeRatio20 = Number.isFinite(currentVolume) && Number.isFinite(averageVolume20) && averageVolume20 > 0
    ? currentVolume / averageVolume20
    : null;

  const blockers = [];
  if (![ema20, ema50, rsi14].every(Number.isFinite)) blockers.push('BASELINE_TECHNICALS_UNAVAILABLE');
  if (!Number.isFinite(volumeRatio20)) blockers.push('BASELINE_VOLUME_UNAVAILABLE');

  const entry = blockers.length === 0
    && ema20 > ema50
    && rsi14 >= 50
    && rsi14 <= 70
    && volumeRatio20 >= 1;

  return {
    format: 'minbeis-simple-baseline-snapshot',
    version: 1,
    policyVersion: MINBEIS_SIMPLE_BASELINE_VERSION,
    status: blockers.length ? 'NOT_READY' : 'READY',
    action: blockers.length ? null : (entry ? 'ENTRY' : 'NO_TRADE'),
    capturedAt: new Date(decisionAt).toISOString(),
    marketAsOf: new Date(history.at(-1).timestamp * 1000).toISOString(),
    features: {
      ema20: Number.isFinite(ema20) ? Number(ema20.toFixed(6)) : null,
      ema50: Number.isFinite(ema50) ? Number(ema50.toFixed(6)) : null,
      rsi14: Number.isFinite(rsi14) ? Number(rsi14.toFixed(4)) : null,
      volumeRatio20: Number.isFinite(volumeRatio20) ? Number(volumeRatio20.toFixed(4)) : null,
    },
    rule: {
      entryRequires: ['EMA20_GT_EMA50', 'RSI14_GTE_50', 'RSI14_LTE_70', 'VOLUME_RATIO20_GTE_1'],
    },
    blockers,
    decisionImpact: 'NONE',
    finalActionEligible: false,
  };
}

export function summarizeMinbeisBaselineComparison(records = []) {
  const rows = (Array.isArray(records) ? records : []).filter((record) => record?.simpleBaselineSnapshot?.status === 'READY');
  const matured = rows.filter((record) => record?.horizons && Object.values(record.horizons).some((item) => item?.status === 'MATURED'));
  const agreements = rows.filter((record) => {
    const minbeisEntry = ['BUY_PROBE', 'BUY_STARTER', 'BUY_CORE'].includes(record?.action);
    const baselineEntry = record?.simpleBaselineSnapshot?.action === 'ENTRY';
    return minbeisEntry === baselineEntry;
  }).length;
  return {
    format: 'minbeis-simple-baseline-comparison-summary',
    version: 1,
    policyVersion: MINBEIS_SIMPLE_BASELINE_VERSION,
    comparableRecordCount: rows.length,
    maturedComparableRecordCount: matured.length,
    agreementRatePct: rows.length ? Number(((agreements / rows.length) * 100).toFixed(2)) : null,
    minimumEvidenceMet: matured.length >= 100,
    conclusion: matured.length >= 100 ? 'MEASURABLE' : 'INSUFFICIENT_PROSPECTIVE_SAMPLE',
    caution: 'This shadow baseline is descriptive and has no authority over MINBEIS decisions.',
  };
}
