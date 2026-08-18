import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 regime-stacked-ensemble patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(
    source,
    "import { buildForecastStackedEnsembleOperationalTelemetry } from './forecast-stacked-ensemble-production-safety.js';",
    "import { buildForecastStackedEnsembleOperationalTelemetry } from './forecast-stacked-ensemble-production-safety.js';\nimport { buildForecastRegimeStackedEnsembleResearchStatus } from './forecast-regime-stacked-ensemble-research.js';\nimport { buildForecastRegimeStackedEnsembleOperationalTelemetry } from './forecast-regime-stacked-ensemble-production-safety.js';",
    'regime stacked ensemble runtime imports',
  );
  source = replaceRequired(
    source,
    `  const forecastStackedEnsembleOperationalTelemetry = buildForecastStackedEnsembleOperationalTelemetry(forecastStackedEnsembleResearchStatus);\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    `  const forecastStackedEnsembleOperationalTelemetry = buildForecastStackedEnsembleOperationalTelemetry(forecastStackedEnsembleResearchStatus);\n  const forecastRegimeStackedEnsembleResearchStatus = buildForecastRegimeStackedEnsembleResearchStatus({\n    generatedAt,\n    records: forecastOutcomeArchive.records,\n    options,\n  });\n  const forecastRegimeStackedEnsembleOperationalTelemetry = buildForecastRegimeStackedEnsembleOperationalTelemetry(forecastRegimeStackedEnsembleResearchStatus);\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    'regime stacked ensemble research status after pooled stack',
  );
  source = replaceRequired(
    source,
    `    forecastStackedEnsembleResearchStatus,\n    shadowForecastCount: shadowForecasts.length,`,
    `    forecastStackedEnsembleResearchStatus,\n    forecastRegimeStackedEnsembleResearchStatus,\n    shadowForecastCount: shadowForecasts.length,`,
    'regime stacked ensemble report contract',
  );
  source = replaceRequired(
    source,
    `      ...forecastStackedEnsembleOperationalTelemetry,\n    },`,
    `      ...forecastStackedEnsembleOperationalTelemetry,\n      ...forecastRegimeStackedEnsembleOperationalTelemetry,\n    },`,
    'regime stacked ensemble compact telemetry',
  );
  write('src/run-autonomous-intelligence.js', source);
}

function patchProductionVerifier() {
  let source = read('scripts/verify-production-output.js');
  source = replaceRequired(
    source,
    "import { verifyForecastStackedEnsembleProductionSafety } from '../src/forecast-stacked-ensemble-production-safety.js';",
    "import { verifyForecastStackedEnsembleProductionSafety } from '../src/forecast-stacked-ensemble-production-safety.js';\nimport { verifyForecastRegimeStackedEnsembleProductionSafety } from '../src/forecast-regime-stacked-ensemble-production-safety.js';",
    'regime stacked ensemble production verifier import',
  );
  source = replaceRequired(
    source,
    `  verifyForecastStackedEnsembleProductionSafety(report);`,
    `  verifyForecastStackedEnsembleProductionSafety(report);\n  verifyForecastRegimeStackedEnsembleProductionSafety(report);`,
    'regime stacked ensemble production verifier call',
  );
  source = replaceRequired(
    source,
    "  stackedEnsembleResearchSafety: 'REQUIRED'",
    "  stackedEnsembleResearchSafety: 'REQUIRED',\n  regimeConditionalStackedEnsembleSafety: 'REQUIRED'",
    'regime stacked ensemble verifier output marker',
  );
  write('scripts/verify-production-output.js', source);
}

function patchManifestAssertions() {
  let source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.equal(manifest.testPatches.at(-1), 'apply-v1821-stacked-ensemble-research.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1821-stacked-ensemble-research.js');\n  assert.equal(new Set(manifest.testPatches).size, 70);\n  assert.equal(new Set(manifest.buildPatches).size, 69);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1821-stacked-ensemble-research.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1821-stacked-ensemble-research.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1822-regime-stacked-ensemble-research.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1822-regime-stacked-ensemble-research.js');\n  assert.equal(new Set(manifest.testPatches).size, 71);\n  assert.equal(new Set(manifest.buildPatches).size, 70);`,
    'v1822 main manifest assertions',
  );
  write('test/v180-factor-production-observability-runtime.test.js', source);

  source = read('test/forecast-regime-factor-governance-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.equal(manifest.testPatches.at(-1), 'apply-v1821-stacked-ensemble-research.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1821-stacked-ensemble-research.js');\n  assert.equal(new Set(manifest.testPatches).size, 70);\n  assert.equal(new Set(manifest.buildPatches).size, 69);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1821-stacked-ensemble-research.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1821-stacked-ensemble-research.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1822-regime-stacked-ensemble-research.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1822-regime-stacked-ensemble-research.js');\n  assert.equal(new Set(manifest.testPatches).size, 71);\n  assert.equal(new Set(manifest.buildPatches).size, 70);`,
    'v1822 regime governance runtime assertions',
  );
  write('test/forecast-regime-factor-governance-runtime.test.js', source);
}

patchAutonomousRunner();
patchProductionVerifier();
patchManifestAssertions();
console.log('Investor Control v1.8.0 regime-conditional stacked ensemble research runtime applied.');
