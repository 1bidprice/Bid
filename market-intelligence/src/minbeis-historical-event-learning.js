export const MINBEIS_HISTORICAL_EVENT_LEARNING_VERSION = '2026-10-03.1';

const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const round = (value, digits = 4) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function median(values) {
  const valid = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function cohort(rows, dimension, key, horizon, options = {}) {
  const sample = rows.filter((row) => row?.[dimension] === key && finite(row?.outcomes?.[horizon]?.realisedReturnPct));
  const returns = sample.map((row) => Number(row.outcomes[horizon].realisedReturnPct));
  const favorable = sample.map((row) => Number(row.outcomes[horizon].maxFavorableExcursionPct)).filter(Number.isFinite);
  const adverse = sample.map((row) => Number(row.outcomes[horizon].maxAdverseExcursionPct)).filter(Number.isFinite);
  const distinctCompanies = new Set(sample.map((row) => row.companyId).filter(Boolean)).size;
  const distinctDates = new Set(sample.map((row) => String(row.availabilityAt || '').slice(0, 10)).filter(Boolean)).size;
  const minimumSample = Math.max(5, Number(options.minimumSample || 20));
  const minimumCompanies = Math.max(2, Number(options.minimumCompanies || 5));
  const minimumDates = Math.max(3, Number(options.minimumDates || 10));
  const blockers = [];
  if (sample.length < minimumSample) blockers.push('EVENT_COHORT_SAMPLE_TOO_SMALL');
  if (distinctCompanies < minimumCompanies) blockers.push('EVENT_COHORT_COMPANY_DIVERSITY_TOO_LOW');
  if (distinctDates < minimumDates) blockers.push('EVENT_COHORT_DATE_DIVERSITY_TOO_LOW');

  return {
    dimension,
    key,
    tradingDays: Number(horizon),
    sampleSize: sample.length,
    distinctCompanies,
    distinctAvailabilityDates: distinctDates,
    evidenceReady: blockers.length === 0,
    blockers,
    positiveReturnRatePct: returns.length ? round(returns.filter((value) => value > 0).length / returns.length * 100, 2) : null,
    averageReturnPct: returns.length ? round(returns.reduce((a, b) => a + b, 0) / returns.length) : null,
    medianReturnPct: round(median(returns)),
    averageMaxFavorableExcursionPct: favorable.length ? round(favorable.reduce((a, b) => a + b, 0) / favorable.length) : null,
    averageMaxAdverseExcursionPct: adverse.length ? round(adverse.reduce((a, b) => a + b, 0) / adverse.length) : null,
  };
}

function cohortsFor(rows, dimension, horizon, options) {
  const keys = [...new Set(rows.map((row) => row?.[dimension]).filter(Boolean))].sort();
  return keys.map((key) => cohort(rows, dimension, key, horizon, options));
}

export function buildMinbeisHistoricalEventLearning(replayRun = {}, options = {}) {
  const rows = (Array.isArray(replayRun?.results) ? replayRun.results : [])
    .filter((row) => row?.replayStatus === 'REPLAY_INPUT_READY');
  const horizons = [...new Set(rows.flatMap((row) => Object.keys(row?.outcomes || {})))].sort((a, b) => Number(a) - Number(b));
  const byHorizon = {};

  for (const horizon of horizons) {
    const eventType = cohortsFor(rows, 'eventType', horizon, options);
    const category = cohortsFor(rows, 'category', horizon, options);
    const role = cohortsFor(rows, 'role', horizon, options);
    byHorizon[horizon] = {
      tradingDays: Number(horizon),
      maturedReplayCount: rows.filter((row) => finite(row?.outcomes?.[horizon]?.realisedReturnPct)).length,
      cohorts: { eventType, category, role },
      evidenceReadyCohortCount: [...eventType, ...category, ...role].filter((item) => item.evidenceReady).length,
    };
  }

  return {
    format: 'investor-control-minbeis-historical-event-learning',
    version: 1,
    policyVersion: MINBEIS_HISTORICAL_EVENT_LEARNING_VERSION,
    replayReadyCount: rows.length,
    horizons: byHorizon,
    automaticDecisionImpactAllowed: false,
    automaticPolicyMutationAllowed: false,
    interpretation: 'Historical event cohorts are point-in-time observational associations. They do not establish causality or guarantee future performance.',
  };
}
