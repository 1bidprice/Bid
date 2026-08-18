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
  assert.match(source, /operationalHealth:\s*\{[\s\S]*?staleOutput:\s*false,[\s\S]*?\.\.\.forecastFactorOperationalTelemetry,[\s\S]*?\},\s*autonomousPublicationCount:/);

  const governanceIndex = source.indexOf('const forecastFactorWeightGovernanceStatus = buildForecastFactorWeightGovernanceStatus');
  const telemetryIndex = source.indexOf('const forecastFactorOperationalTelemetry = buildForecastFactorOperationalTelemetry');
  const healthTelemetryIndex = source.indexOf('...forecastFactorOperationalTelemetry,');
  const finalReturnIndex = source.indexOf('  return {\n    ...baseReport,');
  assert.ok(governanceIndex >= 0 && telemetryIndex > governanceIndex);
  assert.ok(finalReturnIndex >= 0 && healthTelemetryIndex > finalReturnIndex);

  assert.match(verifier, /import \{ verifyForecastFactorProductionSafety \} from '\.\.\/src\/forecast-factor-production-safety\.js';/);
  assert.match(verifier, /verifyForecastFactorProductionSafety\(report\);/);
  assert.match(verifier, /factorResearchGovernanceSafety: 'REQUIRED'/);

  assert.equal(manifest.releaseVersion, '1.8.0');
  for (const patches of [manifest.testPatches, manifest.buildPatches]) {
    const observability = patches.indexOf('apply-v1808-forecast-factor-production-observability.js');
    const v1823 = patches.indexOf('apply-v1823-cross-sectional-regime-walk-forward-runtime.js');
    const integrity = patches.indexOf('apply-v1841b-research-integrity.js');
    assert.ok(observability >= 0 && v1823 > observability && integrity > v1823);
    assert.equal(new Set(patches).size, patches.length);
  }
});

test('v1.8 factor telemetry is written by the single canonical production operationalHealth object', () => {
  const source = fs.readFileSync(new URL('src/run-autonomous-intelligence.js', root), 'utf8');
  const matches = source.match(/operationalHealth:\s*\{/g) || [];
  assert.equal(matches.length, 1);
  assert.doesNotMatch(source, /baseReport\.operationalHealth\s*=/);
  const block = source.match(/operationalHealth:\s*\{([\s\S]*?)\n\s*\},\n\s*autonomousPublicationCount:/)?.[1] || '';
  assert.ok(block.includes('staleOutput: false'));
  assert.ok(block.includes('...forecastFactorOperationalTelemetry'));
});
