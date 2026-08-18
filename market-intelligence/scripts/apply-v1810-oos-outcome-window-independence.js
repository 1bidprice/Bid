import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 OOS outcome-window patch failed: missing ${label}`);
  return source.replace(from, to);
}

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  if (source.includes(replacement)) return source;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Investor Control v1.8 OOS outcome-window patch failed: missing ${label}`);
  }
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function patchFactorLearning() {
  let source = read('src/forecast-factor-learning-status.js');
  source = replaceRequired(
    source,
    "import { evaluateOosSampleIndependence, splitChronologicalDateBlocks } from './forecast-oos-sample-independence.js';",
    "import { evaluateOosSampleIndependence, splitChronologicalDateBlocks } from './forecast-oos-sample-independence.js';\nimport { evaluateOosOutcomeWindowIndependence } from './forecast-oos-outcome-window-independence.js';",
    'factor learning outcome-window import',
  );
  source = replaceRequired(
    source,
    "export const FORECAST_FACTOR_LEARNING_STATUS_VERSION = '2026-08-11.3';",
    "export const FORECAST_FACTOR_LEARNING_STATUS_VERSION = '2026-08-11.4';",
    'factor learning outcome-window version',
  );
  source = replaceRequired(
    source,
    `  const sampleIndependence = evaluateOosSampleIndependence(maturedScored, {
    minimumDistinctForecastDates: options.factorMinimumDistinctForecastDates ?? 40,
    minimumDistinctInstruments: options.factorMinimumDistinctInstruments ?? 10,
    maximumSingleForecastDateSharePct: options.factorMaximumSingleForecastDateSharePct ?? 10,
  });

  const rocAuc = auc(maturedScored);`,
    `  const sampleIndependence = evaluateOosSampleIndependence(maturedScored, {
    minimumDistinctForecastDates: options.factorMinimumDistinctForecastDates ?? 40,
    minimumDistinctInstruments: options.factorMinimumDistinctInstruments ?? 10,
    maximumSingleForecastDateSharePct: options.factorMaximumSingleForecastDateSharePct ?? 10,
  });
  const outcomeWindowIndependence = evaluateOosOutcomeWindowIndependence(maturedScored, {
    minimumEffectiveNonOverlappingWindows: options.factorMinimumEffectiveNonOverlappingOutcomeWindows ?? 12,
  });

  const rocAuc = auc(maturedScored);`,
    'factor learning outcome-window evaluation',
  );
  source = replaceRequired(
    source,
    `  const blockers = [];
  blockers.push(...sampleIndependence.blockers);`,
    `  const blockers = [];
  blockers.push(...sampleIndependence.blockers);
  blockers.push(...outcomeWindowIndependence.blockers);`,
    'factor learning outcome-window blockers',
  );
  source = replaceRequired(
    source,
    `    sampleIndependence,
    discrimination: {`,
    `    sampleIndependence,
    outcomeWindowIndependence,
    discrimination: {`,
    'factor learning outcome-window output',
  );
  write('src/forecast-factor-learning-status.js', source);
}

function patchFactorAttribution() {
  let source = read('src/forecast-factor-attribution.js');
  source = replaceRequired(
    source,
    "import { evaluateOosSampleIndependence } from './forecast-oos-sample-independence.js';",
    "import { evaluateOosSampleIndependence } from './forecast-oos-sample-independence.js';\nimport { evaluateOosOutcomeWindowIndependence } from './forecast-oos-outcome-window-independence.js';",
    'factor attribution outcome-window import',
  );
  source = replaceRequired(
    source,
    "export const FORECAST_FACTOR_ATTRIBUTION_VERSION = '2026-08-11.3';",
    "export const FORECAST_FACTOR_ATTRIBUTION_VERSION = '2026-08-11.4';",
    'factor attribution outcome-window version',
  );
  source = replaceRequired(
    source,
    `    realisedReturnPct: matured ? finite(record?.realisedOutcome?.realisedReturnPct) : null,
    forecastAt: record?.forecastAt || null,`,
    `    realisedReturnPct: matured ? finite(record?.realisedOutcome?.realisedReturnPct) : null,
    tradingDays: Number.isInteger(Number(record?.tradingDays)) ? Number(record.tradingDays) : null,
    referencePrice: { timestamp: record?.referencePrice?.timestamp || null },
    realisedOutcome: matured ? {
      timestamp: record?.realisedOutcome?.timestamp || null,
      realisedReturnPct: finite(record?.realisedOutcome?.realisedReturnPct),
    } : null,
    status: record?.status || null,
    forecastAt: record?.forecastAt || null,`,
    'factor attribution outcome-window record fields',
  );
  source = replaceRequired(
    source,
    `  const sampleIndependence = evaluateOosSampleIndependence(matured, {
    minimumDistinctForecastDates: options.factorAttributionMinimumDistinctForecastDates ?? 40,
    minimumDistinctInstruments: options.factorAttributionMinimumDistinctInstruments ?? 10,
    maximumSingleForecastDateSharePct: options.factorAttributionMaximumSingleForecastDateSharePct ?? 10,
  });
  const blockers = [...sampleIndependence.blockers];`,
    `  const sampleIndependence = evaluateOosSampleIndependence(matured, {
    minimumDistinctForecastDates: options.factorAttributionMinimumDistinctForecastDates ?? 40,
    minimumDistinctInstruments: options.factorAttributionMinimumDistinctInstruments ?? 10,
    maximumSingleForecastDateSharePct: options.factorAttributionMaximumSingleForecastDateSharePct ?? 10,
  });
  const outcomeWindowIndependence = evaluateOosOutcomeWindowIndependence(matured, {
    minimumEffectiveNonOverlappingWindows: options.factorAttributionMinimumEffectiveNonOverlappingOutcomeWindows ?? 12,
  });
  const blockers = [...sampleIndependence.blockers, ...outcomeWindowIndependence.blockers];`,
    'factor attribution outcome-window gate',
  );
  source = replaceRequired(
    source,
    `    sampleIndependence,
    blockers: [...new Set(blockers)],`,
    `    sampleIndependence,
    outcomeWindowIndependence,
    blockers: [...new Set(blockers)],`,
    'factor attribution outcome-window output',
  );
  write('src/forecast-factor-attribution.js', source);
}

function patchFactorGovernance() {
  let source = read('src/forecast-factor-weight-governance.js');
  source = replaceRequired(
    source,
    "import { evaluateOosSampleIndependence, splitChronologicalDateBlocks } from './forecast-oos-sample-independence.js';",
    "import { evaluateOosSampleIndependence, splitChronologicalDateBlocks } from './forecast-oos-sample-independence.js';\nimport { evaluateOosOutcomeWindowIndependence } from './forecast-oos-outcome-window-independence.js';",
    'governance outcome-window import',
  );
  source = replaceRequired(
    source,
    "export const FORECAST_FACTOR_WEIGHT_GOVERNANCE_VERSION = '2026-08-11.2';",
    "export const FORECAST_FACTOR_WEIGHT_GOVERNANCE_VERSION = '2026-08-11.3';",
    'governance outcome-window version',
  );
  source = replaceRequired(
    source,
    `    realisedReturnPct: record.status === 'MATURED' ? number(record?.realisedOutcome?.realisedReturnPct) : null,
    invalidMaturedOutcome: record.status === 'MATURED' && !binaryOutcome(record.positiveOutcome),`,
    `    realisedReturnPct: record.status === 'MATURED' ? number(record?.realisedOutcome?.realisedReturnPct) : null,
    tradingDays: Number.isInteger(Number(record?.tradingDays)) ? Number(record.tradingDays) : null,
    referencePrice: { timestamp: record?.referencePrice?.timestamp || null },
    realisedOutcome: record.status === 'MATURED' ? {
      timestamp: record?.realisedOutcome?.timestamp || null,
      realisedReturnPct: number(record?.realisedOutcome?.realisedReturnPct),
    } : null,
    invalidMaturedOutcome: record.status === 'MATURED' && !binaryOutcome(record.positiveOutcome),`,
    'governance outcome-window record fields',
  );
  source = replaceRequired(
    source,
    `  const sampleIndependence = evaluateOosSampleIndependence(matured, {
    minimumDistinctForecastDates: options.weightGovernanceMinimumDistinctForecastDates ?? 60,
    minimumDistinctInstruments: options.weightGovernanceMinimumDistinctInstruments ?? 10,
    maximumSingleForecastDateSharePct: options.weightGovernanceMaximumSingleForecastDateSharePct ?? 10,
  });
  const blockers = [...sampleIndependence.blockers];`,
    `  const sampleIndependence = evaluateOosSampleIndependence(matured, {
    minimumDistinctForecastDates: options.weightGovernanceMinimumDistinctForecastDates ?? 60,
    minimumDistinctInstruments: options.weightGovernanceMinimumDistinctInstruments ?? 10,
    maximumSingleForecastDateSharePct: options.weightGovernanceMaximumSingleForecastDateSharePct ?? 10,
  });
  const outcomeWindowIndependence = evaluateOosOutcomeWindowIndependence(matured, {
    minimumEffectiveNonOverlappingWindows: options.weightGovernanceMinimumEffectiveNonOverlappingOutcomeWindows ?? 18,
  });
  const blockers = [...sampleIndependence.blockers, ...outcomeWindowIndependence.blockers];`,
    'governance outcome-window gate',
  );
  source = replaceRequired(
    source,
    `    sampleIndependence,
    upstreamAttributionStatus:`,
    `    sampleIndependence,
    outcomeWindowIndependence,
    upstreamAttributionStatus:`,
    'governance outcome-window output',
  );
  source = replaceRequired(
    source,
    `      sampleIndependence: evaluation.sampleIndependence,
    },`,
    `      sampleIndependence: evaluation.sampleIndependence,
      outcomeWindowIndependence: evaluation.outcomeWindowIndependence,
    },`,
    'governance proposal outcome-window evidence',
  );
  source = replaceRequired(
    source,
    `      'OOS_SAMPLE_INDEPENDENCE_GATE_PASSED',
      'MANUAL_REVIEW_ONLY_NO_AUTOMATIC_APPLICATION',`,
    `      'OOS_SAMPLE_INDEPENDENCE_GATE_PASSED',
      'OOS_OUTCOME_WINDOW_INDEPENDENCE_GATE_PASSED',
      'MANUAL_REVIEW_ONLY_NO_AUTOMATIC_APPLICATION',`,
    'governance outcome-window rationale',
  );
  write('src/forecast-factor-weight-governance.js', source);
}

function patchProductionVerifier() {
  let source = read('src/forecast-factor-production-safety.js');
  source = replaceRequired(
    source,
    `function safeCount(value) {
  return nonNegativeInteger(value) ?? 0;
}

export function buildForecastFactorOperationalTelemetry`,
    `function safeCount(value) {
  return nonNegativeInteger(value) ?? 0;
}

function verifyProposalIndependenceEvidence(proposal, prefix) {
  const sample = proposal?.evidence?.sampleIndependence;
  assert(sample?.contract === 'OOS_SAMPLE_INDEPENDENCE_V1', prefix + ' sample-independence contract missing');
  assert(sample?.status === 'INDEPENDENCE_READY', prefix + ' sample independence not ready');
  const sampleThresholds = sample?.thresholds || {};
  assert(nonNegativeInteger(sampleThresholds.minimumDistinctForecastDates) !== null && sampleThresholds.minimumDistinctForecastDates >= 60, prefix + ' distinct-date threshold too weak');
  assert(nonNegativeInteger(sampleThresholds.minimumDistinctInstruments) !== null && sampleThresholds.minimumDistinctInstruments >= 10, prefix + ' instrument threshold too weak');
  const maxDateShareThreshold = finiteNumber(sampleThresholds.maximumSingleForecastDateSharePct);
  assert(maxDateShareThreshold !== null && maxDateShareThreshold <= 10, prefix + ' date-concentration threshold too weak');
  assert(nonNegativeInteger(sample.distinctForecastDateCount) !== null && sample.distinctForecastDateCount >= sampleThresholds.minimumDistinctForecastDates, prefix + ' distinct-date support too small');
  assert(nonNegativeInteger(sample.distinctInstrumentCount) !== null && sample.distinctInstrumentCount >= sampleThresholds.minimumDistinctInstruments, prefix + ' instrument support too small');
  assert(nonNegativeInteger(sample.missingForecastDateCount) === 0, prefix + ' has missing forecast dates');
  assert(nonNegativeInteger(sample.missingInstrumentIdentityCount) === 0, prefix + ' has missing instrument identities');
  const maxDateShare = finiteNumber(sample.maximumSingleForecastDateSharePct);
  assert(maxDateShare !== null && maxDateShare <= maxDateShareThreshold, prefix + ' one-date concentration exceeds threshold');

  const windows = proposal?.evidence?.outcomeWindowIndependence;
  assert(windows?.contract === 'OOS_OUTCOME_WINDOW_INDEPENDENCE_V1', prefix + ' outcome-window independence contract missing');
  assert(windows?.status === 'WINDOW_INDEPENDENCE_READY', prefix + ' outcome-window independence not ready');
  const minimumWindows = nonNegativeInteger(windows?.thresholds?.minimumEffectiveNonOverlappingWindows);
  assert(minimumWindows !== null && minimumWindows >= 18, prefix + ' outcome-window threshold too weak');
  assert(nonNegativeInteger(windows.invalidWindowRecordCount) === 0, prefix + ' has invalid outcome-window records');
  const effectiveWindows = nonNegativeInteger(windows.effectiveNonOverlappingWindowCount);
  assert(effectiveWindows !== null && effectiveWindows >= minimumWindows, prefix + ' non-overlapping outcome windows too small');
}

export function buildForecastFactorOperationalTelemetry`,
    'production independence evidence verifier',
  );
  source = replaceRequired(
    source,
    "  assertFalse(proposal.forecastMayInfluenceFinalAction, `${prefix} final-action influence`);\n\n  validateWeightVector(proposal.beforeWeights,",
    "  assertFalse(proposal.forecastMayInfluenceFinalAction, `${prefix} final-action influence`);\n  verifyProposalIndependenceEvidence(proposal, prefix);\n\n  validateWeightVector(proposal.beforeWeights,",
    'production proposal independence verification call',
  );
  write('src/forecast-factor-production-safety.js', source);
}

function patchLegacyFixtures() {
  let source = read('test/forecast-factor-learning-status.test.js');
  source = replaceRequired(
    source,
    `  const forecastAt = new Date(Date.UTC(2026, 0, 1 + index)).toISOString();
  return {`,
    `  const forecastAt = new Date(Date.UTC(2026, 0, 1 + index)).toISOString();
  const tradingDays = Number(options.tradingDays || 21);
  const outcomeAt = new Date(new Date(forecastAt).getTime() + tradingDays * 86_400_000).toISOString();
  return {`,
    'factor learning fixture outcome-window timestamps',
  );
  source = replaceRequired(
    source,
    `    forecastSampleDate: forecastAt.slice(0, 10),
    status: options.open ? 'OPEN' : 'MATURED',`,
    `    forecastSampleDate: forecastAt.slice(0, 10),
    tradingDays,
    referencePrice: { timestamp: forecastAt },
    status: options.open ? 'OPEN' : 'MATURED',`,
    'factor learning fixture outcome-window metadata',
  );
  source = replaceRequired(
    source,
    `    realisedOutcome: options.open ? null : { realisedReturnPct },`,
    `    realisedOutcome: options.open ? null : { timestamp: outcomeAt, realisedReturnPct },`,
    'factor learning fixture realised outcome timestamp',
  );
  write('test/forecast-factor-learning-status.test.js', source);

  source = read('test/forecast-factor-attribution.test.js');
  source = replaceBetween(
    source,
    'const LEVELS=[-.9,-.6,-.3,.1,.4,.8];',
    "test('new record persists compact factor-domain snapshot'",
    `const LEVELS = [-.9, -.6, -.3, .1, .4, .8];
function rec(i, o = {}) {
  const value = o.value ?? LEVELS[i % LEVELS.length];
  const positive = o.invert ? value < 0 : value > 0;
  const at = new Date(Date.UTC(2026, 0, 1 + i * 2)).toISOString();
  const tradingDays = Number(o.tradingDays || 21);
  const outcomeAt = new Date(new Date(at).getTime() + tradingDays * 86_400_000).toISOString();
  return {
    forecastId: 'attr:' + (o.vectorVersion || 'fv-v1') + ':' + i,
    validationMode: 'LIVE_SHADOW_OOS',
    companyId: 'company:' + (i % 20),
    instrumentId: 'instrument:' + (i % 20),
    factorFeatureVectorPolicyVersion: o.noSnapshotVersion ? null : o.vectorVersion || 'fv-v1',
    factorScorePolicyVersion: 'score-v1',
    assetClass: 'EQUITY',
    horizon: 'month1',
    forecastAt: at,
    forecastSampleDate: at.slice(0, 10),
    tradingDays,
    referencePrice: { timestamp: at },
    factorDomainSnapshot: o.noSnapshot ? [] : [
      { domain: 'MOMENTUM', value, weight: .16, verifiedDriverCount: 1 },
      { domain: 'QUALITY', value: value * .8, weight: .12, verifiedDriverCount: 1 },
    ],
    status: o.open ? 'OPEN' : 'MATURED',
    positiveOutcome: o.open ? null : positive ? 1 : 0,
    realisedOutcome: o.open ? null : {
      timestamp: outcomeAt,
      realisedReturnPct: o.invert ? -value * 8 : value * 8,
    },
  };
}

`,
    'factor attribution fixture outcome-window contract',
  );
  write('test/forecast-factor-attribution.test.js', source);

  source = read('test/forecast-factor-weight-governance.test.js');
  source = replaceRequired(
    source,
    `  const forecastAt = new Date(Date.UTC(2025, 0, 1 + index)).toISOString();
  return {`,
    `  const forecastAt = new Date(Date.UTC(2025, 0, 1 + index)).toISOString();
  const tradingDays = Number(options.tradingDays || 21);
  const outcomeAt = new Date(new Date(forecastAt).getTime() + tradingDays * 86_400_000).toISOString();
  return {`,
    'governance fixture outcome-window timestamps',
  );
  source = replaceRequired(
    source,
    `    forecastSampleDate: forecastAt.slice(0, 10),
    status: 'MATURED',`,
    `    forecastSampleDate: forecastAt.slice(0, 10),
    tradingDays,
    referencePrice: { timestamp: forecastAt },
    status: 'MATURED',`,
    'governance fixture outcome-window metadata',
  );
  source = replaceRequired(
    source,
    `    realisedOutcome: {
      realisedReturnPct: options.realisedReturnPct ?? (invert ? -value * 10 : value * 10),
    },`,
    `    realisedOutcome: {
      timestamp: outcomeAt,
      realisedReturnPct: options.realisedReturnPct ?? (invert ? -value * 10 : value * 10),
    },`,
    'governance fixture realised outcome timestamp',
  );
  write('test/forecast-factor-weight-governance.test.js', source);

  source = read('test/forecast-factor-production-safety.test.js');
  source = replaceRequired(
    source,
    `  const forecastAt = new Date(Date.UTC(2025, 0, 1 + index)).toISOString();
  return {`,
    `  const forecastAt = new Date(Date.UTC(2025, 0, 1 + index)).toISOString();
  const tradingDays = 21;
  const outcomeAt = new Date(new Date(forecastAt).getTime() + tradingDays * 86_400_000).toISOString();
  return {`,
    'production safety fixture outcome-window timestamps',
  );
  source = replaceRequired(
    source,
    `    forecastSampleDate: forecastAt.slice(0, 10),
    status: 'MATURED',`,
    `    forecastSampleDate: forecastAt.slice(0, 10),
    tradingDays,
    referencePrice: { timestamp: forecastAt },
    status: 'MATURED',`,
    'production safety fixture outcome-window metadata',
  );
  source = replaceRequired(
    source,
    `    realisedOutcome: { realisedReturnPct: value * 10 },`,
    `    realisedOutcome: { timestamp: outcomeAt, realisedReturnPct: value * 10 },`,
    'production safety fixture realised outcome timestamp',
  );
  write('test/forecast-factor-production-safety.test.js', source);

  source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.equal(manifest.testPatches.at(-1), 'apply-v1809-oos-sample-independence.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1809-oos-sample-independence.js');
  assert.equal(new Set(manifest.testPatches).size, 58);
  assert.equal(new Set(manifest.buildPatches).size, 57);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1809-oos-sample-independence.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1809-oos-sample-independence.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1810-oos-outcome-window-independence.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1810-oos-outcome-window-independence.js');
  assert.equal(new Set(manifest.testPatches).size, 59);
  assert.equal(new Set(manifest.buildPatches).size, 58);`,
    'v1810 manifest assertions',
  );
  write('test/v180-factor-production-observability-runtime.test.js', source);
}

patchFactorLearning();
patchFactorAttribution();
patchFactorGovernance();
patchProductionVerifier();
patchLegacyFixtures();
console.log('Investor Control v1.8.0 horizon-aware OOS outcome-window independence gate applied.');