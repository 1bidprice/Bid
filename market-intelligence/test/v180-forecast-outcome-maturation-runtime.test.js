import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('v1.8 runtime backfills validated due-outcome history before archive maturation without serializing raw supplemental series', () => {
  const autonomous = fs.readFileSync(new URL('../src/run-autonomous-intelligence.js', import.meta.url), 'utf8');
  assert.match(autonomous, /import \{ collectDueForecastOutcomeHistory \} from '\.\/forecast-outcome-maturation\.js';/);
  assert.match(autonomous, /const forecastOutcomeMaturation = await collectDueForecastOutcomeHistory\(\{/);
  assert.match(autonomous, /for \(const \[companyId, series\] of forecastOutcomeMaturation\.collector\)/);
  assert.match(autonomous, /forecastOutcomeMaturationSummary: forecastOutcomeMaturation\.summary/);
  assert.match(autonomous, /const forecastOutcomeArchive = runForecastOutcomeArchiveCycle\(\{/);
  assert.doesNotMatch(autonomous, /forecastOutcomeMaturationCollector:/);
  assert.doesNotMatch(autonomous, /forecastOutcomeMaturationSeries:/);
});
