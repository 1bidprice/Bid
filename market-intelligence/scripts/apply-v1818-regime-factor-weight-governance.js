import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 regime-factor governance patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(
    source,
    "import { buildForecastRegimeFactorOperationalTelemetry } from './forecast-regime-factor-production-safety.js';",
    "import { buildForecastRegimeFactorOperationalTelemetry } from './forecast-regime-factor-production-safety.js';\nimport { buildForecastRegimeFactorWeightGovernanceStatus } from './forecast-regime-factor-weight-governance.js';\nimport { buildForecastRegimeFactorGovernanceOperationalTelemetry } from './forecast-regime-factor-governance-production-safety.js';",
    'regime-factor governance imports',
  );

  source = replaceRequired(
    source,
    `  const forecastRegimeFactorOperationalTelemetry = buildForecastRegimeFactorOperationalTelemetry(forecastRegimeFactorAttributionStatus);\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    `  const forecastRegimeFactorOperationalTelemetry = buildForecastRegimeFactorOperationalTelemetry(forecastRegimeFactorAttributionStatus);\n  const forecastRegimeFactorWeightGovernanceStatus = buildForecastRegimeFactorWeightGovernanceStatus({\n    generatedAt,\n    records: forecastOutcomeArchive.records,\n    regimeFactorAttributionStatus: forecastRegimeFactorAttributionStatus,\n    regimeLearningStatus: forecastRegimeLearningStatus,\n    options,\n  });\n  const forecastRegimeFactorGovernanceOperationalTelemetry = buildForecastRegimeFactorGovernanceOperationalTelemetry(forecastRegimeFactorWeightGovernanceStatus);\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    'regime-factor governance status after attribution',
  );

  source = replaceRequired(
    source,
    `    forecastRegimeFactorAttributionStatus,\n    shadowForecastCount: shadowForecasts.length,`,
    `    forecastRegimeFactorAttributionStatus,\n    forecastRegimeFactorWeightGovernanceStatus,\n    shadowForecastCount: shadowForecasts.length,`,
    'regime-factor governance report contract',
  );

  source = replaceRequired(
    source,
    `      ...forecastRegimeFactorOperationalTelemetry,\n    },`,
    `      ...forecastRegimeFactorOperationalTelemetry,\n      ...forecastRegimeFactorGovernanceOperationalTelemetry,\n    },`,
    'regime-factor governance telemetry',
  );
  write('src/run-autonomous-intelligence.js', source);
}

function patchProductionVerifier() {
  let source = read('scripts/verify-production-output.js');
  source = replaceRequired(
    source,
    "import { verifyForecastRegimeFactorProductionSafety } from '../src/forecast-regime-factor-production-safety.js';",
    "import { verifyForecastRegimeFactorProductionSafety } from '../src/forecast-regime-factor-production-safety.js';\nimport { verifyForecastRegimeFactorGovernanceProductionSafety } from '../src/forecast-regime-factor-governance-production-safety.js';",
    'regime-factor governance production safety import',
  );

  source = replaceRequired(
    source,
    `  verifyForecastRegimeProductionSafety(report);\n  verifyForecastRegimeFactorProductionSafety(report);`,
    `  verifyForecastRegimeProductionSafety(report);\n  verifyForecastRegimeFactorProductionSafety(report);\n  verifyForecastRegimeFactorGovernanceProductionSafety(report);`,
    'regime-factor governance production safety gate',
  );

  source = replaceRequired(
    source,
    "  regimeConditionalFactorResearchSafety: 'REQUIRED'",
    "  regimeConditionalFactorResearchSafety: 'REQUIRED',\n  regimeConditionalFactorGovernanceSafety: 'REQUIRED'",
    'regime-factor governance verifier output marker',
  );
  write('scripts/verify-production-output.js', source);
}

function patchManifestAssertions() {
  let source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.ok(manifest.testPatches.includes('apply-v1816-regime-stratified-oos-learning.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1816-regime-stratified-oos-learning.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1817-regime-conditional-factor-attribution.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1817-regime-conditional-factor-attribution.js');\n  assert.equal(new Set(manifest.testPatches).size, 66);\n  assert.equal(new Set(manifest.buildPatches).size, 65);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1817-regime-conditional-factor-attribution.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1817-regime-conditional-factor-attribution.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1818-regime-factor-weight-governance.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1818-regime-factor-weight-governance.js');\n  assert.equal(new Set(manifest.testPatches).size, 67);\n  assert.equal(new Set(manifest.buildPatches).size, 66);`,
    'v1818 manifest assertions',
  );
  write('test/v180-factor-production-observability-runtime.test.js', source);
}

patchAutonomousRunner();
patchProductionVerifier();
patchManifestAssertions();
console.log('Investor Control v1.8.0 regime-conditional factor weight governance runtime applied.');
