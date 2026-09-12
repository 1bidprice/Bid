import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);

test('v1.8 runtime publishes compact factor observability and production verifier enforces governance safety', () => {
  const source = fs.readFileSync(new URL('src/run-autonomous-intelligence.js', root), 'utf8');
  const operationalHealthSource = fs.readFileSync(new URL('src/operational-health.js', root), 'utf8');
  const verifier = fs.readFileSync(new URL('scripts/verify-production-output.js', root), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));

  assert.match(source, /import \{ buildForecastFactorOperationalTelemetry \} from '\.\/forecast-factor-production-safety\.js';/);
  assert.match(source, /import \{ buildOperationalHealth \} from '\.\/operational-health\.js';/);
  assert.match(source, /const forecastFactorOperationalTelemetry = buildForecastFactorOperationalTelemetry\(\{/);
  assert.match(source, /forecastFactorLearningStatus,/);
  assert.match(source, /forecastFactorAttributionStatus,/);
  assert.match(source, /forecastFactorWeightGovernanceStatus,/);
  assert.match(source, /const operationalHealth = buildOperationalHealth\(\{/);
  assert.match(source, /operationalHealth:\s*\{[\s\S]*?\.\.\.operationalHealth,[\s\S]*?\.\.\.forecastFactorOperationalTelemetry,[\s\S]*?\},\s*autonomousPublicationCount:/);
  assert.match(operationalHealthSource, /staleOutput:\s*false,/);

  const governanceIndex = source.indexOf('const forecastFactorWeightGovernanceStatus = buildForecastFactorWeightGovernanceStatus');
  const telemetryIndex = source.indexOf('const forecastFactorOperationalTelemetry = buildForecastFactorOperationalTelemetry');
  const healthBuildIndex = source.indexOf('const operationalHealth = buildOperationalHealth');
  const healthTelemetryIndex = source.indexOf('...forecastFactorOperationalTelemetry,');
  const finalReturnIndex = source.indexOf('  return {\n    ...baseReport,');
  assert.ok(governanceIndex >= 0 && telemetryIndex > governanceIndex);
  assert.ok(healthBuildIndex > telemetryIndex);
  assert.ok(finalReturnIndex >= 0 && healthTelemetryIndex > finalReturnIndex);

  assert.match(verifier, /import \{ verifyForecastFactorProductionSafety \} from '\.\.\/src\/forecast-factor-production-safety\.js';/);
  assert.match(verifier, /verifyForecastFactorProductionSafety\(report\);/);
  assert.match(verifier, /factorResearchGovernanceSafety: 'REQUIRED'/);

  assert.equal(pkg.version, '1.8.0');
  assert.equal(fs.existsSync(new URL('config/runtime-release-manifest.json', root)), false);
  assert.equal(fs.existsSync(new URL('scripts/run-current-release.js', root)), false);
  assert.doesNotMatch(pkg.scripts.test, /run-current-release|apply-v/i);
  assert.equal(pkg.scripts['run:autonomous'], 'node src/run-autonomous-intelligence.js out/autonomous-intelligence.json');
});

test('v1.8 factor telemetry is written by the single canonical production operationalHealth object', () => {
  const source = fs.readFileSync(new URL('src/run-autonomous-intelligence.js', root), 'utf8');
  const operationalHealthSource = fs.readFileSync(new URL('src/operational-health.js', root), 'utf8');
  const matches = source.match(/operationalHealth:\s*\{/g) || [];
  assert.equal(matches.length, 1);
  assert.doesNotMatch(source, /baseReport\.operationalHealth\s*=/);
  const block = source.match(/operationalHealth:\s*\{([\s\S]*?)\n\s*\},\n\s*autonomousPublicationCount:/)?.[1] || '';
  assert.ok(block.includes('...operationalHealth'));
  assert.ok(block.includes('...forecastFactorOperationalTelemetry'));
  assert.match(operationalHealthSource, /staleOutput:\s*false,/);
});
