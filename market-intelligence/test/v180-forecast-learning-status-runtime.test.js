import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('v1.8 runtime exposes compact forecast learning status after live archive maturation without enabling decision integration', () => {
  const autonomous = fs.readFileSync(new URL('../src/run-autonomous-intelligence.js', import.meta.url), 'utf8');
  assert.match(autonomous, /import \{ buildForecastLearningStatus \} from '\.\/forecast-learning-status\.js';/);
  assert.match(autonomous, /const forecastLearningStatus = buildForecastLearningStatus\(\{/);
  assert.match(autonomous, /records: forecastOutcomeArchive\.records/);
  assert.match(autonomous, /forecastLearningStatus,/);
  assert.doesNotMatch(autonomous, /forecastLearningStatus\.forecastMayInfluenceFinalAction\s*=\s*true/);
  assert.doesNotMatch(autonomous, /decisionIntegrationEnabled\s*:\s*true/);
});
