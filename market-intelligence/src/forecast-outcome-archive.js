import {
  createLiveShadowForecastRecords,
  evaluateLiveShadowForecastRecord,
  mergeForecastOutcomeLedger,
  summarizeForecastOutcomeLedger,
  FORECAST_OUTCOME_LEDGER_VERSION,
} from './forecast-outcome-ledger.js';

export const FORECAST_OUTCOME_ARCHIVE_VERSION = '2026-08-11.1';

export function recordsFromForecastOutcomeArchive(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.records)) return value.records;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function archivePayload(records, updatedAt, options = {}, evaluation = null) {
  const merged = mergeForecastOutcomeLedger([], records);
  return {
    format: 'investor-control-forecast-outcome-archive',
    version: 1,
    policyVersion: FORECAST_OUTCOME_ARCHIVE_VERSION,
    ledgerPolicyVersion: FORECAST_OUTCOME_LEDGER_VERSION,
    updatedAt: new Date(updatedAt || Date.now()).toISOString(),
    records: merged,
    summary: summarizeForecastOutcomeLedger(merged, {
      minimumTotal: options.forecastCalibrationMinimumTotal || options.minimumTotal || 100,
      binCount: options.forecastCalibrationBinCount || options.binCount || 10,
    }),
    ...(evaluation ? { evaluation } : {}),
  };
}

export function runForecastOutcomeArchiveCycle(input = {}) {
  const generatedAt = new Date(input.generatedAt || Date.now()).toISOString();
  const historicalSeriesCollector = input.historicalSeriesCollector instanceof Map ? input.historicalSeriesCollector : new Map();
  const existingRecords = recordsFromForecastOutcomeArchive(input.existingRecords || input.existingArchive);
  const newRecords = createLiveShadowForecastRecords(input.shadowForecasts, input.researchDossiers, input.options || {});
  const merged = mergeForecastOutcomeLedger(existingRecords, newRecords);
  let evaluatedCount = 0;
  let maturedThisRun = 0;
  let missingSeriesCount = 0;

  const evaluated = merged.map((record) => {
    if (record?.status === 'MATURED' || record?.validationMode !== 'LIVE_SHADOW_OOS') return record;
    const series = historicalSeriesCollector.get(record.companyId) || null;
    if (!series?.usable || !Array.isArray(series?.candles) || !series.candles.length) {
      missingSeriesCount += 1;
      return record;
    }
    evaluatedCount += 1;
    const next = evaluateLiveShadowForecastRecord(record, series, { evaluatedAt: generatedAt });
    if (record.status !== 'MATURED' && next.status === 'MATURED') maturedThisRun += 1;
    return next;
  });

  const finalRecords = mergeForecastOutcomeLedger([], evaluated);
  return archivePayload(finalRecords, generatedAt, input.options || {}, {
    existingRecordCount: existingRecords.length,
    candidateRecordCount: newRecords.length,
    recordCountAfterMerge: finalRecords.length,
    evaluatedOpenRecordCount: evaluatedCount,
    maturedThisRun,
    missingCanonicalSeriesCount: missingSeriesCount,
  });
}

export function mergeForecastOutcomeArchives(baseArchive, incomingArchive, options = {}) {
  const baseRecords = recordsFromForecastOutcomeArchive(baseArchive);
  const incomingRecords = recordsFromForecastOutcomeArchive(incomingArchive);
  const merged = mergeForecastOutcomeLedger(baseRecords, incomingRecords);
  const updatedAt = options.updatedAt || incomingArchive?.updatedAt || baseArchive?.updatedAt || new Date().toISOString();
  return archivePayload(merged, updatedAt, options, {
    baseRecordCount: baseRecords.length,
    incomingRecordCount: incomingRecords.length,
    mergedRecordCount: merged.length,
  });
}
