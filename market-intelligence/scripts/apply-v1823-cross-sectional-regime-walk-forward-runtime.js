import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 cross-sectional historical walk-forward runtime patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(
    source,
    "import { buildForecastRegimeStackedEnsembleOperationalTelemetry } from './forecast-regime-stacked-ensemble-production-safety.js';",
    "import { buildForecastRegimeStackedEnsembleOperationalTelemetry } from './forecast-regime-stacked-ensemble-production-safety.js';\nimport { buildCrossSectionalRegimeWalkForwardRuntimeStatus } from './forecast-cross-sectional-regime-walk-forward-runtime.js';\nimport { buildCrossSectionalRegimeWalkForwardOperationalTelemetry } from './forecast-cross-sectional-regime-walk-forward-production-safety.js';",
    'historical walk-forward runtime imports',
  );
  source = replaceRequired(
    source,
    `  const forecastRegimeStackedEnsembleOperationalTelemetry = buildForecastRegimeStackedEnsembleOperationalTelemetry(forecastRegimeStackedEnsembleResearchStatus);\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    `  const forecastRegimeStackedEnsembleOperationalTelemetry = buildForecastRegimeStackedEnsembleOperationalTelemetry(forecastRegimeStackedEnsembleResearchStatus);\n  const forecastCrossSectionalRegimeWalkForwardRuntimeStatus = buildCrossSectionalRegimeWalkForwardRuntimeStatus({\n    enabled: options.crossSectionalHistoricalRegimeWalkForwardEnabled === true,\n    generatedAt,\n    researchDossiers,\n    historicalSeriesByCompany: historicalSeriesCollector,\n    benchmarkSeriesByCompany: benchmarkSeriesCollector,\n    maximumInstrumentCount: options.crossSectionalHistoricalRegimeWalkForwardMaxInstruments,\n    options: options.crossSectionalHistoricalRegimeWalkForwardOptions || {},\n  });\n  const forecastCrossSectionalRegimeWalkForwardOperationalTelemetry = buildCrossSectionalRegimeWalkForwardOperationalTelemetry(forecastCrossSectionalRegimeWalkForwardRuntimeStatus);\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    'historical walk-forward runtime status',
  );
  source = replaceRequired(
    source,
    `    forecastRegimeStackedEnsembleResearchStatus,\n    shadowForecastCount: shadowForecasts.length,`,
    `    forecastRegimeStackedEnsembleResearchStatus,\n    forecastCrossSectionalRegimeWalkForwardRuntimeStatus,\n    shadowForecastCount: shadowForecasts.length,`,
    'historical walk-forward report contract',
  );
  source = replaceRequired(
    source,
    `      ...forecastRegimeStackedEnsembleOperationalTelemetry,\n    },`,
    `      ...forecastRegimeStackedEnsembleOperationalTelemetry,\n      ...forecastCrossSectionalRegimeWalkForwardOperationalTelemetry,\n    },`,
    'historical walk-forward compact telemetry',
  );
  write('src/run-autonomous-intelligence.js', source);
}

function patchProductionVerifier() {
  let source = read('scripts/verify-production-output.js');
  source = replaceRequired(
    source,
    "import { verifyForecastRegimeStackedEnsembleProductionSafety } from '../src/forecast-regime-stacked-ensemble-production-safety.js';",
    "import { verifyForecastRegimeStackedEnsembleProductionSafety } from '../src/forecast-regime-stacked-ensemble-production-safety.js';\nimport { verifyCrossSectionalRegimeWalkForwardProductionSafety } from '../src/forecast-cross-sectional-regime-walk-forward-production-safety.js';",
    'historical walk-forward production verifier import',
  );
  source = replaceRequired(
    source,
    `  verifyForecastRegimeStackedEnsembleProductionSafety(report);`,
    `  verifyForecastRegimeStackedEnsembleProductionSafety(report);\n  verifyCrossSectionalRegimeWalkForwardProductionSafety(report);`,
    'historical walk-forward production verifier call',
  );
  source = replaceRequired(
    source,
    "  regimeConditionalStackedEnsembleSafety: 'REQUIRED'",
    "  regimeConditionalStackedEnsembleSafety: 'REQUIRED',\n  crossSectionalHistoricalRegimeWalkForwardSafety: 'REQUIRED'",
    'historical walk-forward verifier output marker',
  );
  write('scripts/verify-production-output.js', source);
}

function patchManifestAssertions() {
  let source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.ok(manifest.testPatches.includes('apply-v1821-stacked-ensemble-research.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1821-stacked-ensemble-research.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1822-regime-stacked-ensemble-research.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1822-regime-stacked-ensemble-research.js');\n  assert.equal(new Set(manifest.testPatches).size, 71);\n  assert.equal(new Set(manifest.buildPatches).size, 70);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1822-regime-stacked-ensemble-research.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1822-regime-stacked-ensemble-research.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1823-cross-sectional-regime-walk-forward-runtime.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1823-cross-sectional-regime-walk-forward-runtime.js');\n  assert.equal(new Set(manifest.testPatches).size, 72);\n  assert.equal(new Set(manifest.buildPatches).size, 71);`,
    'v1823 main manifest assertions',
  );
  write('test/v180-factor-production-observability-runtime.test.js', source);

  source = read('test/forecast-regime-factor-governance-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.ok(manifest.testPatches.includes('apply-v1821-stacked-ensemble-research.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1821-stacked-ensemble-research.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1822-regime-stacked-ensemble-research.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1822-regime-stacked-ensemble-research.js');\n  assert.equal(new Set(manifest.testPatches).size, 71);\n  assert.equal(new Set(manifest.buildPatches).size, 70);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1822-regime-stacked-ensemble-research.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1822-regime-stacked-ensemble-research.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1823-cross-sectional-regime-walk-forward-runtime.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1823-cross-sectional-regime-walk-forward-runtime.js');\n  assert.equal(new Set(manifest.testPatches).size, 72);\n  assert.equal(new Set(manifest.buildPatches).size, 71);`,
    'v1823 regime governance manifest assertions',
  );
  write('test/forecast-regime-factor-governance-runtime.test.js', source);

  source = read('test/forecast-stacked-ensemble-production-safety.test.js');
  source = replaceRequired(
    source,
    `  assert.ok(manifest.testPatches.includes('apply-v1821-stacked-ensemble-research.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1821-stacked-ensemble-research.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1822-regime-stacked-ensemble-research.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1822-regime-stacked-ensemble-research.js');\n  assert.equal(new Set(manifest.testPatches).size, 71);\n  assert.equal(new Set(manifest.buildPatches).size, 70);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1822-regime-stacked-ensemble-research.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1822-regime-stacked-ensemble-research.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1823-cross-sectional-regime-walk-forward-runtime.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1823-cross-sectional-regime-walk-forward-runtime.js');\n  assert.equal(new Set(manifest.testPatches).size, 72);\n  assert.equal(new Set(manifest.buildPatches).size, 71);`,
    'v1823 stacked ensemble manifest assertions',
  );
  write('test/forecast-stacked-ensemble-production-safety.test.js', source);
}

patchAutonomousRunner();
patchProductionVerifier();
patchManifestAssertions();
console.log('Investor Control v1.8.0 default-off cross-sectional historical regime walk-forward runtime applied.');
