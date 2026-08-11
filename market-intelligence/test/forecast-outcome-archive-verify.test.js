import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyForecastOutcomeArchive } from '../scripts/verify-forecast-outcome-archive.js';

function record(status = 'OPEN') {
  return {
    forecastId: 'forecast:test',
    validationMode: 'LIVE_SHADOW_OOS',
    forecastSampleDate: '2027-01-15',
    decisionImpact: 'NONE',
    status,
    positiveOutcome: status === 'MATURED' ? 1 : null,
    realisedOutcome: status === 'MATURED' ? { realisedReturnPct: 5 } : null,
    outcomeEvaluatedAt: status === 'MATURED' ? '2027-01-22T00:00:00.000Z' : null,
  };
}

test('forecast outcome archive verifier accepts internally consistent live OOS records', () => {
  const archive = {
    format: 'investor-control-forecast-outcome-archive',
    records: [record('MATURED')],
    summary: { recordCount: 1, openCount: 0, maturedCount: 1 },
  };
  const result = verifyForecastOutcomeArchive(archive);
  assert.equal(result.ok, true);
  assert.equal(result.maturedCount, 1);
});

test('forecast outcome archive verifier rejects duplicate, non-OOS or summary-corrupted archives', () => {
  const bad = record('OPEN');
  bad.validationMode = 'IN_SAMPLE';
  const archive = {
    format: 'investor-control-forecast-outcome-archive',
    records: [bad, { ...bad }],
    summary: { recordCount: 99, openCount: 0, maturedCount: 0 },
  };
  const result = verifyForecastOutcomeArchive(archive);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.startsWith('DUPLICATE_FORECAST_ID')));
  assert.ok(result.errors.some((item) => item.startsWith('NON_LIVE_OOS_RECORD')));
  assert.ok(result.errors.includes('SUMMARY_RECORD_COUNT_MISMATCH'));
});
