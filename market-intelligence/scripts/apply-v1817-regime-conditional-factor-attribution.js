import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 regime-factor patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(
    source,
    "import { buildForecastRegimeOperationalTelemetry } from './forecast-regime-production-safety.js';",
    "import { buildForecastRegimeOperationalTelemetry } from './forecast-regime-production-safety.js';\nimport { buildForecastRegimeFactorAttributionStatus } from './forecast-regime-factor-attribution.js';\nimport { buildForecastRegimeFactorOperationalTelemetry } from './forecast-regime-factor-production-safety.js';",
    'regime-factor imports',
  );

  source = replaceRequired(
    source,
    `  const forecastRegimeOperationalTelemetry = buildForecastRegimeOperationalTelemetry(forecastRegimeLearningStatus);\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    `  const forecastRegimeOperationalTelemetry = buildForecastRegimeOperationalTelemetry(forecastRegimeLearningStatus);\n  const forecastRegimeFactorAttributionStatus = buildForecastRegimeFactorAttributionStatus({\n    generatedAt,\n    records: forecastOutcomeArchive.records,\n    options,\n  });\n  const forecastRegimeFactorOperationalTelemetry = buildForecastRegimeFactorOperationalTelemetry(forecastRegimeFactorAttributionStatus);\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    'regime-factor status after regime learning',
  );

  source = replaceRequired(
    source,
    `    forecastRegimeLearningStatus,\n    shadowForecastCount: shadowForecasts.length,`,
    `    forecastRegimeLearningStatus,\n    forecastRegimeFactorAttributionStatus,\n    shadowForecastCount: shadowForecasts.length,`,
    'regime-factor report contract',
  );

  source = replaceRequired(
    source,
    `      ...forecastFactorOperationalTelemetry,\n      ...forecastRegimeOperationalTelemetry,\n    },`,
    `      ...forecastFactorOperationalTelemetry,\n      ...forecastRegimeOperationalTelemetry,\n      ...forecastRegimeFactorOperationalTelemetry,\n    },`,
    'regime-factor operational telemetry',
  );
  write('src/run-autonomous-intelligence.js', source);
}

function patchProductionVerifier() {
  let source = read('scripts/verify-production-output.js');
  source = replaceRequired(
    source,
    "import { verifyForecastRegimeProductionSafety } from '../src/forecast-regime-production-safety.js';",
    "import { verifyForecastRegimeProductionSafety } from '../src/forecast-regime-production-safety.js';\nimport { verifyForecastRegimeFactorProductionSafety } from '../src/forecast-regime-factor-production-safety.js';",
    'regime-factor production safety import',
  );

  source = replaceRequired(
    source,
    `  verifyForecastFactorProductionSafety(report);\n  verifyForecastRegimeProductionSafety(report);`,
    `  verifyForecastFactorProductionSafety(report);\n  verifyForecastRegimeProductionSafety(report);\n  verifyForecastRegimeFactorProductionSafety(report);`,
    'regime-factor production safety gate',
  );

  source = replaceRequired(
    source,
    "  regimeStratifiedOosResearchSafety: 'REQUIRED'",
    "  regimeStratifiedOosResearchSafety: 'REQUIRED',\n  regimeConditionalFactorResearchSafety: 'REQUIRED'",
    'regime-factor verifier output marker',
  );
  write('scripts/verify-production-output.js', source);
}

function patchManifestAssertions() {
  let source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.ok(manifest.testPatches.includes('apply-v1815-forecast-market-regime-lineage.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1815-forecast-market-regime-lineage.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1816-regime-stratified-oos-learning.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1816-regime-stratified-oos-learning.js');\n  assert.equal(new Set(manifest.testPatches).size, 65);\n  assert.equal(new Set(manifest.buildPatches).size, 64);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1816-regime-stratified-oos-learning.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1816-regime-stratified-oos-learning.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1817-regime-conditional-factor-attribution.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1817-regime-conditional-factor-attribution.js');\n  assert.equal(new Set(manifest.testPatches).size, 66);\n  assert.equal(new Set(manifest.buildPatches).size, 65);`,
    'v1817 manifest assertions',
  );
  write('test/v180-factor-production-observability-runtime.test.js', source);
}

patchAutonomousRunner();
patchProductionVerifier();
patchManifestAssertions();
console.log('Investor Control v1.8.0 regime-conditional factor attribution runtime applied.');
