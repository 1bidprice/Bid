import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function assertLaterIntegrityPatches(patches) {
  const governance = patches.indexOf('apply-v1818-regime-factor-weight-governance.js');
  const alignment = patches.indexOf('apply-v1819-history-session-alignment.js');
  const v1823 = patches.indexOf('apply-v1823-cross-sectional-regime-walk-forward-runtime.js');
  const integrity = patches.indexOf('apply-v1841b-research-integrity.js');
  assert.ok(governance >= 0 && alignment > governance && v1823 > alignment && integrity > v1823);
  assert.equal(new Set(patches).size, patches.length);
}

test('v1818 transformed runtime publishes regime-factor governance and invokes its production firewall', () => {
  const manifest = JSON.parse(read('config/runtime-release-manifest.json'));
  const runner = read('src/run-autonomous-intelligence.js');
  const verifier = read('scripts/verify-production-output.js');

  assert.equal(manifest.releaseVersion, '1.8.0');
  assertLaterIntegrityPatches(manifest.testPatches);
  assertLaterIntegrityPatches(manifest.buildPatches);

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
