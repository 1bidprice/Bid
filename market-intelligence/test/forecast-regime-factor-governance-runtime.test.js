import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('v1818 transformed runtime publishes regime-factor governance and invokes its production firewall', () => {
  const manifest = JSON.parse(read('config/runtime-release-manifest.json'));
  const runner = read('src/run-autonomous-intelligence.js');
  const verifier = read('scripts/verify-production-output.js');

  assert.equal(manifest.releaseVersion, '1.8.0');
  assert.equal(manifest.testPatches.at(-1), 'apply-v1818-regime-factor-weight-governance.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1818-regime-factor-weight-governance.js');
  assert.equal(new Set(manifest.testPatches).size, 67);
  assert.equal(new Set(manifest.buildPatches).size, 66);

  assert.match(runner, /buildForecastRegimeFactorWeightGovernanceStatus/);
  assert.match(runner, /regimeFactorAttributionStatus: forecastRegimeFactorAttributionStatus/);
  assert.match(runner, /regimeLearningStatus: forecastRegimeLearningStatus/);
  assert.match(runner, /forecastRegimeFactorWeightGovernanceStatus/);
  assert.match(runner, /forecastRegimeFactorGovernanceOperationalTelemetry/);

  assert.match(verifier, /verifyForecastRegimeFactorGovernanceProductionSafety/);
  assert.match(verifier, /regimeConditionalFactorGovernanceSafety: 'REQUIRED'/);

  assert.doesNotMatch(runner, /automaticRegimeWeightingEnabled:\s*true/);
  assert.doesNotMatch(runner, /automaticFactorReweightingEnabled:\s*true/);
  assert.doesNotMatch(runner, /automaticProposalApplicationEnabled:\s*true/);
});
