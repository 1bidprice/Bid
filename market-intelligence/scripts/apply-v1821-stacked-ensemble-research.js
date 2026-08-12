import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 stacked-ensemble research patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(
    source,
    "import { buildForecastRegimeFactorGovernanceOperationalTelemetry } from './forecast-regime-factor-governance-production-safety.js';",
    "import { buildForecastRegimeFactorGovernanceOperationalTelemetry } from './forecast-regime-factor-governance-production-safety.js';\nimport { buildForecastStackedEnsembleResearchStatus } from './forecast-stacked-ensemble-research.js';\nimport { buildForecastStackedEnsembleOperationalTelemetry } from './forecast-stacked-ensemble-production-safety.js';",
    'stacked ensemble runtime imports',
  );

  source = replaceRequired(
    source,
    `  const forecastRegimeFactorGovernanceOperationalTelemetry = buildForecastRegimeFactorGovernanceOperationalTelemetry(forecastRegimeFactorWeightGovernanceStatus);\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    `  const forecastRegimeFactorGovernanceOperationalTelemetry = buildForecastRegimeFactorGovernanceOperationalTelemetry(forecastRegimeFactorWeightGovernanceStatus);\n  const forecastStackedEnsembleResearchStatus = buildForecastStackedEnsembleResearchStatus({\n    generatedAt,\n    records: forecastOutcomeArchive.records,\n    options,\n  });\n  const forecastStackedEnsembleOperationalTelemetry = buildForecastStackedEnsembleOperationalTelemetry(forecastStackedEnsembleResearchStatus);\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    'stacked ensemble research status after archive maturation',
  );

  source = replaceRequired(
    source,
    `    forecastRegimeFactorWeightGovernanceStatus,\n    shadowForecastCount: shadowForecasts.length,`,
    `    forecastRegimeFactorWeightGovernanceStatus,\n    forecastStackedEnsembleResearchStatus,\n    shadowForecastCount: shadowForecasts.length,`,
    'stacked ensemble report contract',
  );

  source = replaceRequired(
    source,
    `      ...forecastRegimeFactorGovernanceOperationalTelemetry,\n    },`,
    `      ...forecastRegimeFactorGovernanceOperationalTelemetry,\n      ...forecastStackedEnsembleOperationalTelemetry,\n    },`,
    'stacked ensemble compact telemetry',
  );
  write('src/run-autonomous-intelligence.js', source);
}

function patchProductionVerifier() {
  let source = read('scripts/verify-production-output.js');
  source = replaceRequired(
    source,
    "import { verifyForecastRegimeFactorGovernanceProductionSafety } from '../src/forecast-regime-factor-governance-production-safety.js';",
    "import { verifyForecastRegimeFactorGovernanceProductionSafety } from '../src/forecast-regime-factor-governance-production-safety.js';\nimport { verifyForecastStackedEnsembleProductionSafety } from '../src/forecast-stacked-ensemble-production-safety.js';",
    'stacked ensemble production verifier import',
  );
  source = replaceRequired(
    source,
    `  verifyForecastRegimeFactorProductionSafety(report);\n  verifyForecastRegimeFactorGovernanceProductionSafety(report);`,
    `  verifyForecastRegimeFactorProductionSafety(report);\n  verifyForecastRegimeFactorGovernanceProductionSafety(report);\n  verifyForecastStackedEnsembleProductionSafety(report);`,
    'stacked ensemble production verifier call',
  );
  source = replaceRequired(
    source,
    "  regimeConditionalFactorGovernanceSafety: 'REQUIRED'",
    "  regimeConditionalFactorGovernanceSafety: 'REQUIRED',\n  stackedEnsembleResearchSafety: 'REQUIRED'",
    'stacked ensemble verifier output marker',
  );
  write('scripts/verify-production-output.js', source);
}

function patchManifestAssertions() {
  let source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.ok(manifest.testPatches.includes('apply-v1819-history-session-alignment.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1819-history-session-alignment.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1820-yahoo-history-freshness-recovery.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1820-yahoo-history-freshness-recovery.js');\n  assert.equal(new Set(manifest.testPatches).size, 69);\n  assert.equal(new Set(manifest.buildPatches).size, 68);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1820-yahoo-history-freshness-recovery.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1820-yahoo-history-freshness-recovery.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1821-stacked-ensemble-research.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1821-stacked-ensemble-research.js');\n  assert.equal(new Set(manifest.testPatches).size, 70);\n  assert.equal(new Set(manifest.buildPatches).size, 69);`,
    'v1821 main manifest assertions',
  );
  write('test/v180-factor-production-observability-runtime.test.js', source);

  source = read('test/forecast-regime-factor-governance-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.ok(manifest.testPatches.includes('apply-v1819-history-session-alignment.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1819-history-session-alignment.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1820-yahoo-history-freshness-recovery.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1820-yahoo-history-freshness-recovery.js');\n  assert.equal(new Set(manifest.testPatches).size, 69);\n  assert.equal(new Set(manifest.buildPatches).size, 68);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1819-history-session-alignment.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1819-history-session-alignment.js'));\n  assert.ok(manifest.testPatches.includes('apply-v1820-yahoo-history-freshness-recovery.js'));\n  assert.ok(manifest.buildPatches.includes('apply-v1820-yahoo-history-freshness-recovery.js'));\n  assert.equal(manifest.testPatches.at(-1), 'apply-v1821-stacked-ensemble-research.js');\n  assert.equal(manifest.buildPatches.at(-1), 'apply-v1821-stacked-ensemble-research.js');\n  assert.equal(new Set(manifest.testPatches).size, 70);\n  assert.equal(new Set(manifest.buildPatches).size, 69);`,
    'v1818 runtime invariant after v1821',
  );
  write('test/forecast-regime-factor-governance-runtime.test.js', source);
}

patchAutonomousRunner();
patchProductionVerifier();
patchManifestAssertions();
console.log('Investor Control v1.8.0 leakage-safe stacked ensemble research runtime applied.');
