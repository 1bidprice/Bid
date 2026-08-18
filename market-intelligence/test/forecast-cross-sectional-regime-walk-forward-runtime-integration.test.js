import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('v1823 runtime is present, default-off, cache-only and production-firewalled', () => {
  const manifest = JSON.parse(read('config/runtime-release-manifest.json'));
  const runner = read('src/run-autonomous-intelligence.js');
  const verifier = read('scripts/verify-production-output.js');

  assert.equal(manifest.releaseVersion, '1.8.0');
  assert.equal(manifest.testPatches.at(-1), 'apply-v1823-cross-sectional-regime-walk-forward-runtime.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1823-cross-sectional-regime-walk-forward-runtime.js');
  assert.equal(new Set(manifest.testPatches).size, 72);
  assert.equal(new Set(manifest.buildPatches).size, 71);

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
