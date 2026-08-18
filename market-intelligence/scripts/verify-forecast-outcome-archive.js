import fs from 'node:fs';
import path from 'node:path';

export function verifyForecastOutcomeArchive(archive) {
  const errors = [];
  if (archive?.format !== 'investor-control-forecast-outcome-archive') errors.push('ARCHIVE_FORMAT_INVALID');
  if (!Array.isArray(archive?.records)) errors.push('ARCHIVE_RECORDS_REQUIRED');
  const records = Array.isArray(archive?.records) ? archive.records : [];
  const ids = new Set();
  for (const record of records) {
    if (!record?.forecastId) errors.push('FORECAST_ID_REQUIRED');
    else if (ids.has(record.forecastId)) errors.push(`DUPLICATE_FORECAST_ID:${record.forecastId}`);
    else ids.add(record.forecastId);
    if (record?.validationMode !== 'LIVE_SHADOW_OOS') errors.push(`NON_LIVE_OOS_RECORD:${record?.forecastId || 'unknown'}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(record?.forecastSampleDate || ''))) errors.push(`FORECAST_SAMPLE_DATE_REQUIRED:${record?.forecastId || 'unknown'}`);
    if (record?.decisionImpact !== 'NONE') errors.push(`DECISION_IMPACT_MUST_BE_NONE:${record?.forecastId || 'unknown'}`);
    if (!['OPEN', 'MATURED'].includes(record?.status)) errors.push(`FORECAST_STATUS_INVALID:${record?.forecastId || 'unknown'}`);
    if (record?.status === 'MATURED') {
      if (![0, 1].includes(Number(record?.positiveOutcome))) errors.push(`MATURED_OUTCOME_BINARY_REQUIRED:${record?.forecastId || 'unknown'}`);
      if (!record?.realisedOutcome || !Number.isFinite(Number(record.realisedOutcome.realisedReturnPct))) errors.push(`MATURED_REALIZED_OUTCOME_REQUIRED:${record?.forecastId || 'unknown'}`);
      if (!record?.outcomeEvaluatedAt) errors.push(`MATURED_EVALUATION_TIMESTAMP_REQUIRED:${record?.forecastId || 'unknown'}`);
    }
    if (record?.status === 'OPEN' && (record?.positiveOutcome !== null || record?.realisedOutcome !== null)) {
      errors.push(`OPEN_RECORD_CANNOT_HAVE_REALIZED_OUTCOME:${record?.forecastId || 'unknown'}`);
    }
  }
  const summary = archive?.summary || {};
  const openCount = records.filter((record) => record?.status === 'OPEN').length;
  const maturedCount = records.filter((record) => record?.status === 'MATURED').length;
  if (Number(summary.recordCount) !== records.length) errors.push('SUMMARY_RECORD_COUNT_MISMATCH');
  if (Number(summary.openCount) !== openCount) errors.push('SUMMARY_OPEN_COUNT_MISMATCH');
  if (Number(summary.maturedCount) !== maturedCount) errors.push('SUMMARY_MATURED_COUNT_MISMATCH');
  return {
    ok: errors.length === 0,
    errors,
    recordCount: records.length,
    openCount,
    maturedCount,
  };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invoked) {
  const filePath = path.resolve(process.cwd(), process.argv[2] || 'out/forecast-outcome-ledger.json');
  const archive = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const result = verifyForecastOutcomeArchive(archive);
  if (!result.ok) {
    console.error(JSON.stringify({ forecastOutcomeArchiveVerification: 'FAIL', ...result }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ forecastOutcomeArchiveVerification: 'PASS', ...result }, null, 2));
  }
}
