import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('v1823 runtime is present, default-off, cache-only and production-firewalled', () => {
  const pkg = JSON.parse(read('package.json'));
  const runner = read('src/run-autonomous-intelligence.js');
  const verifier = read('scripts/verify-production-output.js');

  assert.equal(pkg.version, '1.8.0');
  assert.equal(fs.existsSync(path.join(root, 'config/runtime-release-manifest.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'scripts/run-current-release.js')), false);
  assert.doesNotMatch(pkg.scripts.test, /run-current-release|apply-v/i);
  assert.equal(pkg.scripts['run:autonomous'], 'node src/run-autonomous-intelligence.js out/autonomous-intelligence.json');


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
