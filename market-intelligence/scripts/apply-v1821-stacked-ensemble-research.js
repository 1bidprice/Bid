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

function patchEnsembleResearchSemantics() {
  let source = read('src/forecast-stacked-ensemble-research.js');
  source = replaceRequired(
    source,
    "export const FORECAST_STACKED_ENSEMBLE_RESEARCH_VERSION = '2026-08-12.1';",
    "export const FORECAST_STACKED_ENSEMBLE_RESEARCH_VERSION = '2026-08-12.2';",
    'stacked ensemble research policy version',
  );
  source = replaceRequired(
    source,
    `  const minimumRelativeBrierImprovementPct = Number(options.ensembleMinimumRelativeBrierImprovementPct ?? 3);\n  const minimumLogLossImprovement = Number(options.ensembleMinimumLogLossImprovement ?? 0);\n  const minimumEceImprovement = Number(options.ensembleMinimumEceImprovement ?? -0.01);`,
    `  const minimumRelativeBrierImprovementPct = Number(options.ensembleMinimumRelativeBrierImprovementPct ?? 3);\n  const minimumLogLossImprovement = Number(options.ensembleMinimumLogLossImprovement ?? 0);\n  const calibrationStatus = 'UNCALIBRATED_RESEARCH_ONLY';`,
    'stacked ensemble calibration boundary',
  );
  source = replaceRequired(
    source,
    `  if (!Number.isFinite(Number(comparison.improvement.expectedCalibrationErrorImprovement)) || comparison.improvement.expectedCalibrationErrorImprovement < minimumEceImprovement) {\n    blockers.push('ENSEMBLE_CALIBRATION_ERROR_MATERIALLY_WORSE');\n  }`,
    `  if (!Number.isFinite(Number(comparison.stackedEnsemble.expectedCalibrationError))) {\n    blockers.push('ENSEMBLE_CALIBRATION_DIAGNOSTIC_UNAVAILABLE');\n  }`,
    'stacked ensemble calibration diagnostic without false base-rate comparison',
  );
  source = replaceRequired(
    source,
    `    improvement: comparison.improvement,\n    sampleIndependence,`,
    `    improvement: comparison.improvement,\n    calibrationStatus,\n    sampleIndependence,`,
    'stacked ensemble explicit uncalibrated status',
  );
  source = replaceRequired(
    source,
    `      minimumRelativeBrierImprovementPct,\n      minimumLogLossImprovement,\n      minimumEceImprovement,`,
    `      minimumRelativeBrierImprovementPct,\n      minimumLogLossImprovement,`,
    'stacked ensemble calibration threshold removal',
  );
  if (source.includes('      minimumEceImprovement,\n')) {
    source = source.replace('      minimumEceImprovement,\n', '');
  }
  if (source.includes('minimumEceImprovement')) {
    throw new Error('Investor Control v1.8 stacked-ensemble research patch failed: stale minimumEceImprovement reference remains');
  }
  source = replaceRequired(
    source,
    "      probabilityUse: 'HISTORICAL_PREQUENTIAL_RESEARCH_EVALUATION_ONLY',",
    "      probabilityUse: 'UNCALIBRATED_HISTORICAL_PREQUENTIAL_RESEARCH_EVALUATION_ONLY',",
    'stacked ensemble probability-use disclosure',
  );
  write('src/forecast-stacked-ensemble-research.js', source);

  source = read('src/forecast-stacked-ensemble-production-safety.js');
  source = replaceRequired(
    source,
    `  assert(finiteNumber(thresholds.minimumRelativeBrierImprovementPct) >= 3, \`${'${prefix}'} Brier improvement threshold too weak\`);\n  assert(finiteNumber(thresholds.minimumLogLossImprovement) >= 0, \`${'${prefix}'} log-loss threshold too weak\`);\n  assert(finiteNumber(thresholds.minimumEceImprovement) >= -0.01, \`${'${prefix}'} calibration-error threshold too weak\`);`,
    `  assert(finiteNumber(thresholds.minimumRelativeBrierImprovementPct) >= 3, \`${'${prefix}'} Brier improvement threshold too weak\`);\n  assert(finiteNumber(thresholds.minimumLogLossImprovement) >= 0, \`${'${prefix}'} log-loss threshold too weak\`);\n  assert(group?.calibrationStatus === 'UNCALIBRATED_RESEARCH_ONLY', \`${'${prefix}'} calibration status must remain research-only\`);`,
    'stacked ensemble production calibration boundary',
  );
  source = replaceRequired(
    source,
    `  assert(finiteNumber(improvement.relativeBrierImprovementPct) >= thresholds.minimumRelativeBrierImprovementPct, \`${'${prefix}'} Brier improvement below threshold\`);\n  assert(finiteNumber(improvement.logLossImprovement) >= thresholds.minimumLogLossImprovement, \`${'${prefix}'} log-loss improvement below threshold\`);\n  assert(finiteNumber(improvement.expectedCalibrationErrorImprovement) >= thresholds.minimumEceImprovement, \`${'${prefix}'} calibration-error improvement below threshold\`);`,
    `  assert(finiteNumber(improvement.relativeBrierImprovementPct) >= thresholds.minimumRelativeBrierImprovementPct, \`${'${prefix}'} Brier improvement below threshold\`);\n  assert(finiteNumber(improvement.logLossImprovement) >= thresholds.minimumLogLossImprovement, \`${'${prefix}'} log-loss improvement below threshold\`);\n  const ensembleEce = finiteNumber(group?.ensembleMetrics?.expectedCalibrationError);\n  assert(ensembleEce !== null && ensembleEce >= 0 && ensembleEce <= 1, \`${'${prefix}'} calibration diagnostic invalid\`);`,
    'stacked ensemble production calibration diagnostic',
  );
  write('src/forecast-stacked-ensemble-production-safety.js', source);

  source = read('test/forecast-stacked-ensemble-research.test.js');
  source = replaceRequired(
    source,
    `  const outcomePositive = options.outcome ?? (options.invert ? factorScore < 0 : factorScore > 0 ? 1 : 0);`,
    `  const outcomePositive = options.outcome ?? ((options.invert ? factorScore < 0 : factorScore > 0) ? 1 : 0);`,
    'stacked ensemble inverted-outcome fixture strict binary value',
  );
  source = replaceRequired(
    source,
    `  assert.ok(group.improvement.logLossImprovement >= 0);\n  assert.equal(group.sampleIndependence.status, 'INDEPENDENCE_READY');`,
    `  assert.ok(group.improvement.logLossImprovement >= 0);\n  assert.equal(group.calibrationStatus, 'UNCALIBRATED_RESEARCH_ONLY');\n  assert.equal(group.probabilityCalibrationEnabled, false);\n  assert.equal(group.sampleIndependence.status, 'INDEPENDENCE_READY');`,
    'stacked ensemble explicit research-only calibration assertion',
  );
  write('test/forecast-stacked-ensemble-research.test.js', source);
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

patchEnsembleResearchSemantics();
patchAutonomousRunner();
patchProductionVerifier();
patchManifestAssertions();
console.log('Investor Control v1.8.0 leakage-safe stacked ensemble research runtime applied.');
