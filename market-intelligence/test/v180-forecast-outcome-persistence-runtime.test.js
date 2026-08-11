import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('v1.8 runtime persists the forecast outcome archive as a sidecar while the autonomous report exposes only summary metrics', () => {
  const autonomous = fs.readFileSync(new URL('../src/run-autonomous-intelligence.js', import.meta.url), 'utf8');
  assert.match(autonomous, /import \{ runForecastOutcomeArchiveCycle \} from '\.\/forecast-outcome-archive\.js';/);
  assert.match(autonomous, /const forecastOutcomeArchive = runForecastOutcomeArchiveCycle\(\{/);
  assert.match(autonomous, /forecastOutcomeLedgerSummary: forecastOutcomeArchive\.summary/);
  assert.match(autonomous, /FORECAST_OUTCOME_LEDGER_PATH/);
  assert.match(autonomous, /FORECAST_OUTCOME_LEDGER_OUTPUT/);
  assert.match(autonomous, /forecastOutcomeLedgerSink: \(archive\) => \{ persistedForecastOutcomeArchive = archive; \}/);
  assert.match(autonomous, /writeFile\(ledgerOutputPath, /);
  assert.doesNotMatch(autonomous, /forecastOutcomeLedgerRecords: forecastOutcomeArchive\.records/);
  assert.doesNotMatch(autonomous, /forecastOutcomeLedger: forecastOutcomeArchive\.records/);
});
