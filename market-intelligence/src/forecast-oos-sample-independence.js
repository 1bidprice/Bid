export const FORECAST_OOS_SAMPLE_INDEPENDENCE_VERSION = '2026-08-11.1';

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function normalizedIsoDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
  }
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString().slice(0, 10) : null;
}

export function forecastDateKey(record = {}) {
  return normalizedIsoDate(record.forecastSampleDate) || normalizedIsoDate(record.forecastAt);
}

export function forecastInstrumentKey(record = {}) {
  for (const value of [record.instrumentId, record.companyId]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const symbol = record?.listing?.symbol || record.symbol;
  if (typeof symbol !== 'string' || !symbol.trim()) return null;
  const mic = typeof record?.listing?.mic === 'string' && record.listing.mic.trim()
    ? record.listing.mic.trim().toUpperCase()
    : 'UNKNOWN';
  return `listing:${mic}:${symbol.trim().toUpperCase()}`;
}

export function evaluateOosSampleIndependence(records = [], options = {}) {
  const sample = Array.isArray(records) ? records : [];
  const minimumDistinctForecastDates = Math.max(1, Math.floor(boundedNumber(options.minimumDistinctForecastDates, 40, 1, 10000)));
  const minimumDistinctInstruments = Math.max(1, Math.floor(boundedNumber(options.minimumDistinctInstruments, 10, 1, 10000)));
  const maximumAllowedSingleForecastDateSharePct = boundedNumber(options.maximumSingleForecastDateSharePct, 10, 0.1, 100);
  const dateCounts = new Map();
  const instrumentKeys = new Set();
  let missingForecastDateCount = 0;
  let missingInstrumentIdentityCount = 0;
  for (const record of sample) {
    const date = forecastDateKey(record);
    const instrument = forecastInstrumentKey(record);
    if (!date) missingForecastDateCount += 1;
    else dateCounts.set(date, (dateCounts.get(date) || 0) + 1);
    if (!instrument) missingInstrumentIdentityCount += 1;
    else instrumentKeys.add(instrument);
  }
  const distinctForecastDateCount = dateCounts.size;
  const distinctInstrumentCount = instrumentKeys.size;
  let mostConcentratedForecastDate = null;
  let maximumSingleForecastDateCount = 0;
  for (const [date, count] of dateCounts.entries()) {
    if (count > maximumSingleForecastDateCount) {
      maximumSingleForecastDateCount = count;
      mostConcentratedForecastDate = date;
    }
  }
  const maximumSingleForecastDateSharePct = sample.length
    ? Number(((maximumSingleForecastDateCount / sample.length) * 100).toFixed(4))
    : 0;
  const blockers = [];
  if (!sample.length) blockers.push('OOS_INDEPENDENCE_SAMPLE_EMPTY');
  if (missingForecastDateCount) blockers.push('OOS_FORECAST_DATE_MISSING');
  if (missingInstrumentIdentityCount) blockers.push('OOS_INSTRUMENT_IDENTITY_MISSING');
  if (distinctForecastDateCount < minimumDistinctForecastDates) blockers.push('OOS_DISTINCT_FORECAST_DATES_TOO_SMALL');
  if (distinctInstrumentCount < minimumDistinctInstruments) blockers.push('OOS_DISTINCT_INSTRUMENTS_TOO_SMALL');
  if (maximumSingleForecastDateSharePct > maximumAllowedSingleForecastDateSharePct) blockers.push('OOS_SINGLE_DATE_CONCENTRATION_TOO_HIGH');
  return {
    contract: 'OOS_SAMPLE_INDEPENDENCE_V1',
    policyVersion: FORECAST_OOS_SAMPLE_INDEPENDENCE_VERSION,
    status: blockers.length ? 'INDEPENDENCE_NOT_READY' : 'INDEPENDENCE_READY',
    sampleSize: sample.length,
    distinctForecastDateCount,
    distinctInstrumentCount,
    missingForecastDateCount,
    missingInstrumentIdentityCount,
    mostConcentratedForecastDate,
    maximumSingleForecastDateCount,
    maximumSingleForecastDateSharePct,
    thresholds: {
      minimumDistinctForecastDates,
      minimumDistinctInstruments,
      maximumSingleForecastDateSharePct: maximumAllowedSingleForecastDateSharePct,
    },
    blockers,
  };
}

export function splitChronologicalDateBlocks(records = [], blockCount = 3) {
  const count = Math.max(1, Math.floor(Number(blockCount) || 1));
  const groups = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const date = forecastDateKey(record);
    const key = date || `__MISSING_DATE__:${record?.forecastId || groups.size}`;
    const group = groups.get(key) || { date, records: [] };
    group.records.push(record);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * ordered.length / count);
    const end = Math.floor((index + 1) * ordered.length / count);
    return ordered.slice(start, end).flatMap((group) => group.records);
  });
}
