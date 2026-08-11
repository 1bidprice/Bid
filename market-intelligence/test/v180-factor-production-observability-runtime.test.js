import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);

test('v1.8 runtime publishes compact factor observability and production verifier enforces governance safety', () => {
  const source = fs.readFileSync(new URL('src/run-autonomous-intelligence.js', root), 'utf8');
  const verifier = fs.readFileSync(new URL('scripts/verify-production-output.js', root), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(new URL('config/runtime-release-manifest.json', root), 'utf8'));

  assert.match(source, /import \{ buildForecastFactorOperationalTelemetry \} from '\.\/forecast-factor-production-safety\.js';/);
  assert.match(source, /const forecastFactorOperationalTelemetry = buildForecastFactorOperationalTelemetry\(\{/);
  assert.match(source, /forecastFactorLearningStatus,/);
  assert.match(source, /forecastFactorAttributionStatus,/);
  assert.match(source, /forecastFactorWeightGovernanceStatus,/);
  assert.match(source, /operationalHealth: \{\s*\.\.\.\(baseReport\.operationalHealth \|\| \{\}\),\s*\.\.\.forecastFactorOperationalTelemetry,/s);

  const governanceIndex = source.indexOf('const forecastFactorWeightGovernanceStatus = buildForecastFactorWeightGovernanceStatus');
  const telemetryIndex = source.indexOf('const forecastFactorOperationalTelemetry = buildForecastFactorOperationalTelemetry');
  assert.ok(governanceIndex >= 0 && telemetryIndex > governanceIndex);

  assert.match(verifier, /import \{ verifyForecastFactorProductionSafety \} from '\.\.\/src\/forecast-factor-production-safety\.js';/);
  assert.match(verifier, /verifyForecastFactorProductionSafety\(report\);/);
  assert.match(verifier, /factorResearchGovernanceSafety: 'REQUIRED'/);

  assert.equal(manifest.releaseVersion, '1.8.0');
  assert.equal(manifest.testPatches.at(-1), 'apply-v1808-forecast-factor-production-observability.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1808-forecast-factor-production-observability.js');
  assert.equal(new Set(manifest.testPatches).size, 57);
  assert.equal(new Set(manifest.buildPatches).size, 56);
});
