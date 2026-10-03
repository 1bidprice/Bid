export const MINBEIS_CHALLENGER_EVALUATION_VERSION = '2026-10-03.1';

const BUY_ACTIONS = new Set(['BUY_PROBE', 'BUY_STARTER', 'BUY_CORE']);
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const round = (value, digits = 4) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

export function evaluateMinbeisSimpleBaselineChallenger(records = [], options = {}) {
  const horizon = String(options.horizon || '30');
  const comparable = (Array.isArray(records) ? records : []).filter((record) => {
    const outcome = record?.horizons?.[horizon];
    return record?.decisionId
      && outcome?.status === 'MATURED'
      && finite(outcome.realisedReturnPct)
      && record?.simpleBaselineSnapshot?.status === 'READY'
      && ['ENTRY', 'NO_TRADE'].includes(record.simpleBaselineSnapshot.action);
  });

  const rows = comparable.map((record) => {
    const realised = Number(record.horizons[horizon].realisedReturnPct);
    const minbeisEntry = BUY_ACTIONS.has(record.action);
    const baselineEntry = record.simpleBaselineSnapshot.action === 'ENTRY';
    return {
      decisionId: record.decisionId,
      decisionDate: String(record.decisionAt || '').slice(0, 10),
      instrumentId: record.instrumentId || record.companyId || record.symbol || null,
      realisedReturnPct: realised,
      minbeisEntry,
      baselineEntry,
      minbeisShadowReturnPct: minbeisEntry ? realised : 0,
      baselineShadowReturnPct: baselineEntry ? realised : 0,
    };
  });

  const distinctDates = new Set(rows.map((x) => x.decisionDate).filter(Boolean)).size;
  const distinctInstruments = new Set(rows.map((x) => x.instrumentId).filter(Boolean)).size;
  const minbeisEntries = rows.filter((x) => x.minbeisEntry);
  const baselineEntries = rows.filter((x) => x.baselineEntry);
  const minimumSample = Math.max(20, Number(options.minimumSample || 100));
  const minimumDistinctDates = Math.max(5, Number(options.minimumDistinctDates || 30));
  const minimumDistinctInstruments = Math.max(5, Number(options.minimumDistinctInstruments || 10));
  const minimumEntriesPerModel = Math.max(5, Number(options.minimumEntriesPerModel || 20));
  const blockers = [];
  if (rows.length < minimumSample) blockers.push('CHALLENGER_SAMPLE_TOO_SMALL');
  if (distinctDates < minimumDistinctDates) blockers.push('CHALLENGER_DATE_DIVERSITY_TOO_LOW');
  if (distinctInstruments < minimumDistinctInstruments) blockers.push('CHALLENGER_INSTRUMENT_DIVERSITY_TOO_LOW');
  if (minbeisEntries.length < minimumEntriesPerModel) blockers.push('MINBEIS_ENTRY_SAMPLE_TOO_SMALL');
  if (baselineEntries.length < minimumEntriesPerModel) blockers.push('BASELINE_ENTRY_SAMPLE_TOO_SMALL');

  const minbeisMean = mean(rows.map((x) => x.minbeisShadowReturnPct));
  const baselineMean = mean(rows.map((x) => x.baselineShadowReturnPct));
  const minbeisEntryMean = mean(minbeisEntries.map((x) => x.realisedReturnPct));
  const baselineEntryMean = mean(baselineEntries.map((x) => x.realisedReturnPct));

  return {
    format: 'investor-control-minbeis-simple-baseline-challenger',
    version: 1,
    policyVersion: MINBEIS_CHALLENGER_EVALUATION_VERSION,
    horizon,
    status: blockers.length ? 'INSUFFICIENT_PROSPECTIVE_EVIDENCE' : 'EVIDENCE_READY',
    blockers,
    comparableDecisionCount: rows.length,
    distinctDecisionDates: distinctDates,
    distinctInstruments,
    minbeisEntryCount: minbeisEntries.length,
    baselineEntryCount: baselineEntries.length,
    minbeisAverageShadowReturnPct: round(minbeisMean),
    baselineAverageShadowReturnPct: round(baselineMean),
    observedShadowReturnDeltaPct: minbeisMean === null || baselineMean === null ? null : round(minbeisMean - baselineMean),
    minbeisAverageEntryReturnPct: round(minbeisEntryMean),
    baselineAverageEntryReturnPct: round(baselineEntryMean),
    automaticPromotionAllowed: false,
    requiresWalkForwardValidation: true,
    caution: 'This is a prospective shadow comparison over common decision opportunities, not a portfolio backtest and not evidence of future performance.',
  };
}
