import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('v1.8 runtime exposes manual factor weight governance only after attribution and never auto-applies proposals', () => {
  const source = fs.readFileSync(new URL('../src/run-autonomous-intelligence.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ buildForecastFactorWeightGovernanceStatus \} from '\.\/forecast-factor-weight-governance\.js';/);
  assert.match(source, /const forecastFactorWeightGovernanceStatus = buildForecastFactorWeightGovernanceStatus\(\{/);
  assert.match(source, /attributionStatus: forecastFactorAttributionStatus,/);
  assert.match(source, /forecastFactorWeightGovernanceStatus,/);
  const attributionIndex = source.indexOf('const forecastFactorAttributionStatus = buildForecastFactorAttributionStatus');
  const governanceIndex = source.indexOf('const forecastFactorWeightGovernanceStatus = buildForecastFactorWeightGovernanceStatus');
  assert.ok(attributionIndex >= 0 && governanceIndex > attributionIndex);
  assert.doesNotMatch(source, /automaticWeightAdjustmentEnabled\s*:\s*true/);
  assert.doesNotMatch(source, /automaticProposalApplicationEnabled\s*:\s*true/);
  assert.doesNotMatch(source, /forecastFactorWeightGovernanceStatus\.decisionIntegrationEnabled\s*=\s*true/);
});
