import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('v1818 transformed runtime publishes regime-factor governance and invokes its production firewall', () => {
  const pkg = JSON.parse(read('package.json'));
  const runner = read('src/run-autonomous-intelligence.js');
  const verifier = read('scripts/verify-production-output.js');

  assert.equal(pkg.version, '1.8.0');
  assert.equal(fs.existsSync(path.join(root, 'config/runtime-release-manifest.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'scripts/run-current-release.js')), false);
  assert.doesNotMatch(pkg.scripts.test, /run-current-release|apply-v/i);
  assert.equal(pkg.scripts['run:autonomous'], 'node src/run-autonomous-intelligence.js out/autonomous-intelligence.json');


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
