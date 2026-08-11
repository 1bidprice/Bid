import { forecastDateKey } from './forecast-oos-sample-independence.js';

export const FORECAST_OOS_OUTCOME_WINDOW_INDEPENDENCE_VERSION = '2026-08-11.1';

function validCalendarDatePrefix(value) {
  if (typeof value !== 'string' || value.length < 10) return false;
  const match = value.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function timestampMs(value) {
  if (typeof value !== 'string' || !value.trim() || !validCalendarDatePrefix(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function positiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

function outcomeWindow(record = {}) {
  const forecastDate = forecastDateKey(record);
  const startMs = timestampMs(record?.referencePrice?.timestamp);
  const endMs = timestampMs(record?.realisedOutcome?.timestamp);
  const tradingDays = positiveInteger(record?.tradingDays);
  if (record?.status !== 'MATURED' || !forecastDate || startMs === null || endMs === null || endMs <= startMs || tradingDays === null) return null;
  return { forecastDate, startMs, endMs, tradingDays };
}

function cohortWindows(records = []) {
  const cohorts = new Map();
  let invalidWindowRecordCount = 0;
  const tradingDays = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    const window = outcomeWindow(record);
    if (!window) {
      invalidWindowRecordCount += 1;
      continue;
    }
    tradingDays.add(window.tradingDays);
    const current = cohorts.get(window.forecastDate) || {
      forecastDate: window.forecastDate,
      startMs: window.startMs,
      endMs: window.endMs,
      recordCount: 0,
    };
    current.startMs = Math.min(current.startMs, window.startMs);
    current.endMs = Math.max(current.endMs, window.endMs);
    current.recordCount += 1;
    cohorts.set(window.forecastDate, current);
  }
  return {
    cohorts: [...cohorts.values()],
    invalidWindowRecordCount,
    tradingDays: [...tradingDays].sort((a, b) => a - b),
  };
}

function maximumNonOverlappingCohorts(cohorts = []) {
  const ordered = cohorts.slice().sort((a, b) => a.endMs - b.endMs || a.startMs - b.startMs || a.forecastDate.localeCompare(b.forecastDate));
  const selected = [];
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const cohort of ordered) {
    if (cohort.startMs < lastEnd) continue;
    selected.push(cohort);
    lastEnd = cohort.endMs;
  }
  return selected;
}

export function evaluateOosOutcomeWindowIndependence(records = [], options = {}) {
  const sample = Array.isArray(records) ? records : [];
  const minimumEffectiveNonOverlappingWindows = Math.max(1, Math.floor(Number(options.minimumEffectiveNonOverlappingWindows || 12)));
  const { cohorts, invalidWindowRecordCount, tradingDays } = cohortWindows(sample);
  const selected = maximumNonOverlappingCohorts(cohorts);
  const effectiveNonOverlappingWindowCount = selected.length;
  const distinctWindowDateCount = cohorts.length;
  const effectiveWindowCoveragePct = distinctWindowDateCount
    ? Number(((effectiveNonOverlappingWindowCount / distinctWindowDateCount) * 100).toFixed(4))
    : 0;
  const earliestWindowStartMs = cohorts.length ? Math.min(...cohorts.map((item) => item.startMs)) : null;
  const latestWindowEndMs = cohorts.length ? Math.max(...cohorts.map((item) => item.endMs)) : null;
  const blockers = [];
  if (!sample.length) blockers.push('OOS_OUTCOME_WINDOW_SAMPLE_EMPTY');
  if (invalidWindowRecordCount > 0) blockers.push('OOS_OUTCOME_WINDOW_FIELDS_MISSING_OR_INVALID');
  if (tradingDays.length > 1) blockers.push('OOS_OUTCOME_WINDOW_TRADING_DAYS_INCONSISTENT');
  if (effectiveNonOverlappingWindowCount < minimumEffectiveNonOverlappingWindows) blockers.push('OOS_NON_OVERLAPPING_OUTCOME_WINDOWS_TOO_SMALL');
  return {
    contract: 'OOS_OUTCOME_WINDOW_INDEPENDENCE_V1',
    policyVersion: FORECAST_OOS_OUTCOME_WINDOW_INDEPENDENCE_VERSION,
    status: blockers.length ? 'WINDOW_INDEPENDENCE_NOT_READY' : 'WINDOW_INDEPENDENCE_READY',
    sampleSize: sample.length,
    validWindowRecordCount: sample.length - invalidWindowRecordCount,
    invalidWindowRecordCount,
    distinctWindowDateCount,
    tradingDays: tradingDays.length === 1 ? tradingDays[0] : null,
    effectiveNonOverlappingWindowCount,
    effectiveWindowCoveragePct,
    earliestWindowStart: earliestWindowStartMs === null ? null : new Date(earliestWindowStartMs).toISOString(),
    latestWindowEnd: latestWindowEndMs === null ? null : new Date(latestWindowEndMs).toISOString(),
    thresholds: {
      minimumEffectiveNonOverlappingWindows,
    },
    blockers,
  };
}
