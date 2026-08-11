import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 OOS independence patch failed: missing ${label}`);
  return source.replace(from, to);
}

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  if (source.includes(replacement)) return source;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Investor Control v1.8 OOS independence patch failed: missing ${label}`);
  }
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function patchFactorLearning() {
  let source = read('src/forecast-factor-learning-status.js');
  source = replaceRequired(
    source,
    "export const FORECAST_FACTOR_LEARNING_STATUS_VERSION = '2026-08-11.2';",
    "import { evaluateOosSampleIndependence, splitChronologicalDateBlocks } from './forecast-oos-sample-independence.js';\n\nexport const FORECAST_FACTOR_LEARNING_STATUS_VERSION = '2026-08-11.3';",
    'factor learning independence import/version',
  );
  source = replaceBetween(
    source,
    'function splitContiguous(records, blockCount) {',
    'export function evaluateFactorScoreTemporalStability',
    `function splitContiguous(records, blockCount) {
  return splitChronologicalDateBlocks(records, blockCount);
}

`,
    'date-preserving factor stability blocks',
  );
  source = replaceRequired(
    source,
    `  const maximumMonotonicInversions = Math.max(0, Number(options.factorMaximumMonotonicInversions ?? 1));

  const rocAuc = auc(maturedScored);`,
    `  const maximumMonotonicInversions = Math.max(0, Number(options.factorMaximumMonotonicInversions ?? 1));
  const sampleIndependence = evaluateOosSampleIndependence(maturedScored, {
    minimumDistinctForecastDates: options.factorMinimumDistinctForecastDates ?? 40,
    minimumDistinctInstruments: options.factorMinimumDistinctInstruments ?? 10,
    maximumSingleForecastDateSharePct: options.factorMaximumSingleForecastDateSharePct ?? 10,
  });

  const rocAuc = auc(maturedScored);`,
    'factor learning sample independence evaluation',
  );
  source = replaceRequired(
    source,
    `  const blockers = [];
  if (maturedScored.length < minimumMaturedSample) blockers.push('FACTOR_MATURED_OOS_SAMPLE_TOO_SMALL');`,
    `  const blockers = [];
  blockers.push(...sampleIndependence.blockers);
  if (maturedScored.length < minimumMaturedSample) blockers.push('FACTOR_MATURED_OOS_SAMPLE_TOO_SMALL');`,
    'factor learning independence blockers',
  );
  source = replaceRequired(
    source,
    `    sampleProgressPct: round(Math.min(1, maturedScored.length / minimumMaturedSample) * 100, 2),
    discrimination: {`,
    `    sampleProgressPct: round(Math.min(1, maturedScored.length / minimumMaturedSample) * 100, 2),
    sampleIndependence,
    discrimination: {`,
    'factor learning independence output',
  );
  write('src/forecast-factor-learning-status.js', source);
}

function patchFactorAttribution() {
  let source = read('src/forecast-factor-attribution.js');
  source = replaceRequired(
    source,
    "export const FORECAST_FACTOR_ATTRIBUTION_VERSION = '2026-08-11.2';",
    "import { evaluateOosSampleIndependence } from './forecast-oos-sample-independence.js';\n\nexport const FORECAST_FACTOR_ATTRIBUTION_VERSION = '2026-08-11.3';",
    'factor attribution independence import/version',
  );
  source = replaceBetween(
    source,
    'function domainObservation(record,domain)',
    'function rocAuc',
    `function domainObservation(record, domain) {
  const feature = (record.factorDomainSnapshot || []).find((item) => item?.domain === domain);
  const value = finite(feature?.value);
  if (value === null || value < -1 || value > 1) return null;
  const matured = record?.status === 'MATURED';
  return {
    value,
    weight: finite(feature?.weight),
    outcome: matured && binaryOutcome(record?.positiveOutcome) ? record.positiveOutcome : null,
    realisedReturnPct: matured ? finite(record?.realisedOutcome?.realisedReturnPct) : null,
    forecastAt: record?.forecastAt || null,
    forecastSampleDate: record?.forecastSampleDate || null,
    instrumentId: record?.instrumentId || null,
    companyId: record?.companyId || null,
    symbol: record?.symbol || null,
    listing: record?.listing || null,
  };
}

`,
    'factor attribution domain observation identity',
  );
  source = replaceBetween(
    source,
    'function evaluateDomain(records,domain,options={})',
    'function evaluateGroup',
    `function evaluateDomain(records, domain, options = {}) {
  const observations = records.map((record) => domainObservation(record, domain)).filter(Boolean);
  const matured = observations.filter((item) => binaryOutcome(item.outcome));
  const positiveCount = matured.filter((item) => item.outcome === 1).length;
  const negativeCount = matured.length - positiveCount;
  const minSample = Math.max(40, Number(options.factorAttributionMinimumMaturedSample || 100));
  const minClass = Math.max(10, Number(options.factorAttributionMinimumClassCount || 20));
  const minCoverage = Math.max(0, Math.min(100, Number(options.factorAttributionMinimumCoveragePct || 60)));
  const supportAuc = Number(options.factorAttributionSupportAuc ?? 0.53);
  const inversionAuc = Number(options.factorAttributionInversionAuc ?? 0.47);
  const strongAuc = Number(options.factorAttributionStrongReviewAuc ?? 0.58);
  const weakAuc = Number(options.factorAttributionWeakReviewAuc ?? 0.42);
  const coverage = records.length ? observations.length / records.length * 100 : 0;
  const auc = rocAuc(matured);
  const spread = tailSpread(matured, options.factorAttributionTailFraction || 0.25);
  const sampleIndependence = evaluateOosSampleIndependence(matured, {
    minimumDistinctForecastDates: options.factorAttributionMinimumDistinctForecastDates ?? 40,
    minimumDistinctInstruments: options.factorAttributionMinimumDistinctInstruments ?? 10,
    maximumSingleForecastDateSharePct: options.factorAttributionMaximumSingleForecastDateSharePct ?? 10,
  });
  const blockers = [...sampleIndependence.blockers];
  if (matured.length < minSample) blockers.push('DOMAIN_MATURED_OOS_SAMPLE_TOO_SMALL');
  if (positiveCount < minClass) blockers.push('DOMAIN_POSITIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (negativeCount < minClass) blockers.push('DOMAIN_NEGATIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (coverage < minCoverage) blockers.push('DOMAIN_FEATURE_COVERAGE_TOO_LOW');

  let status = 'INSUFFICIENT_OOS_HISTORY';
  if (!blockers.length) {
    if (Number.isFinite(auc) && auc >= supportAuc && Number(spread.positiveRateSpread) > 0 && Number(spread.realisedReturnSpreadPct) > 0) {
      status = 'PREDICTIVE_DIRECTION_SUPPORTED';
    } else if ((Number.isFinite(auc) && auc <= inversionAuc) || Number(spread.positiveRateSpread) < 0 || Number(spread.realisedReturnSpreadPct) < 0) {
      status = 'INVERTED_OR_NONPREDICTIVE';
    } else {
      status = 'INCONCLUSIVE';
    }
  }

  const manualWeightReviewCandidate = !blockers.length && matured.length >= 200 && (
    (Number.isFinite(auc) && auc >= strongAuc && Number(spread.positiveRateSpread) > 0 && Number(spread.realisedReturnSpreadPct) > 0) ||
    (Number.isFinite(auc) && auc <= weakAuc)
  );

  return {
    domain,
    status,
    lineageCoverageCount: observations.length,
    lineageCoveragePct: round(coverage, 2),
    maturedSampleSize: matured.length,
    positiveCount,
    negativeCount,
    rocAuc: round(auc, 4),
    topBottom: spread,
    averageConfiguredWeight: round(mean(observations.map((item) => item.weight)), 4),
    sampleIndependence,
    blockers: [...new Set(blockers)],
    manualWeightReviewCandidate,
    automaticWeightAdjustmentEnabled: false,
  };
}

`,
    'factor attribution independence gate',
  );
  write('src/forecast-factor-attribution.js', source);
}

function patchFactorGovernance() {
  let source = read('src/forecast-factor-weight-governance.js');
  source = replaceRequired(
    source,
    "import { contentHash } from './content-hash.js';",
    "import { contentHash } from './content-hash.js';\nimport { evaluateOosSampleIndependence, splitChronologicalDateBlocks } from './forecast-oos-sample-independence.js';",
    'governance independence import',
  );
  source = replaceRequired(
    source,
    "export const FORECAST_FACTOR_WEIGHT_GOVERNANCE_VERSION = '2026-08-11.1';",
    "export const FORECAST_FACTOR_WEIGHT_GOVERNANCE_VERSION = '2026-08-11.2';",
    'governance policy version',
  );
  source = replaceBetween(
    source,
    'function domainSnapshot(record, domain) {',
    'function rocAuc',
    `function domainSnapshot(record, domain) {
  const snapshot = (record?.factorDomainSnapshot || []).find((item) => item?.domain === domain);
  const value = number(snapshot?.value);
  const weight = number(snapshot?.weight);
  if (value === null || value < -1 || value > 1 || weight === null || weight <= 0) return null;
  return {
    forecastId: record.forecastId || null,
    forecastAt: record.forecastAt || null,
    forecastSampleDate: record.forecastSampleDate || null,
    instrumentId: record.instrumentId || null,
    companyId: record.companyId || null,
    symbol: record.symbol || null,
    listing: record.listing || null,
    status: record.status || null,
    value,
    configuredWeight: weight,
    outcome: record.status === 'MATURED' && binaryOutcome(record.positiveOutcome) ? record.positiveOutcome : null,
    realisedReturnPct: record.status === 'MATURED' ? number(record?.realisedOutcome?.realisedReturnPct) : null,
    invalidMaturedOutcome: record.status === 'MATURED' && !binaryOutcome(record.positiveOutcome),
  };
}

`,
    'governance domain snapshot identity',
  );
  source = replaceBetween(
    source,
    'function contiguousBlocks(observations, count) {',
    'function temporalDirectionStatus',
    `function contiguousBlocks(observations, count) {
  return splitChronologicalDateBlocks(observations, count);
}

`,
    'date-preserving governance temporal blocks',
  );
  source = replaceBetween(
    source,
    'function evaluateDomain(input, records, group, domain, options = {}) {',
    'function buildProposal',
    `function evaluateDomain(input, records, group, domain, options = {}) {
  const observations = records.map((record) => domainSnapshot(record, domain)).filter(Boolean);
  const matured = observations.filter((item) => binaryOutcome(item.outcome));
  const positiveCount = matured.filter((item) => item.outcome === 1).length;
  const negativeCount = matured.length - positiveCount;
  const invalidMaturedOutcomeCount = observations.filter((item) => item.invalidMaturedOutcome).length;
  const coveragePct = records.length ? observations.length / records.length * 100 : 0;
  const auc = rocAuc(matured);
  const spread = tailSpread(matured, options.weightGovernanceTailFraction || 0.25);
  const upstream = attributionDomain(input, group, domain);
  const minimumMatured = Math.max(200, Number(options.weightGovernanceMinimumMaturedSample || 300));
  const minimumClassCount = Math.max(30, Number(options.weightGovernanceMinimumClassCount || 50));
  const minimumCoveragePct = Math.max(50, Math.min(100, Number(options.weightGovernanceMinimumCoveragePct || 70)));
  const increaseAuc = Number(options.weightGovernanceIncreaseAuc ?? 0.60);
  const decreaseAuc = Number(options.weightGovernanceDecreaseAuc ?? 0.40);
  const minimumSpread = Number(options.weightGovernanceMinimumPositiveRateSpread ?? 0.12);
  const sampleIndependence = evaluateOosSampleIndependence(matured, {
    minimumDistinctForecastDates: options.weightGovernanceMinimumDistinctForecastDates ?? 60,
    minimumDistinctInstruments: options.weightGovernanceMinimumDistinctInstruments ?? 10,
    maximumSingleForecastDateSharePct: options.weightGovernanceMaximumSingleForecastDateSharePct ?? 10,
  });
  const blockers = [...sampleIndependence.blockers];

  if (!upstream) blockers.push('CURRENT_UPSTREAM_ATTRIBUTION_REQUIRED');
  else if (upstream.manualWeightReviewCandidate !== true) blockers.push('UPSTREAM_ATTRIBUTION_MANUAL_REVIEW_GATE_NOT_READY');
  if (matured.length < minimumMatured) blockers.push('GOVERNANCE_MATURED_OOS_SAMPLE_TOO_SMALL');
  if (positiveCount < minimumClassCount) blockers.push('GOVERNANCE_POSITIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (negativeCount < minimumClassCount) blockers.push('GOVERNANCE_NEGATIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (coveragePct < minimumCoveragePct) blockers.push('GOVERNANCE_DOMAIN_COVERAGE_TOO_LOW');
  if (invalidMaturedOutcomeCount) blockers.push('INVALID_MATURED_BINARY_OUTCOME_RECORDS_EXCLUDED');

  let direction = null;
  if (Number.isFinite(auc) && auc >= increaseAuc && Number(spread.positiveRateSpread) >= minimumSpread && Number(spread.realisedReturnSpreadPct) > 0) {
    direction = 'INCREASE_REVIEW';
  } else if (Number.isFinite(auc) && auc <= decreaseAuc && Number(spread.positiveRateSpread) <= -minimumSpread && Number(spread.realisedReturnSpreadPct) < 0) {
    direction = 'DECREASE_REVIEW';
  } else {
    blockers.push('GOVERNANCE_FULL_PERIOD_SIGNAL_NOT_STRONG_ENOUGH');
  }
  if (direction === 'DECREASE_REVIEW' && domain === 'RISK') blockers.push('RISK_WEIGHT_DECREASE_PROHIBITED');

  const stability = direction ? temporalDirectionStatus(matured, direction, options) : {
    direction: null,
    status: 'NOT_EVALUATED',
    stableAcrossSubperiods: false,
    subperiods: [],
  };
  if (direction && stability.status !== 'STABILITY_READY') blockers.push('GOVERNANCE_DOMAIN_SIGNAL_NOT_TEMPORALLY_STABLE');

  const eligible = blockers.length === 0 && direction !== null;
  const weights = eligible ? proposedWeights(domain, direction, options.weightGovernanceProposalDelta || 0.02) : null;
  if (eligible && !weights) blockers.push('GOVERNANCE_WEIGHT_REBALANCE_FAILED');

  return {
    domain,
    status: eligible && weights ? 'MANUAL_WEIGHT_REVIEW_PROPOSAL_READY' : 'NO_PROPOSAL',
    currentWeight: CURRENT_WEIGHTS[domain],
    lineageCoverageCount: observations.length,
    lineageCoveragePct: round(coveragePct, 2),
    maturedSampleSize: matured.length,
    positiveCount,
    negativeCount,
    invalidMaturedOutcomeCount,
    rocAuc: round(auc, 4),
    topBottom: spread,
    sampleIndependence,
    upstreamAttributionStatus: upstream?.status || null,
    upstreamManualWeightReviewCandidate: upstream?.manualWeightReviewCandidate === true,
    proposedDirection: eligible && weights ? direction : null,
    temporalStability: stability,
    blockers: [...new Set(blockers)],
    proposalWeights: weights,
    automaticWeightAdjustmentEnabled: false,
    automaticProposalApplicationEnabled: false,
  };
}

`,
    'governance independence gate',
  );
  source = replaceRequired(
    source,
    `      temporalSubperiods: subperiods,
    },`,
    `      temporalSubperiods: subperiods,
      sampleIndependence: evaluation.sampleIndependence,
    },`,
    'governance proposal independence evidence',
  );
  source = replaceRequired(
    source,
    `      'CURRENT_MODEL_LINEAGE_ONLY',
      'MANUAL_REVIEW_ONLY_NO_AUTOMATIC_APPLICATION',`,
    `      'CURRENT_MODEL_LINEAGE_ONLY',
      'OOS_SAMPLE_INDEPENDENCE_GATE_PASSED',
      'MANUAL_REVIEW_ONLY_NO_AUTOMATIC_APPLICATION',`,
    'governance independence rationale',
  );
  write('src/forecast-factor-weight-governance.js', source);
}

function patchLegacyTestFixtures() {
  let source = read('test/forecast-factor-learning-status.test.js');
  source = replaceRequired(
    source,
    `    validationMode: options.validationMode || 'LIVE_SHADOW_OOS',`,
    `    companyId: options.companyId || \`company:\${index % 20}\`,
    instrumentId: options.instrumentId || \`instrument:\${index % 20}\`,
    validationMode: options.validationMode || 'LIVE_SHADOW_OOS',`,
    'factor learning fixture identities',
  );
  write('test/forecast-factor-learning-status.test.js', source);

  source = read('test/forecast-factor-attribution.test.js');
  source = replaceRequired(
    source,
    `validationMode:'LIVE_SHADOW_OOS',factorFeatureVectorPolicyVersion:`,
    `validationMode:'LIVE_SHADOW_OOS',companyId:\`company:\${i%20}\`,instrumentId:\`instrument:\${i%20}\`,factorFeatureVectorPolicyVersion:`,
    'factor attribution fixture identities',
  );
  write('test/forecast-factor-attribution.test.js', source);

  source = read('test/forecast-factor-weight-governance.test.js');
  source = replaceRequired(
    source,
    `    validationMode: 'LIVE_SHADOW_OOS',`,
    `    companyId: options.companyId || \`company:\${index % 20}\`,
    instrumentId: options.instrumentId || \`instrument:\${index % 20}\`,
    validationMode: 'LIVE_SHADOW_OOS',`,
    'governance fixture identities',
  );
  write('test/forecast-factor-weight-governance.test.js', source);

  source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.equal(manifest.testPatches.at(-1), 'apply-v1808-forecast-factor-production-observability.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1808-forecast-factor-production-observability.js');
  assert.equal(new Set(manifest.testPatches).size, 57);
  assert.equal(new Set(manifest.buildPatches).size, 56);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1808-forecast-factor-production-observability.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1808-forecast-factor-production-observability.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1809-oos-sample-independence.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1809-oos-sample-independence.js');
  assert.equal(new Set(manifest.testPatches).size, 58);
  assert.equal(new Set(manifest.buildPatches).size, 57);`,
    'v1809 manifest assertions',
  );
  write('test/v180-factor-production-observability-runtime.test.js', source);
}

patchFactorLearning();
patchFactorAttribution();
patchFactorGovernance();
patchLegacyTestFixtures();
console.log('Investor Control v1.8.0 OOS sample independence and date-preserving stability gates applied.');
