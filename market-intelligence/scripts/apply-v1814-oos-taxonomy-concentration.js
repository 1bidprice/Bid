import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 taxonomy-concentration patch failed: missing ${label}`);
  return source.replace(from, to);
}

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  if (source.includes(replacement)) return source;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Investor Control v1.8 taxonomy-concentration patch failed: missing ${label}`);
  }
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function patchFactorLearning() {
  let source = read('src/forecast-factor-learning-status.js');
  source = replaceRequired(
    source,
    "import { evaluateOosInstrumentConcentration } from './forecast-oos-instrument-concentration.js';",
    "import { evaluateOosInstrumentConcentration } from './forecast-oos-instrument-concentration.js';\nimport { evaluateOosTaxonomyConcentration } from './forecast-oos-taxonomy-concentration.js';",
    'factor learning taxonomy import',
  );
  source = replaceRequired(
    source,
    "export const FORECAST_FACTOR_LEARNING_STATUS_VERSION = '2026-08-11.5';",
    "export const FORECAST_FACTOR_LEARNING_STATUS_VERSION = '2026-08-12.1';",
    'factor learning taxonomy version',
  );
  source = replaceRequired(
    source,
    `  const instrumentConcentration = evaluateOosInstrumentConcentration(maturedScored, {
    maximumSingleInstrumentSharePct: options.factorMaximumSingleInstrumentSharePct ?? 25,
    minimumEffectiveInstrumentCount: options.factorMinimumEffectiveInstrumentCount ?? 6,
  });

  const rocAuc = auc(maturedScored);`,
    `  const instrumentConcentration = evaluateOosInstrumentConcentration(maturedScored, {
    maximumSingleInstrumentSharePct: options.factorMaximumSingleInstrumentSharePct ?? 25,
    minimumEffectiveInstrumentCount: options.factorMinimumEffectiveInstrumentCount ?? 6,
  });
  const taxonomyConcentration = evaluateOosTaxonomyConcentration(maturedScored, {
    minimumClassificationCoveragePct: options.factorMinimumClassificationCoveragePct ?? 80,
    materialTaxonomyMinimumSharePct: options.factorMaterialTaxonomyMinimumSharePct ?? 15,
    materialTaxonomyMinimumRecordCount: options.factorMaterialTaxonomyMinimumRecordCount ?? 30,
    maximumSingleNativeClusterSharePct: options.factorMaximumSingleNativeClusterSharePct ?? 40,
    minimumEffectiveNativeClusterCount: options.factorMinimumEffectiveNativeClusterCount ?? 3,
  });

  const rocAuc = auc(maturedScored);`,
    'factor learning taxonomy evaluation',
  );
  source = replaceRequired(
    source,
    `  blockers.push(...instrumentConcentration.blockers);`,
    `  blockers.push(...instrumentConcentration.blockers);
  blockers.push(...taxonomyConcentration.blockers);`,
    'factor learning taxonomy blockers',
  );
  source = replaceRequired(
    source,
    `    instrumentConcentration,
    discrimination: {`,
    `    instrumentConcentration,
    taxonomyConcentration,
    discrimination: {`,
    'factor learning taxonomy output',
  );
  write('src/forecast-factor-learning-status.js', source);
}

function patchFactorAttribution() {
  let source = read('src/forecast-factor-attribution.js');
  source = replaceRequired(
    source,
    "import { evaluateOosInstrumentConcentration } from './forecast-oos-instrument-concentration.js';",
    "import { evaluateOosInstrumentConcentration } from './forecast-oos-instrument-concentration.js';\nimport { evaluateOosTaxonomyConcentration } from './forecast-oos-taxonomy-concentration.js';",
    'factor attribution taxonomy import',
  );
  source = replaceRequired(
    source,
    "export const FORECAST_FACTOR_ATTRIBUTION_VERSION = '2026-08-11.5';",
    "export const FORECAST_FACTOR_ATTRIBUTION_VERSION = '2026-08-12.1';",
    'factor attribution taxonomy version',
  );
  source = replaceRequired(
    source,
    `    listing: record?.listing || null,
  };`,
    `    listing: record?.listing || null,
    classificationSnapshot: record?.classificationSnapshot || null,
  };`,
    'factor attribution classification snapshot observation',
  );
  source = replaceRequired(
    source,
    `  const instrumentConcentration = evaluateOosInstrumentConcentration(matured, {
    maximumSingleInstrumentSharePct: options.factorAttributionMaximumSingleInstrumentSharePct ?? 25,
    minimumEffectiveInstrumentCount: options.factorAttributionMinimumEffectiveInstrumentCount ?? 6,
  });
  const blockers = [...sampleIndependence.blockers, ...outcomeWindowIndependence.blockers, ...instrumentConcentration.blockers];`,
    `  const instrumentConcentration = evaluateOosInstrumentConcentration(matured, {
    maximumSingleInstrumentSharePct: options.factorAttributionMaximumSingleInstrumentSharePct ?? 25,
    minimumEffectiveInstrumentCount: options.factorAttributionMinimumEffectiveInstrumentCount ?? 6,
  });
  const taxonomyConcentration = evaluateOosTaxonomyConcentration(matured, {
    minimumClassificationCoveragePct: options.factorAttributionMinimumClassificationCoveragePct ?? 80,
    materialTaxonomyMinimumSharePct: options.factorAttributionMaterialTaxonomyMinimumSharePct ?? 15,
    materialTaxonomyMinimumRecordCount: options.factorAttributionMaterialTaxonomyMinimumRecordCount ?? 30,
    maximumSingleNativeClusterSharePct: options.factorAttributionMaximumSingleNativeClusterSharePct ?? 40,
    minimumEffectiveNativeClusterCount: options.factorAttributionMinimumEffectiveNativeClusterCount ?? 3,
  });
  const blockers = [...sampleIndependence.blockers, ...outcomeWindowIndependence.blockers, ...instrumentConcentration.blockers, ...taxonomyConcentration.blockers];`,
    'factor attribution taxonomy gate',
  );
  source = replaceRequired(
    source,
    `    instrumentConcentration,
    blockers: [...new Set(blockers)],`,
    `    instrumentConcentration,
    taxonomyConcentration,
    blockers: [...new Set(blockers)],`,
    'factor attribution taxonomy output',
  );
  write('src/forecast-factor-attribution.js', source);
}

function patchFactorGovernance() {
  let source = read('src/forecast-factor-weight-governance.js');
  source = replaceRequired(
    source,
    "import { evaluateOosInstrumentConcentration } from './forecast-oos-instrument-concentration.js';",
    "import { evaluateOosInstrumentConcentration } from './forecast-oos-instrument-concentration.js';\nimport { evaluateOosTaxonomyConcentration } from './forecast-oos-taxonomy-concentration.js';",
    'governance taxonomy import',
  );
  source = replaceRequired(
    source,
    "export const FORECAST_FACTOR_WEIGHT_GOVERNANCE_VERSION = '2026-08-11.4';",
    "export const FORECAST_FACTOR_WEIGHT_GOVERNANCE_VERSION = '2026-08-12.1';",
    'governance taxonomy version',
  );
  source = replaceRequired(
    source,
    `    listing: record.listing || null,
    status: record.status || null,`,
    `    listing: record.listing || null,
    classificationSnapshot: record.classificationSnapshot || null,
    status: record.status || null,`,
    'governance classification snapshot observation',
  );
  source = replaceRequired(
    source,
    `  const instrumentConcentration = evaluateOosInstrumentConcentration(matured, {
    maximumSingleInstrumentSharePct: options.weightGovernanceMaximumSingleInstrumentSharePct ?? 20,
    minimumEffectiveInstrumentCount: options.weightGovernanceMinimumEffectiveInstrumentCount ?? 8,
  });
  const blockers = [...sampleIndependence.blockers, ...outcomeWindowIndependence.blockers, ...instrumentConcentration.blockers];`,
    `  const instrumentConcentration = evaluateOosInstrumentConcentration(matured, {
    maximumSingleInstrumentSharePct: options.weightGovernanceMaximumSingleInstrumentSharePct ?? 20,
    minimumEffectiveInstrumentCount: options.weightGovernanceMinimumEffectiveInstrumentCount ?? 8,
  });
  const taxonomyConcentration = evaluateOosTaxonomyConcentration(matured, {
    minimumClassificationCoveragePct: options.weightGovernanceMinimumClassificationCoveragePct ?? 90,
    materialTaxonomyMinimumSharePct: options.weightGovernanceMaterialTaxonomyMinimumSharePct ?? 15,
    materialTaxonomyMinimumRecordCount: options.weightGovernanceMaterialTaxonomyMinimumRecordCount ?? 50,
    maximumSingleNativeClusterSharePct: options.weightGovernanceMaximumSingleNativeClusterSharePct ?? 30,
    minimumEffectiveNativeClusterCount: options.weightGovernanceMinimumEffectiveNativeClusterCount ?? 4,
  });
  const blockers = [...sampleIndependence.blockers, ...outcomeWindowIndependence.blockers, ...instrumentConcentration.blockers, ...taxonomyConcentration.blockers];`,
    'governance taxonomy gate',
  );
  source = replaceRequired(
    source,
    `    instrumentConcentration,
    upstreamAttributionStatus:`,
    `    instrumentConcentration,
    taxonomyConcentration,
    upstreamAttributionStatus:`,
    'governance taxonomy output',
  );
  source = replaceRequired(
    source,
    `      instrumentConcentration: evaluation.instrumentConcentration,
    },`,
    `      instrumentConcentration: evaluation.instrumentConcentration,
      taxonomyConcentration: evaluation.taxonomyConcentration,
    },`,
    'governance proposal taxonomy evidence',
  );
  source = replaceRequired(
    source,
    `      'OOS_INSTRUMENT_CONCENTRATION_GATE_PASSED',
      'MANUAL_REVIEW_ONLY_NO_AUTOMATIC_APPLICATION',`,
    `      'OOS_INSTRUMENT_CONCENTRATION_GATE_PASSED',
      'OOS_TAXONOMY_NATIVE_CONCENTRATION_GATE_PASSED',
      'MANUAL_REVIEW_ONLY_NO_AUTOMATIC_APPLICATION',`,
    'governance taxonomy rationale',
  );
  write('src/forecast-factor-weight-governance.js', source);
}

function patchProductionVerifier() {
  let source = read('src/forecast-factor-production-safety.js');
  source = replaceRequired(
    source,
    `  const windows = proposal?.evidence?.outcomeWindowIndependence;
  assert(windows?.contract === 'OOS_OUTCOME_WINDOW_INDEPENDENCE_V1', prefix + ' outcome-window independence contract missing');`,
    `  const taxonomy = proposal?.evidence?.taxonomyConcentration;
  assert(taxonomy?.contract === 'OOS_TAXONOMY_NATIVE_CONCENTRATION_V1', prefix + ' taxonomy-concentration contract missing');
  assert(taxonomy?.status === 'TAXONOMY_DIVERSIFICATION_READY', prefix + ' taxonomy diversification not ready');
  assert(taxonomy.crossTaxonomyMappingUsed === false, prefix + ' cross-taxonomy mapping is forbidden');
  assert(taxonomy.inferenceUsed === false, prefix + ' taxonomy inference is forbidden');
  assert(taxonomy.decisionImpact === 'NONE', prefix + ' taxonomy evidence cannot have decision impact');
  assert(nonNegativeInteger(taxonomy.invalidClassificationSnapshotCount) === 0, prefix + ' has invalid classification snapshots');
  assert(nonNegativeInteger(taxonomy.nativeClusterMissingCount) === 0, prefix + ' has missing native taxonomy clusters');
  const classificationCoverageThreshold = finiteNumber(taxonomy?.thresholds?.minimumClassificationCoveragePct);
  assert(classificationCoverageThreshold !== null && classificationCoverageThreshold >= 90, prefix + ' classification coverage threshold too weak');
  const actualClassificationCoverage = finiteNumber(taxonomy.classificationCoveragePct);
  assert(actualClassificationCoverage !== null && actualClassificationCoverage >= classificationCoverageThreshold, prefix + ' classification coverage too low');
  const materialShareThreshold = finiteNumber(taxonomy?.thresholds?.materialTaxonomyMinimumSharePct);
  assert(materialShareThreshold !== null && materialShareThreshold <= 15, prefix + ' material-taxonomy share threshold too weak');
  const materialRecordThreshold = nonNegativeInteger(taxonomy?.thresholds?.materialTaxonomyMinimumRecordCount);
  assert(materialRecordThreshold !== null && materialRecordThreshold > 0 && materialRecordThreshold <= 50, prefix + ' material-taxonomy record threshold too weak');
  const maximumClusterShareThreshold = finiteNumber(taxonomy?.thresholds?.maximumSingleNativeClusterSharePct);
  assert(maximumClusterShareThreshold !== null && maximumClusterShareThreshold <= 30, prefix + ' native-cluster concentration threshold too weak');
  const minimumEffectiveClusterCount = finiteNumber(taxonomy?.thresholds?.minimumEffectiveNativeClusterCount);
  assert(minimumEffectiveClusterCount !== null && minimumEffectiveClusterCount >= 4, prefix + ' effective native-cluster threshold too weak');
  assert(nonNegativeInteger(taxonomy.materialTaxonomyCount) !== null && taxonomy.materialTaxonomyCount >= 1, prefix + ' material taxonomy evidence missing');
  const taxonomyItems = Array.isArray(taxonomy.taxonomies) ? taxonomy.taxonomies : [];
  for (const item of taxonomyItems.filter((entry) => entry?.material === true)) {
    assert(item.taxonomy === 'SEC_SIC' || item.taxonomy === 'FTSE_RUSSELL_ICB', prefix + ' unsupported native taxonomy');
    assert(item.status === 'TAXONOMY_DIVERSIFICATION_READY', prefix + ' material taxonomy diversification not ready');
    assert(nonNegativeInteger(item.recordCount) !== null && item.recordCount >= materialRecordThreshold, prefix + ' material taxonomy sample too small');
    const clusterShare = finiteNumber(item.maximumSingleNativeClusterSharePct);
    assert(clusterShare !== null && clusterShare <= maximumClusterShareThreshold, prefix + ' native-cluster concentration exceeds threshold');
    const effectiveClusters = finiteNumber(item.effectiveNativeClusterCount);
    assert(effectiveClusters !== null && effectiveClusters >= minimumEffectiveClusterCount, prefix + ' effective native-cluster count too small');
  }

  const windows = proposal?.evidence?.outcomeWindowIndependence;
  assert(windows?.contract === 'OOS_OUTCOME_WINDOW_INDEPENDENCE_V1', prefix + ' outcome-window independence contract missing');`,
    'production taxonomy-concentration verification',
  );
  write('src/forecast-factor-production-safety.js', source);
}

const CLASSIFICATION_HELPER = `function classificationSnapshot(index, companyId, instrumentId, forecastAt) {
  const majorGroups = ['10', '20', '30', '40', '50', '60'];
  const code = majorGroups[index % majorGroups.length] + '00';
  const cik = String((index % 20) + 1).padStart(10, '0');
  return {
    contract: 'FORECAST_TIME_CLASSIFICATION_SNAPSHOT_V1',
    policyVersion: '2026-08-11.1',
    companyId,
    instrumentId,
    sourceAuthority: 'SEC_EDGAR_SUBMISSIONS',
    sourceUrl: 'https://data.sec.gov/submissions/CIK' + cik + '.json',
    sourceDocumentId: 'CIK' + cik,
    capturedAt: forecastAt,
    taxonomy: 'SEC_SIC',
    code,
    description: 'Synthetic SIC ' + code,
    inferenceUsed: false,
    decisionImpact: 'NONE',
  };
}

`;

function patchLegacyStatisticalFixtures() {
  let source = read('test/forecast-factor-learning-status.test.js');
  const learningFixture = `function factorRecord(index, options = {}) {
  const score = options.score ?? SCORE_LEVELS[index % SCORE_LEVELS.length];
  const positive = options.invert ? score < 0 : score > 0;
  const outcome = options.outcome ?? (positive ? 1 : 0);
  const realisedReturnPct = options.realisedReturnPct ?? (options.invert ? -score * 10 : score * 10);
  const forecastAt = new Date(Date.UTC(2000, 0, 1) + index * 30 * 86_400_000).toISOString();
  const tradingDays = Number(options.tradingDays || 21);
  const outcomeAt = new Date(new Date(forecastAt).getTime() + tradingDays * 86_400_000).toISOString();
  const companyId = options.companyId || 'company:' + (index % 20);
  const instrumentId = options.instrumentId || 'instrument:' + (index % 20);
  return {
    forecastId: 'factor:' + (options.version || 'factor-v1') + ':' + (options.horizon || 'month1') + ':' + index,
    companyId,
    instrumentId,
    classificationSnapshot: classificationSnapshot(index, companyId, instrumentId, forecastAt),
    validationMode: options.validationMode || 'LIVE_SHADOW_OOS',
    factorScorePolicyVersion: options.noLineage ? null : options.version || 'factor-v1',
    factorScoreStatus: options.factorScoreStatus || 'LATENT_SCORE_READY',
    latentFactorScore: options.noScore ? null : score,
    rawLatentFactorScore: options.noScore ? null : score,
    assetClass: options.assetClass || 'EQUITY',
    horizon: options.horizon || 'month1',
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    tradingDays,
    referencePrice: { timestamp: forecastAt },
    status: options.open ? 'OPEN' : 'MATURED',
    positiveOutcome: options.open ? null : outcome,
    realisedOutcome: options.open ? null : { timestamp: outcomeAt, realisedReturnPct },
  };
}

`;
  if (!source.includes('function classificationSnapshot(')) {
    source = replaceRequired(source, 'const SCORE_LEVELS = [-0.9, -0.7, -0.5, -0.3, -0.1, 0.1, 0.3, 0.5, 0.7, 0.9];\n\n', `const SCORE_LEVELS = [-0.9, -0.7, -0.5, -0.3, -0.1, 0.1, 0.3, 0.5, 0.7, 0.9];\n\n${CLASSIFICATION_HELPER}`, 'factor learning classification helper');
  }
  source = replaceBetween(source, 'function factorRecord(index, options = {}) {', 'function deepKeys', learningFixture, 'factor learning classified fixture');
  write('test/forecast-factor-learning-status.test.js', source);

  source = read('test/forecast-factor-attribution.test.js');
  const attributionPrefix = `const LEVELS = [-.9, -.6, -.3, .1, .4, .8];
${CLASSIFICATION_HELPER}function rec(i, o = {}) {
  const value = o.value ?? LEVELS[i % LEVELS.length];
  const positive = o.invert ? value < 0 : value > 0;
  const at = new Date(Date.UTC(2000, 0, 1) + i * 30 * 86_400_000).toISOString();
  const tradingDays = Number(o.tradingDays || 21);
  const outcomeAt = new Date(new Date(at).getTime() + tradingDays * 86_400_000).toISOString();
  const companyId = 'company:' + (i % 20);
  const instrumentId = 'instrument:' + (i % 20);
  return {
    forecastId: 'attr:' + (o.vectorVersion || 'fv-v1') + ':' + i,
    validationMode: 'LIVE_SHADOW_OOS',
    companyId,
    instrumentId,
    classificationSnapshot: classificationSnapshot(i, companyId, instrumentId, at),
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
    realisedOutcome: o.open ? null : { timestamp: outcomeAt, realisedReturnPct: o.invert ? -value * 8 : value * 8 },
  };
}

`;
  source = replaceBetween(source, source.includes('const LEVELS = [-.9, -.6, -.3, .1, .4, .8];') ? 'const LEVELS = [-.9, -.6, -.3, .1, .4, .8];' : 'const LEVELS=[-.9,-.6,-.3,.1,.4,.8];', "test('new record persists compact factor-domain snapshot'", attributionPrefix, 'factor attribution classified fixture');
  write('test/forecast-factor-attribution.test.js', source);

  source = read('test/forecast-factor-weight-governance.test.js');
  const governanceFixture = `function record(index, options = {}) {
  const domain = options.domain || 'MOMENTUM';
  const value = options.value ?? LEVELS[index % LEVELS.length];
  const invert = options.invert === true;
  const positive = invert ? value < 0 : value > 0;
  const forecastAt = new Date(Date.UTC(2000, 0, 1) + index * 30 * 86_400_000).toISOString();
  const tradingDays = Number(options.tradingDays || 21);
  const outcomeAt = new Date(new Date(forecastAt).getTime() + tradingDays * 86_400_000).toISOString();
  const companyId = options.companyId || 'company:' + (index % 20);
  const instrumentId = options.instrumentId || 'instrument:' + (index % 20);
  return {
    forecastId: 'gov:' + domain + ':' + index + ':' + (options.vectorVersion || 'current'),
    companyId,
    instrumentId,
    classificationSnapshot: classificationSnapshot(index, companyId, instrumentId, forecastAt),
    validationMode: 'LIVE_SHADOW_OOS',
    factorFeatureVectorPolicyVersion: options.vectorVersion || FORECAST_FEATURE_VECTOR_VERSION,
    factorScorePolicyVersion: options.scoreVersion || FORECAST_FACTOR_SCORE_VERSION,
    factorDomainSnapshot: [{ domain, value, weight: FORECAST_FACTOR_DOMAIN_WEIGHTS[domain], verifiedDriverCount: 1 }],
    assetClass: options.assetClass || 'EQUITY',
    horizon: options.horizon || 'month1',
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    tradingDays,
    referencePrice: { timestamp: forecastAt },
    status: 'MATURED',
    positiveOutcome: options.outcome ?? (positive ? 1 : 0),
    realisedOutcome: { timestamp: outcomeAt, realisedReturnPct: options.realisedReturnPct ?? (invert ? -value * 10 : value * 10) },
  };
}

`;
  if (!source.includes('function classificationSnapshot(')) {
    source = replaceRequired(source, 'const LEVELS = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];\n\n', `const LEVELS = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];\n\n${CLASSIFICATION_HELPER}`, 'governance classification helper');
  }
  source = replaceBetween(source, 'function record(index, options = {}) {', 'function attributionStatus', governanceFixture, 'governance classified fixture');
  write('test/forecast-factor-weight-governance.test.js', source);

  source = read('test/forecast-factor-production-safety.test.js');
  const productionFixture = `function record(index) {
  const value = LEVELS[index % LEVELS.length];
  const positive = value > 0;
  const forecastAt = new Date(Date.UTC(2000, 0, 1) + index * 30 * 86_400_000).toISOString();
  const tradingDays = 21;
  const outcomeAt = new Date(new Date(forecastAt).getTime() + tradingDays * 86_400_000).toISOString();
  const companyId = 'company:' + (index % 20);
  const instrumentId = 'instrument:' + (index % 20);
  return {
    forecastId: 'prod-safe:' + index,
    companyId,
    instrumentId,
    classificationSnapshot: classificationSnapshot(index, companyId, instrumentId, forecastAt),
    validationMode: 'LIVE_SHADOW_OOS',
    factorFeatureVectorPolicyVersion: FORECAST_FEATURE_VECTOR_VERSION,
    factorScorePolicyVersion: FORECAST_FACTOR_SCORE_VERSION,
    factorDomainSnapshot: [{ domain: 'MOMENTUM', value, weight: FORECAST_FACTOR_DOMAIN_WEIGHTS.MOMENTUM, verifiedDriverCount: 1 }],
    assetClass: 'EQUITY',
    horizon: 'month1',
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    tradingDays,
    referencePrice: { timestamp: forecastAt },
    status: 'MATURED',
    positiveOutcome: positive ? 1 : 0,
    realisedOutcome: { timestamp: outcomeAt, realisedReturnPct: value * 10 },
  };
}

`;
  if (!source.includes('function classificationSnapshot(')) {
    source = replaceRequired(source, 'const LEVELS = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];\n\n', `const LEVELS = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];\n\n${CLASSIFICATION_HELPER}`, 'production safety classification helper');
  }
  source = replaceBetween(source, 'function record(index) {', 'function learningStatus', productionFixture, 'production safety classified fixture');
  const taxonomyAdversarialTest = `\ntest('production factor safety rejects weakened or cross-mapped taxonomy evidence', () => {
  const weak = clone(makeReport({ withProposal: true }));
  weak.forecastFactorWeightGovernanceStatus.proposals[0].evidence.taxonomyConcentration.thresholds.minimumClassificationCoveragePct = 50;
  assert.throws(() => verifyForecastFactorProductionSafety(weak), /classification coverage threshold too weak/);

  const mapped = clone(makeReport({ withProposal: true }));
  mapped.forecastFactorWeightGovernanceStatus.proposals[0].evidence.taxonomyConcentration.crossTaxonomyMappingUsed = true;
  assert.throws(() => verifyForecastFactorProductionSafety(mapped), /cross-taxonomy mapping is forbidden/);
});
`;
  if (!source.includes("production factor safety rejects weakened or cross-mapped taxonomy evidence")) source += taxonomyAdversarialTest;
  write('test/forecast-factor-production-safety.test.js', source);
}

function patchManifestAssertions() {
  let source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.ok(manifest.testPatches.includes('apply-v1812-forecast-classification-lineage.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1812-forecast-classification-lineage.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1813-athens-icb-classification-lineage.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1813-athens-icb-classification-lineage.js');
  assert.equal(new Set(manifest.testPatches).size, 62);
  assert.equal(new Set(manifest.buildPatches).size, 61);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1813-athens-icb-classification-lineage.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1813-athens-icb-classification-lineage.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1814-oos-taxonomy-concentration.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1814-oos-taxonomy-concentration.js');
  assert.equal(new Set(manifest.testPatches).size, 63);
  assert.equal(new Set(manifest.buildPatches).size, 62);`,
    'v1814 manifest assertions',
  );
  write('test/v180-factor-production-observability-runtime.test.js', source);
}

patchFactorLearning();
patchFactorAttribution();
patchFactorGovernance();
patchProductionVerifier();
patchLegacyStatisticalFixtures();
patchManifestAssertions();
console.log('Investor Control v1.8.0 taxonomy-native OOS concentration gate applied.');
