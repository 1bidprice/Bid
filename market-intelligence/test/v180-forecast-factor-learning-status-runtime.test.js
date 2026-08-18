import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('v1.8 runtime exposes factor OOS learning status after archive maturation without enabling probability or decision integration', () => {
  const autonomous = fs.readFileSync(new URL('../src/run-autonomous-intelligence.js', import.meta.url), 'utf8');
  assert.match(autonomous, /import \{ buildForecastFactorLearningStatus \} from '\.\/forecast-factor-learning-status\.js';/);
  assert.match(autonomous, /const forecastFactorLearningStatus = buildForecastFactorLearningStatus\(\{/);
  assert.match(autonomous, /records: forecastOutcomeArchive\.records/);
  assert.match(autonomous, /forecastFactorLearningStatus,/);
  assert.doesNotMatch(autonomous, /forecastFactorLearningStatus\.probabilityCalibrationEnabled\s*=\s*true/);
  assert.doesNotMatch(autonomous, /forecastFactorLearningStatus\.decisionIntegrationEnabled\s*=\s*true/);
  assert.doesNotMatch(autonomous, /forecastFactorLearningStatus\.forecastMayInfluenceFinalAction\s*=\s*true/);
});
