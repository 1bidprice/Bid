import { contentHash } from './content-hash.js';
import { FORECAST_FEATURE_VECTOR_VERSION, FORECAST_FACTOR_DOMAIN_WEIGHTS } from './forecast-feature-vector.js';
import { FORECAST_FACTOR_SCORE_VERSION } from './forecast-factor-score.js';

export const FORECAST_FACTOR_WEIGHT_GOVERNANCE_VERSION = '2026-08-11.1';

const CURRENT_WEIGHTS = Object.freeze({ ...FORECAST_FACTOR_DOMAIN_WEIGHTS });
const DOMAINS = Object.freeze(Object.keys(CURRENT_WEIGHTS));

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function binaryOutcome(value) {
  return value === 0 || value === 1;
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function mean(values = []) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function currentLineage(record) {
  return record?.validationMode === 'LIVE_SHADOW_OOS' &&
    record?.factorFeatureVectorPolicyVersion === FORECAST_FEATURE_VECTOR_VERSION &&
    record?.factorScorePolicyVersion === FORECAST_FACTOR_SCORE_VERSION &&
    Array.isArray(record?.factorDomainSnapshot);
}

function groupKey(record = {}) {
  return `${record.assetClass || 'UNKNOWN'}|${record.horizon || 'UNKNOWN'}`;
}

function domainSnapshot(record, domain) {
  const snapshot = (record?.factorDomainSnapshot || []).find((item) => item?.domain === domain);
  const value = number(snapshot?.value);
  const weight = number(snapshot?.weight);
  if (value === null || value < -1 || value > 1 || weight === null || weight <= 0) return null;
  return {
    forecastId: record.forecastId || null,
    forecastAt: record.forecastAt || record.forecastSampleDate || null,
    status: record.status || null,
    value,
    configuredWeight: weight,
    outcome: record.status === 'MATURED' && binaryOutcome(record.positiveOutcome) ? record.positiveOutcome : null,
    realisedReturnPct: record.status === 'MATURED' ? number(record?.realisedOutcome?.realisedReturnPct) : null,
    invalidMaturedOutcome: record.status === 'MATURED' && !binaryOutcome(record.positiveOutcome),
  };
}

function rocAuc(observations = []) {
  const valid = observations
    .filter((item) => binaryOutcome(item?.outcome) && Number.isFinite(item?.value))
    .map((item) => ({ score: item.value, outcome: item.outcome }))
    .sort((a, b) => a.score - b.score);
  const positiveCount = valid.filter((item) => item.outcome === 1).length;
  const negativeCount = valid.length - positiveCount;
  if (!positiveCount || !negativeCount) return null;
  let positiveRankSum = 0;
  let index = 0;
  while (index < valid.length) {
    let end = index + 1;
    while (end < valid.length && valid[end].score === valid[index].score) end += 1;
    const averageRank = ((index + 1) + end) / 2;
    for (let cursor = index; cursor < end; cursor += 1) {
      if (valid[cursor].outcome === 1) positiveRankSum += averageRank;
    }
    index = end;
  }
  return (positiveRankSum - positiveCount * (positiveCount + 1) / 2) / (positiveCount * negativeCount);
}

function tailSpread(observations = [], fraction = 0.25) {
  const valid = observations
    .filter((item) => binaryOutcome(item?.outcome) && Number.isFinite(item?.value))
    .slice()
    .sort((a, b) => a.value - b.value);
  if (!valid.length) {
    return {
      tailSampleSize: 0,
      positiveRateSpread: null,
      realisedReturnSpreadPct: null,
    };
  }
  const size = Math.max(1, Math.floor(valid.length * Math.max(0.1, Math.min(0.4, Number(fraction) || 0.25))));
  const bottom = valid.slice(0, size);
  const top = valid.slice(-size);
  const topPositiveRate = mean(top.map((item) => item.outcome));
  const bottomPositiveRate = mean(bottom.map((item) => item.outcome));
  const topReturn = mean(top.map((item) => item.realisedReturnPct));
  const bottomReturn = mean(bottom.map((item) => item.realisedReturnPct));
  return {
    tailSampleSize: size,
    topPositiveRate: round(topPositiveRate, 4),
    bottomPositiveRate: round(bottomPositiveRate, 4),
    positiveRateSpread: round(topPositiveRate !== null && bottomPositiveRate !== null ? topPositiveRate - bottomPositiveRate : null, 4),
    topMeanRealisedReturnPct: round(topReturn, 4),
    bottomMeanRealisedReturnPct: round(bottomReturn, 4),
    realisedReturnSpreadPct: round(topReturn !== null && bottomReturn !== null ? topReturn - bottomReturn : null, 4),
  };
}

function chronological(observations = []) {
  return observations.slice().sort((a, b) =>
    String(a.forecastAt || '').localeCompare(String(b.forecastAt || '')) ||
    String(a.forecastId || '').localeCompare(String(b.forecastId || '')),
  );
}

function contiguousBlocks(observations, count) {
  const sorted = chronological(observations);
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * sorted.length / count);
    const end = Math.floor((index + 1) * sorted.length / count);
    return sorted.slice(start, end);
  });
}

function temporalDirectionStatus(observations, direction, options = {}) {
  const matured = observations.filter((item) => binaryOutcome(item.outcome));
  const blockCount = Math.max(3, Number(options.weightGovernanceBlockCount || 3));
  const minimumBlockSample = Math.max(40, Number(options.weightGovernanceMinimumBlockSample || 60));
  const minimumBlockClassCount = Math.max(10, Number(options.weightGovernanceMinimumBlockClassCount || 15));
  const supportAuc = Number(options.weightGovernanceBlockSupportAuc ?? 0.52);
  const inversionAuc = Number(options.weightGovernanceBlockInversionAuc ?? 0.48);
  const blocks = contiguousBlocks(matured, blockCount).map((block, index) => {
    const positiveCount = block.filter((item) => item.outcome === 1).length;
    const negativeCount = block.length - positiveCount;
    const auc = rocAuc(block);
    const spread = tailSpread(block, options.weightGovernanceTailFraction || 0.25);
    const blockers = [];
    if (block.length < minimumBlockSample) blockers.push('GOVERNANCE_SUBPERIOD_SAMPLE_TOO_SMALL');
    if (positiveCount < minimumBlockClassCount || negativeCount < minimumBlockClassCount) blockers.push('GOVERNANCE_SUBPERIOD_CLASS_SUPPORT_TOO_SMALL');
    if (direction === 'INCREASE_REVIEW') {
      if (!Number.isFinite(auc) || auc < supportAuc) blockers.push('GOVERNANCE_SUBPERIOD_AUC_DOES_NOT_SUPPORT_INCREASE');
      if (!Number.isFinite(Number(spread.positiveRateSpread)) || Number(spread.positiveRateSpread) <= 0) blockers.push('GOVERNANCE_SUBPERIOD_OUTCOME_SPREAD_DOES_NOT_SUPPORT_INCREASE');
      if (!Number.isFinite(Number(spread.realisedReturnSpreadPct)) || Number(spread.realisedReturnSpreadPct) <= 0) blockers.push('GOVERNANCE_SUBPERIOD_RETURN_SPREAD_DOES_NOT_SUPPORT_INCREASE');
    } else {
      if (!Number.isFinite(auc) || auc > inversionAuc) blockers.push('GOVERNANCE_SUBPERIOD_AUC_DOES_NOT_SUPPORT_DECREASE');
      if (!Number.isFinite(Number(spread.positiveRateSpread)) || Number(spread.positiveRateSpread) >= 0) blockers.push('GOVERNANCE_SUBPERIOD_OUTCOME_SPREAD_DOES_NOT_SUPPORT_DECREASE');
      if (!Number.isFinite(Number(spread.realisedReturnSpreadPct)) || Number(spread.realisedReturnSpreadPct) >= 0) blockers.push('GOVERNANCE_SUBPERIOD_RETURN_SPREAD_DOES_NOT_SUPPORT_DECREASE');
    }
    return {
      index,
      sampleSize: block.length,
      positiveCount,
      negativeCount,
      firstForecastAt: block[0]?.forecastAt || null,
      lastForecastAt: block.at(-1)?.forecastAt || null,
      rocAuc: round(auc, 4),
      positiveRateSpread: spread.positiveRateSpread,
      realisedReturnSpreadPct: spread.realisedReturnSpreadPct,
      status: blockers.length ? 'UNSTABLE' : 'STABLE',
      blockers,
    };
  });
  return {
    direction,
    status: blocks.length === blockCount && blocks.every((block) => block.status === 'STABLE') ? 'STABILITY_READY' : 'UNSTABLE',
    stableAcrossSubperiods: blocks.length === blockCount && blocks.every((block) => block.status === 'STABLE'),
    thresholds: { blockCount, minimumBlockSample, minimumBlockClassCount, supportAuc, inversionAuc },
    subperiods: blocks,
  };
}

function currentWeights() {
  return Object.fromEntries(DOMAINS.map((domain) => [domain, Number(CURRENT_WEIGHTS[domain])]));
}

function sumWeights(weights) {
  return Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0);
}

function finalizeWeights(weights, correctionDomain) {
  const rounded = Object.fromEntries(DOMAINS.map((domain) => [domain, round(Number(weights[domain]), 6)]));
  const residual = round(1 - sumWeights(rounded), 6);
  if (Math.abs(residual) > 0 && correctionDomain) rounded[correctionDomain] = round(rounded[correctionDomain] + residual, 6);
  return rounded;
}

function proposedWeights(domain, direction, delta) {
  const before = currentWeights();
  const after = { ...before };
  const magnitude = Math.max(0.001, Math.min(0.02, Number(delta) || 0.02));
  if (!DOMAINS.includes(domain)) return null;
  if (direction === 'DECREASE_REVIEW' && domain === 'RISK') return null;

  if (direction === 'INCREASE_REVIEW') {
    const donors = DOMAINS.filter((candidate) => candidate !== domain && candidate !== 'RISK');
    const donorWeight = donors.reduce((sum, candidate) => sum + before[candidate], 0);
    if (donorWeight <= magnitude) return null;
    after[domain] += magnitude;
    for (const donor of donors) after[donor] -= magnitude * (before[donor] / donorWeight);
    return { beforeWeights: before, afterWeights: finalizeWeights(after, donors[0]), delta: magnitude };
  }

  const receivers = DOMAINS.filter((candidate) => candidate !== domain);
  const receiverWeight = receivers.reduce((sum, candidate) => sum + before[candidate], 0);
  if (before[domain] <= magnitude || receiverWeight <= 0) return null;
  after[domain] -= magnitude;
  for (const receiver of receivers) after[receiver] += magnitude * (before[receiver] / receiverWeight);
  return { beforeWeights: before, afterWeights: finalizeWeights(after, receivers[0]), delta: -magnitude };
}

function attributionDomain(input, group, domain) {
  const attributionGroups = Array.isArray(input?.attributionStatus?.groups) ? input.attributionStatus.groups : [];
  const match = attributionGroups.find((candidate) =>
    candidate?.factorFeatureVectorPolicyVersion === FORECAST_FEATURE_VECTOR_VERSION &&
    candidate?.factorScorePolicyVersion === FORECAST_FACTOR_SCORE_VERSION &&
    candidate?.assetClass === group.assetClass &&
    candidate?.horizon === group.horizon,
  );
  return (match?.domains || []).find((item) => item?.domain === domain) || null;
}

function evaluateDomain(input, records, group, domain, options = {}) {
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
  const blockers = [];
  if (!upstream) blockers.push('CURRENT_UPSTREAM_ATTRIBUTION_REQUIRED');
  else if (upstream.manualWeightReviewCandidate !== true) blockers.push('UPSTREAM_ATTRIBUTION_MANUAL_REVIEW_GATE_NOT_READY');
  if (matured.length < minimumMatured) blockers.push('GOVERNANCE_MATURED_OOS_SAMPLE_TOO_SMALL');
  if (positiveCount < minimumClassCount) blockers.push('GOVERNANCE_POSITIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (negativeCount < minimumClassCount) blockers.push('GOVERNANCE_NEGATIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (coveragePct < minimumCoveragePct) blockers.push('GOVERNANCE_DOMAIN_COVERAGE_TOO_LOW');
  if (invalidMaturedOutcomeCount) blockers.push('INVALID_MATURED_BINARY_OUTCOME_RECORDS_EXCLUDED');

  let direction = null;
  if (Number.isFinite(auc) && auc >= increaseAuc && Number(spread.positiveRateSpread) >= minimumSpread && Number(spread.realisedReturnSpreadPct) > 0) direction = 'INCREASE_REVIEW';
  else if (Number.isFinite(auc) && auc <= decreaseAuc && Number(spread.positiveRateSpread) <= -minimumSpread && Number(spread.realisedReturnSpreadPct) < 0) direction = 'DECREASE_REVIEW';
  else blockers.push('GOVERNANCE_FULL_PERIOD_SIGNAL_NOT_STRONG_ENOUGH');
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

function buildProposal(group, evaluation) {
  const weights = evaluation.proposalWeights;
  if (!weights || !evaluation.proposedDirection) return null;
  const beforeSum = round(sumWeights(weights.beforeWeights), 6);
  const afterSum = round(sumWeights(weights.afterWeights), 6);
  const currentWeight = weights.beforeWeights[evaluation.domain];
  const proposedWeight = weights.afterWeights[evaluation.domain];
  const identity = {
    governancePolicyVersion: FORECAST_FACTOR_WEIGHT_GOVERNANCE_VERSION,
    factorFeatureVectorPolicyVersion: FORECAST_FEATURE_VECTOR_VERSION,
    factorScorePolicyVersion: FORECAST_FACTOR_SCORE_VERSION,
    assetClass: group.assetClass,
    horizon: group.horizon,
    domain: evaluation.domain,
    direction: evaluation.proposedDirection,
    currentWeight,
    proposedWeight,
  };
  const subperiods = evaluation.temporalStability.subperiods || [];
  return {
    proposalId: `factor-weight:${contentHash(identity).slice(0, 28)}`,
    reviewState: 'MANUAL_REVIEW_REQUIRED',
    factorFeatureVectorPolicyVersion: FORECAST_FEATURE_VECTOR_VERSION,
    factorScorePolicyVersion: FORECAST_FACTOR_SCORE_VERSION,
    assetClass: group.assetClass,
    horizon: group.horizon,
    domain: evaluation.domain,
    direction: evaluation.proposedDirection,
    currentWeight: round(currentWeight, 6),
    proposedWeight: round(proposedWeight, 6),
    directWeightDelta: round(proposedWeight - currentWeight, 6),
    beforeWeights: weights.beforeWeights,
    afterWeights: weights.afterWeights,
    beforeWeightSum: beforeSum,
    afterWeightSum: afterSum,
    evidence: {
      maturedOosSampleSize: evaluation.maturedSampleSize,
      positiveCount: evaluation.positiveCount,
      negativeCount: evaluation.negativeCount,
      lineageCoveragePct: evaluation.lineageCoveragePct,
      rocAuc: evaluation.rocAuc,
      topBottomPositiveRateSpread: evaluation.topBottom.positiveRateSpread,
      topBottomRealisedReturnSpreadPct: evaluation.topBottom.realisedReturnSpreadPct,
      firstForecastAt: subperiods[0]?.firstForecastAt || null,
      lastForecastAt: subperiods.at(-1)?.lastForecastAt || null,
      temporalSubperiods: subperiods,
    },
    rationaleCodes: [
      evaluation.proposedDirection === 'INCREASE_REVIEW'
        ? 'STRONG_STABLE_POSITIVE_DOMAIN_OOS_SIGNAL'
        : 'STRONG_STABLE_INVERTED_DOMAIN_OOS_SIGNAL',
      'CURRENT_MODEL_LINEAGE_ONLY',
      'MANUAL_REVIEW_ONLY_NO_AUTOMATIC_APPLICATION',
    ],
    requiresNewPolicyVersionOnApproval: true,
    automaticApplicationAllowed: false,
    rollbackPlan: {
      strategy: 'RESTORE_BEFORE_WEIGHTS_WITH_NEW_POLICY_VERSION',
      restoreWeights: weights.beforeWeights,
      restoreFeatureVectorPolicyVersionReference: FORECAST_FEATURE_VECTOR_VERSION,
      restoreFactorScorePolicyVersionReference: FORECAST_FACTOR_SCORE_VERSION,
      rewriteHistoricalOosRecords: false,
    },
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
  };
}

export function buildForecastFactorWeightGovernanceStatus(input = {}) {
  const lineage = (Array.isArray(input.records) ? input.records : input.archive?.records || []).filter(currentLineage);
  const grouped = new Map();
  for (const record of lineage) {
    const key = groupKey(record);
    const records = grouped.get(key) || [];
    records.push(record);
    grouped.set(key, records);
  }
  const groups = [...grouped.values()].map((records) => {
    const group = { assetClass: records[0]?.assetClass || 'UNKNOWN', horizon: records[0]?.horizon || 'UNKNOWN' };
    const domains = DOMAINS.map((domain) => evaluateDomain(input, records, group, domain, input.options || {}));
    const proposals = domains.map((evaluation) => buildProposal(group, evaluation)).filter(Boolean);
    return {
      factorFeatureVectorPolicyVersion: FORECAST_FEATURE_VECTOR_VERSION,
      factorScorePolicyVersion: FORECAST_FACTOR_SCORE_VERSION,
      assetClass: group.assetClass,
      horizon: group.horizon,
      lineageRecordCount: records.length,
      proposalCount: proposals.length,
      domains,
      proposals,
    };
  }).sort((a, b) => String(a.assetClass).localeCompare(String(b.assetClass)) || String(a.horizon).localeCompare(String(b.horizon)));
  const proposals = groups.flatMap((group) => group.proposals);
  return {
    format: 'investor-control-forecast-factor-weight-governance-status',
    version: 1,
    policyVersion: FORECAST_FACTOR_WEIGHT_GOVERNANCE_VERSION,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    source: 'CURRENT_VERSION_LIVE_SHADOW_OOS_FACTOR_ATTRIBUTION_ONLY',
    status: proposals.length ? 'MANUAL_REVIEW_PROPOSALS_EXIST' : 'NO_ELIGIBLE_WEIGHT_CHANGE_PROPOSALS',
    currentFeatureVectorPolicyVersion: FORECAST_FEATURE_VECTOR_VERSION,
    currentFactorScorePolicyVersion: FORECAST_FACTOR_SCORE_VERSION,
    currentWeights: currentWeights(),
    lineageRecordCount: lineage.length,
    groupCount: groups.length,
    proposalCount: proposals.length,
    groups,
    proposals,
    automaticWeightAdjustmentEnabled: false,
    automaticProposalApplicationEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    approvalBoundary: 'ANY_APPROVED_WEIGHT_CHANGE_REQUIRES_NEW_VERSIONED_FEATURE_VECTOR_AND_FACTOR_SCORE_POLICY',
  };
}
