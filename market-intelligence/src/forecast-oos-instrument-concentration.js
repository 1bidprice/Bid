import { forecastInstrumentKey } from './forecast-oos-sample-independence.js';

export const FORECAST_OOS_INSTRUMENT_CONCENTRATION_VERSION = '2026-08-11.1';

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

export function evaluateOosInstrumentConcentration(records = [], options = {}) {
  const sample = Array.isArray(records) ? records : [];
  const maximumSingleInstrumentSharePct = boundedNumber(
    options.maximumSingleInstrumentSharePct,
    25,
    0.1,
    100,
  );
  const minimumEffectiveInstrumentCount = boundedNumber(
    options.minimumEffectiveInstrumentCount,
    6,
    1,
    100000,
  );

  const counts = new Map();
  let missingInstrumentIdentityCount = 0;
  for (const record of sample) {
    const instrument = forecastInstrumentKey(record);
    if (!instrument) {
      missingInstrumentIdentityCount += 1;
      continue;
    }
    counts.set(instrument, (counts.get(instrument) || 0) + 1);
  }

  const validInstrumentRecordCount = sample.length - missingInstrumentIdentityCount;
  const distinctInstrumentCount = counts.size;
  let mostConcentratedInstrument = null;
  let maximumSingleInstrumentCount = 0;
  let concentrationSumSquares = 0;
  for (const [instrument, count] of counts.entries()) {
    if (count > maximumSingleInstrumentCount) {
      maximumSingleInstrumentCount = count;
      mostConcentratedInstrument = instrument;
    }
    if (validInstrumentRecordCount > 0) {
      const share = count / validInstrumentRecordCount;
      concentrationSumSquares += share * share;
    }
  }

  const actualMaximumSingleInstrumentSharePct = validInstrumentRecordCount
    ? Number(((maximumSingleInstrumentCount / validInstrumentRecordCount) * 100).toFixed(4))
    : 0;
  const effectiveInstrumentCount = concentrationSumSquares > 0
    ? Number((1 / concentrationSumSquares).toFixed(4))
    : 0;

  const blockers = [];
  if (!sample.length) blockers.push('OOS_INSTRUMENT_CONCENTRATION_SAMPLE_EMPTY');
  if (missingInstrumentIdentityCount > 0) blockers.push('OOS_INSTRUMENT_IDENTITY_MISSING_FOR_CONCENTRATION');
  if (actualMaximumSingleInstrumentSharePct > maximumSingleInstrumentSharePct) blockers.push('OOS_SINGLE_INSTRUMENT_CONCENTRATION_TOO_HIGH');
  if (effectiveInstrumentCount < minimumEffectiveInstrumentCount) blockers.push('OOS_EFFECTIVE_INSTRUMENT_COUNT_TOO_SMALL');

  return {
    contract: 'OOS_INSTRUMENT_CONCENTRATION_V1',
    policyVersion: FORECAST_OOS_INSTRUMENT_CONCENTRATION_VERSION,
    status: blockers.length ? 'INSTRUMENT_DIVERSIFICATION_NOT_READY' : 'INSTRUMENT_DIVERSIFICATION_READY',
    sampleSize: sample.length,
    validInstrumentRecordCount,
    missingInstrumentIdentityCount,
    distinctInstrumentCount,
    mostConcentratedInstrument,
    maximumSingleInstrumentCount,
    maximumSingleInstrumentSharePct: actualMaximumSingleInstrumentSharePct,
    effectiveInstrumentCount,
    thresholds: {
      maximumSingleInstrumentSharePct,
      minimumEffectiveInstrumentCount,
    },
    blockers,
  };
}
