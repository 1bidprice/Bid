import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 regime-learning patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(
    source,
    "import { buildForecastFactorOperationalTelemetry } from './forecast-factor-production-safety.js';",
    "import { buildForecastFactorOperationalTelemetry } from './forecast-factor-production-safety.js';\nimport { buildForecastRegimeLearningStatus } from './forecast-regime-learning-status.js';\nimport { buildForecastRegimeOperationalTelemetry } from './forecast-regime-production-safety.js';",
    'regime learning imports',
  );

  source = replaceRequired(
    source,
    `  const forecastFactorOperationalTelemetry = buildForecastFactorOperationalTelemetry({\n    forecastFactorLearningStatus,\n    forecastFactorAttributionStatus,\n    forecastFactorWeightGovernanceStatus,\n  });\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    `  const forecastFactorOperationalTelemetry = buildForecastFactorOperationalTelemetry({\n    forecastFactorLearningStatus,\n    forecastFactorAttributionStatus,\n    forecastFactorWeightGovernanceStatus,\n  });\n  const forecastRegimeLearningStatus = buildForecastRegimeLearningStatus({\n    generatedAt,\n    records: forecastOutcomeArchive.records,\n    options,\n  });\n  const forecastRegimeOperationalTelemetry = buildForecastRegimeOperationalTelemetry(forecastRegimeLearningStatus);\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    'regime learning after archive and factor research',
  );

  source = replaceRequired(
    source,
    '    forecastFactorAttributionStatus,\n    forecastFactorWeightGovernanceStatus,\n    shadowForecastCount: shadowForecasts.length,',
    '    forecastFactorAttributionStatus,\n    forecastFactorWeightGovernanceStatus,\n    forecastRegimeLearningStatus,\n    shadowForecastCount: shadowForecasts.length,',
    'regime learning report contract',
  );

  source = replaceRequired(
    source,
    `      staleOutput: false,\n      ...forecastFactorOperationalTelemetry,\n    },`,
    `      staleOutput: false,\n      ...forecastFactorOperationalTelemetry,\n      ...forecastRegimeOperationalTelemetry,\n    },`,
    'regime learning canonical operational telemetry',
  );

  write('src/run-autonomous-intelligence.js', source);
}

function patchProductionVerifier() {
  let source = read('scripts/verify-production-output.js');
  source = replaceRequired(
    source,
    "import { verifyForecastFactorProductionSafety } from '../src/forecast-factor-production-safety.js';",
    "import { verifyForecastFactorProductionSafety } from '../src/forecast-factor-production-safety.js';\nimport { verifyForecastRegimeProductionSafety } from '../src/forecast-regime-production-safety.js';",
    'regime production safety import',
  );

  source = replaceRequired(
    source,
    `try {\n  verifyForecastFactorProductionSafety(report);\n} catch (error) {\n  fail(error instanceof Error ? error.message : String(error));\n}`,
    `try {\n  verifyForecastFactorProductionSafety(report);\n  verifyForecastRegimeProductionSafety(report);\n} catch (error) {\n  fail(error instanceof Error ? error.message : String(error));\n}`,
    'regime production safety gate',
  );

  source = replaceRequired(
    source,
    "  factorResearchGovernanceSafety: 'REQUIRED'",
    "  factorResearchGovernanceSafety: 'REQUIRED',\n  regimeStratifiedOosResearchSafety: 'REQUIRED'",
    'regime verifier output marker',
  );
  write('scripts/verify-production-output.js', source);
}

function patchManifestAssertions() {
  let source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.ok(manifest.testPatches.includes('apply-v1814-oos-taxonomy-concentration.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1814-oos-taxonomy-concentration.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1815-forecast-market-regime-lineage.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1815-forecast-market-regime-lineage.js');\n  assert.equal(new Set(manifest.testPatches).size, 64);\n  assert.equal(new Set(manifest.buildPatches).size, 63);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1815-forecast-market-regime-lineage.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1815-forecast-market-regime-lineage.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1816-regime-stratified-oos-learning.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1816-regime-stratified-oos-learning.js');\n  assert.equal(new Set(manifest.testPatches).size, 65);\n  assert.equal(new Set(manifest.buildPatches).size, 64);`,
    'v1816 manifest assertions',
  );
  write('test/v180-factor-production-observability-runtime.test.js', source);
}

patchAutonomousRunner();
patchProductionVerifier();
patchManifestAssertions();
console.log('Investor Control v1.8.0 regime-stratified OOS learning runtime applied.');
