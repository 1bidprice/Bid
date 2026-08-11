import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 OOS instrument-concentration patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchFactorLearning() {
  let source = read('src/forecast-factor-learning-status.js');
  source = replaceRequired(
    source,
    "import { evaluateOosOutcomeWindowIndependence } from './forecast-oos-outcome-window-independence.js';",
    "import { evaluateOosOutcomeWindowIndependence } from './forecast-oos-outcome-window-independence.js';\nimport { evaluateOosInstrumentConcentration } from './forecast-oos-instrument-concentration.js';",
    'factor learning instrument-concentration import',
  );
  source = replaceRequired(
    source,
    "export const FORECAST_FACTOR_LEARNING_STATUS_VERSION = '2026-08-11.4';",
    "export const FORECAST_FACTOR_LEARNING_STATUS_VERSION = '2026-08-11.5';",
    'factor learning instrument-concentration version',
  );
  source = replaceRequired(
    source,
    `  const outcomeWindowIndependence = evaluateOosOutcomeWindowIndependence(maturedScored, {
    minimumEffectiveNonOverlappingWindows: options.factorMinimumEffectiveNonOverlappingOutcomeWindows ?? 12,
  });

  const rocAuc = auc(maturedScored);`,
    `  const outcomeWindowIndependence = evaluateOosOutcomeWindowIndependence(maturedScored, {
    minimumEffectiveNonOverlappingWindows: options.factorMinimumEffectiveNonOverlappingOutcomeWindows ?? 12,
  });
  const instrumentConcentration = evaluateOosInstrumentConcentration(maturedScored, {
    maximumSingleInstrumentSharePct: options.factorMaximumSingleInstrumentSharePct ?? 25,
    minimumEffectiveInstrumentCount: options.factorMinimumEffectiveInstrumentCount ?? 6,
  });

  const rocAuc = auc(maturedScored);`,
    'factor learning instrument-concentration evaluation',
  );
  source = replaceRequired(
    source,
    `  blockers.push(...sampleIndependence.blockers);
  blockers.push(...outcomeWindowIndependence.blockers);`,
    `  blockers.push(...sampleIndependence.blockers);
  blockers.push(...outcomeWindowIndependence.blockers);
  blockers.push(...instrumentConcentration.blockers);`,
    'factor learning instrument-concentration blockers',
  );
  source = replaceRequired(
    source,
    `    sampleIndependence,
    outcomeWindowIndependence,
    discrimination: {`,
    `    sampleIndependence,
    outcomeWindowIndependence,
    instrumentConcentration,
    discrimination: {`,
    'factor learning instrument-concentration output',
  );
  write('src/forecast-factor-learning-status.js', source);
}

function patchFactorAttribution() {
  let source = read('src/forecast-factor-attribution.js');
  source = replaceRequired(
    source,
    "import { evaluateOosOutcomeWindowIndependence } from './forecast-oos-outcome-window-independence.js';",
    "import { evaluateOosOutcomeWindowIndependence } from './forecast-oos-outcome-window-independence.js';\nimport { evaluateOosInstrumentConcentration } from './forecast-oos-instrument-concentration.js';",
    'factor attribution instrument-concentration import',
  );
  source = replaceRequired(
    source,
    "export const FORECAST_FACTOR_ATTRIBUTION_VERSION = '2026-08-11.4';",
    "export const FORECAST_FACTOR_ATTRIBUTION_VERSION = '2026-08-11.5';",
    'factor attribution instrument-concentration version',
  );
  source = replaceRequired(
    source,
    `  const outcomeWindowIndependence = evaluateOosOutcomeWindowIndependence(matured, {
    minimumEffectiveNonOverlappingWindows: options.factorAttributionMinimumEffectiveNonOverlappingOutcomeWindows ?? 12,
  });
  const blockers = [...sampleIndependence.blockers, ...outcomeWindowIndependence.blockers];`,
    `  const outcomeWindowIndependence = evaluateOosOutcomeWindowIndependence(matured, {
    minimumEffectiveNonOverlappingWindows: options.factorAttributionMinimumEffectiveNonOverlappingOutcomeWindows ?? 12,
  });
  const instrumentConcentration = evaluateOosInstrumentConcentration(matured, {
    maximumSingleInstrumentSharePct: options.factorAttributionMaximumSingleInstrumentSharePct ?? 25,
    minimumEffectiveInstrumentCount: options.factorAttributionMinimumEffectiveInstrumentCount ?? 6,
  });
  const blockers = [...sampleIndependence.blockers, ...outcomeWindowIndependence.blockers, ...instrumentConcentration.blockers];`,
    'factor attribution instrument-concentration gate',
  );
  source = replaceRequired(
    source,
    `    sampleIndependence,
    outcomeWindowIndependence,
    blockers: [...new Set(blockers)],`,
    `    sampleIndependence,
    outcomeWindowIndependence,
    instrumentConcentration,
    blockers: [...new Set(blockers)],`,
    'factor attribution instrument-concentration output',
  );
  write('src/forecast-factor-attribution.js', source);
}

function patchFactorGovernance() {
  let source = read('src/forecast-factor-weight-governance.js');
  source = replaceRequired(
    source,
    "import { evaluateOosOutcomeWindowIndependence } from './forecast-oos-outcome-window-independence.js';",
    "import { evaluateOosOutcomeWindowIndependence } from './forecast-oos-outcome-window-independence.js';\nimport { evaluateOosInstrumentConcentration } from './forecast-oos-instrument-concentration.js';",
    'governance instrument-concentration import',
  );
  source = replaceRequired(
    source,
    "export const FORECAST_FACTOR_WEIGHT_GOVERNANCE_VERSION = '2026-08-11.3';",
    "export const FORECAST_FACTOR_WEIGHT_GOVERNANCE_VERSION = '2026-08-11.4';",
    'governance instrument-concentration version',
  );
  source = replaceRequired(
    source,
    `  const outcomeWindowIndependence = evaluateOosOutcomeWindowIndependence(matured, {
    minimumEffectiveNonOverlappingWindows: options.weightGovernanceMinimumEffectiveNonOverlappingOutcomeWindows ?? 18,
  });
  const blockers = [...sampleIndependence.blockers, ...outcomeWindowIndependence.blockers];`,
    `  const outcomeWindowIndependence = evaluateOosOutcomeWindowIndependence(matured, {
    minimumEffectiveNonOverlappingWindows: options.weightGovernanceMinimumEffectiveNonOverlappingOutcomeWindows ?? 18,
  });
  const instrumentConcentration = evaluateOosInstrumentConcentration(matured, {
    maximumSingleInstrumentSharePct: options.weightGovernanceMaximumSingleInstrumentSharePct ?? 20,
    minimumEffectiveInstrumentCount: options.weightGovernanceMinimumEffectiveInstrumentCount ?? 8,
  });
  const blockers = [...sampleIndependence.blockers, ...outcomeWindowIndependence.blockers, ...instrumentConcentration.blockers];`,
    'governance instrument-concentration gate',
  );
  source = replaceRequired(
    source,
    `    sampleIndependence,
    outcomeWindowIndependence,
    upstreamAttributionStatus:`,
    `    sampleIndependence,
    outcomeWindowIndependence,
    instrumentConcentration,
    upstreamAttributionStatus:`,
    'governance instrument-concentration output',
  );
  source = replaceRequired(
    source,
    `      sampleIndependence: evaluation.sampleIndependence,
      outcomeWindowIndependence: evaluation.outcomeWindowIndependence,
    },`,
    `      sampleIndependence: evaluation.sampleIndependence,
      outcomeWindowIndependence: evaluation.outcomeWindowIndependence,
      instrumentConcentration: evaluation.instrumentConcentration,
    },`,
    'governance proposal instrument-concentration evidence',
  );
  source = replaceRequired(
    source,
    `      'OOS_OUTCOME_WINDOW_INDEPENDENCE_GATE_PASSED',
      'MANUAL_REVIEW_ONLY_NO_AUTOMATIC_APPLICATION',`,
    `      'OOS_OUTCOME_WINDOW_INDEPENDENCE_GATE_PASSED',
      'OOS_INSTRUMENT_CONCENTRATION_GATE_PASSED',
      'MANUAL_REVIEW_ONLY_NO_AUTOMATIC_APPLICATION',`,
    'governance instrument-concentration rationale',
  );
  write('src/forecast-factor-weight-governance.js', source);
}

function patchProductionVerifier() {
  let source = read('src/forecast-factor-production-safety.js');
  source = replaceRequired(
    source,
    `  const windows = proposal?.evidence?.outcomeWindowIndependence;
  assert(windows?.contract === 'OOS_OUTCOME_WINDOW_INDEPENDENCE_V1', prefix + ' outcome-window independence contract missing');`,
    `  const instruments = proposal?.evidence?.instrumentConcentration;
  assert(instruments?.contract === 'OOS_INSTRUMENT_CONCENTRATION_V1', prefix + ' instrument-concentration contract missing');
  assert(instruments?.status === 'INSTRUMENT_DIVERSIFICATION_READY', prefix + ' instrument diversification not ready');
  const maximumInstrumentShareThreshold = finiteNumber(instruments?.thresholds?.maximumSingleInstrumentSharePct);
  assert(maximumInstrumentShareThreshold !== null && maximumInstrumentShareThreshold <= 20, prefix + ' single-instrument threshold too weak');
  const minimumEffectiveInstrumentCount = finiteNumber(instruments?.thresholds?.minimumEffectiveInstrumentCount);
  assert(minimumEffectiveInstrumentCount !== null && minimumEffectiveInstrumentCount >= 8, prefix + ' effective-instrument threshold too weak');
  assert(nonNegativeInteger(instruments.missingInstrumentIdentityCount) === 0, prefix + ' has missing instrument identities for concentration');
  const actualMaximumInstrumentShare = finiteNumber(instruments.maximumSingleInstrumentSharePct);
  assert(actualMaximumInstrumentShare !== null && actualMaximumInstrumentShare <= maximumInstrumentShareThreshold, prefix + ' single-instrument concentration exceeds threshold');
  const effectiveInstrumentCount = finiteNumber(instruments.effectiveInstrumentCount);
  assert(effectiveInstrumentCount !== null && effectiveInstrumentCount >= minimumEffectiveInstrumentCount, prefix + ' effective instrument count too small');

  const windows = proposal?.evidence?.outcomeWindowIndependence;
  assert(windows?.contract === 'OOS_OUTCOME_WINDOW_INDEPENDENCE_V1', prefix + ' outcome-window independence contract missing');`,
    'production instrument-concentration verification',
  );
  write('src/forecast-factor-production-safety.js', source);
}

function patchManifestAssertions() {
  let source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.equal(manifest.testPatches.at(-1), 'apply-v1810-oos-outcome-window-independence.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1810-oos-outcome-window-independence.js');
  assert.equal(new Set(manifest.testPatches).size, 59);
  assert.equal(new Set(manifest.buildPatches).size, 58);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1810-oos-outcome-window-independence.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1810-oos-outcome-window-independence.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1811-oos-instrument-concentration.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1811-oos-instrument-concentration.js');
  assert.equal(new Set(manifest.testPatches).size, 60);
  assert.equal(new Set(manifest.buildPatches).size, 59);`,
    'v1811 manifest assertions',
  );
  write('test/v180-factor-production-observability-runtime.test.js', source);
}

patchFactorLearning();
patchFactorAttribution();
patchFactorGovernance();
patchProductionVerifier();
patchManifestAssertions();
console.log('Investor Control v1.8.0 OOS instrument-concentration governance gate applied.');