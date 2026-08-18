import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const integrityPatches = [
  'apply-v1841b-research-integrity.js',
  'apply-v1841a-final-action-integrity.js',
  'apply-v1841c-opportunity-factor-integrity.js',
  'apply-v1841d-opportunity-scanner-integrity.js',
  'apply-v1841e-mobile-integrity.js',
  'apply-v1841f-hold-reference-integrity.js',
];

function assertRuntimeOrder(patches) {
  const v1823 = patches.indexOf('apply-v1823-cross-sectional-regime-walk-forward-runtime.js');
  assert.ok(v1823 >= 0);
  let previous = v1823;
  for (const patch of integrityPatches) {
    const index = patches.indexOf(patch);
    assert.ok(index > previous, `${patch} must remain after the frozen v1823 research runtime`);
    previous = index;
  }
  assert.equal(new Set(patches).size, patches.length, 'runtime patch manifest must not contain duplicates');
}

test('v1823 runtime is present, default-off, cache-only and production-firewalled', () => {
  const manifest = JSON.parse(read('config/runtime-release-manifest.json'));
  const runner = read('src/run-autonomous-intelligence.js');
  const verifier = read('scripts/verify-production-output.js');

  assert.equal(manifest.releaseVersion, '1.8.0');
  assertRuntimeOrder(manifest.testPatches);
  assertRuntimeOrder(manifest.buildPatches);

  assert.match(runner, /buildCrossSectionalRegimeWalkForwardRuntimeStatus/);
  assert.match(runner, /enabled:\s*options\.crossSectionalHistoricalRegimeWalkForwardEnabled\s*===\s*true/);
  assert.match(runner, /historicalSeriesByCompany:\s*historicalSeriesCollector/);
  assert.match(runner, /benchmarkSeriesByCompany:\s*benchmarkSeriesCollector/);
  assert.match(runner, /crossSectionalHistoricalRegimeWalkForwardMaxInstruments/);
  assert.match(runner, /forecastCrossSectionalRegimeWalkForwardRuntimeStatus/);
  assert.match(runner, /forecastCrossSectionalRegimeWalkForwardOperationalTelemetry/);

  assert.doesNotMatch(runner, /crossSectionalHistoricalRegimeWalkForwardEnabled\s*:\s*true/);
  assert.doesNotMatch(runner, /forecastCrossSectionalRegimeWalkForwardDecisionIntegrationEnabled:\s*true/);
  assert.doesNotMatch(runner, /forecastCrossSectionalRegimeWalkForwardMayInfluenceFinalAction:\s*true/);
  assert.doesNotMatch(runner, /brokerExecutionEligible:\s*true/);

  assert.match(verifier, /verifyCrossSectionalRegimeWalkForwardProductionSafety/);
  assert.match(verifier, /crossSectionalHistoricalRegimeWalkForwardSafety:\s*'REQUIRED'/);
});
