import { contentHash } from './content-hash.js';
import { FORECAST_FEATURE_VECTOR_VERSION, FORECAST_FACTOR_DOMAIN_WEIGHTS } from './forecast-feature-vector.js';
import { FORECAST_FACTOR_SCORE_VERSION } from './forecast-factor-score.js';
import { validateForecastMarketRegimeSnapshot } from './forecast-market-regime.js';
import { evaluateOosSampleIndependence, splitChronologicalDateBlocks } from './forecast-oos-sample-independence.js';
import { evaluateOosOutcomeWindowIndependence } from './forecast-oos-outcome-window-independence.js';
import { evaluateOosInstrumentConcentration } from './forecast-oos-instrument-concentration.js';
import { evaluateOosTaxonomyConcentration } from './forecast-oos-taxonomy-concentration.js';

export const FORECAST_REGIME_FACTOR_WEIGHT_GOVERNANCE_VERSION = '2026-08-12.1';

const CURRENT_WEIGHTS = Object.freeze({ ...FORECAST_FACTOR_DOMAIN_WEIGHTS });
const DOMAINS = Object.freeze(Object.keys(CURRENT_WEIGHTS));

function strictNumber(value) {
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
    Array.isArray(record?.factorDomainSnapshot) &&
    record?.status === 'MATURED' &&
    binaryOutcome(record?.positiveOutcome) &&
    record?.marketRegimeSnapshot &&
    validateForecastMarketRegimeSnapshot(record.marketRegimeSnapshot, record).ok;
}

function groupKey(record = {}) {
  return `${record.assetClass || 'UNKNOWN'}|${record.horizon || 'UNKNOWN'}|${record.marketRegimeSnapshot?.regimeKey || 'NO_REGIME'}`;
}

function domainValue(record, domain) {
  const snapshot = (record?.factorDomainSnapshot || []).find((item) => item?.domain === domain);
  const value = strictNumber(snapshot?.value);
  return value !== null && value >= -1 && value <= 1 ? value : null;
}

function rocAuc(records = [], domain) {
  const valid = records
    .map((record) => ({ score: domainValue(record, domain), outcome: record.positiveOutcome }))
    .filter((item) => Number.isFinite(item.score) && binaryOutcome(item.outcome))
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

function tailSpread(records = [], domain, fraction = 0.25) {
  const valid = records
    .map((record) => ({
      score: domainValue(record, domain),
      outcome: record.positiveOutcome,
      realisedReturnPct: strictNumber(record?.realisedOutcome?.realisedReturnPct),
    }))
    .filter((item) => Number.isFinite(item.score) && binaryOutcome(item.outcome))
    .sort((a, b) => a.score - b.score);
  if (!valid.length) return { tailSampleSize: 0, positiveRateSpread: null, realisedReturnSpreadPct: null };
  const size = Math.max(1, Math.floor(valid.length * Math.max(0.1, Math.min(0.4, Number(fraction) || 0.25))));
  const bottom = valid.slice(0, size);
  const top = valid.slice(-size);
  const topPositiveRate = mean(top.map((item) => item.outcome));
  const bottomPositiveRate = mean(bottom.map((item) => item.outcome));
  const topReturn = mean(top.map((item) => item.realisedReturnPct).filter(Number.isFinite));
  const bottomReturn = mean(bottom.map((item) => item.realisedReturnPct).filter(Number.isFinite));
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

function upstreamRegimeFactorSignal(input, group, domain) {
  const groups = Array.isArray(input?.regimeFactorAttributionStatus?.groups) ? input.regimeFactorAttributionStatus.groups : [];
  const match = groups.find((candidate) =>
    candidate?.factorFeatureVectorPolicyVersion === FORECAST_FEATURE_VECTOR_VERSION &&
    candidate?.factorScorePolicyVersion === FORECAST_FACTOR_SCORE_VERSION &&
    candidate?.assetClass === group.assetClass &&
    candidate?.horizon === group.horizon,
  );
  const regime = (match?.regimes || []).find((candidate) => candidate?.regimeKey === group.regimeKey);
  return (regime?.domains || []).find((candidate) => candidate?.domain === domain) || null;
}

function upstreamRegimeResearch(input, group) {
  const groups = Array.isArray(input?.regimeLearningStatus?.groups) ? input.regimeLearningStatus.groups : [];
  for (const candidate of groups) {
    if (candidate?.assetClass !== group.assetClass || candidate?.horizon !== group.horizon) continue;
    const regime = (candidate?.regimes || []).find((item) => item?.regimeKey === group.regimeKey);
    if (regime?.status === 'REGIME_RESEARCH_READY') return regime;
  }
  return null;
}

function temporalStability(records, domain, direction, options = {}) {
  const blockCount = Math.max(3, Number(options.regimeWeightGovernanceBlockCount || 3));
  const minimumBlockSample = Math.max(30, Number(options.regimeWeightGovernanceMinimumBlockSample || 40));
  const minimumBlockClassCount = Math.max(5, Number(options.regimeWeightGovernanceMinimumBlockClassCount || 10));
  const supportAuc = Number(options.regimeWeightGovernanceBlockSupportAuc ?? 0.52);
  const inversionAuc = Number(options.regimeWeightGovernanceBlockInversionAuc ?? 0.48);
  const blocks = splitChronologicalDateBlocks(records, blockCount).map((block, index) => {
    const positiveCount = block.filter((record) => record.positiveOutcome === 1).length;
    const negativeCount = block.length - positiveCount;
    const auc = rocAuc(block, domain);
    const spread = tailSpread(block, domain, options.regimeWeightGovernanceTailFraction || 0.25);
    const blockers = [];
    if (block.length < minimumBlockSample) blockers.push('REGIME_GOVERNANCE_SUBPERIOD_SAMPLE_TOO_SMALL');
    if (positiveCount < minimumBlockClassCount || negativeCount < minimumBlockClassCount) blockers.push('REGIME_GOVERNANCE_SUBPERIOD_CLASS_SUPPORT_TOO_SMALL');
    if (direction === 'INCREASE_REVIEW') {
      if (!Number.isFinite(auc) || auc < supportAuc) blockers.push('REGIME_GOVERNANCE_SUBPERIOD_AUC_DOES_NOT_SUPPORT_INCREASE');
      if (!Number.isFinite(Number(spread.positiveRateSpread)) || Number(spread.positiveRateSpread) <= 0) blockers.push('REGIME_GOVERNANCE_SUBPERIOD_OUTCOME_SPREAD_DOES_NOT_SUPPORT_INCREASE');
      if (!Number.isFinite(Number(spread.realisedReturnSpreadPct)) || Number(spread.realisedReturnSpreadPct) <= 0) blockers.push('REGIME_GOVERNANCE_SUBPERIOD_RETURN_SPREAD_DOES_NOT_SUPPORT_INCREASE');
    } else {
      if (!Number.isFinite(auc) || auc > inversionAuc) blockers.push('REGIME_GOVERNANCE_SUBPERIOD_AUC_DOES_NOT_SUPPORT_DECREASE');
      if (!Number.isFinite(Number(spread.positiveRateSpread)) || Number(spread.positiveRateSpread) >= 0) blockers.push('REGIME_GOVERNANCE_SUBPERIOD_OUTCOME_SPREAD_DOES_NOT_SUPPORT_DECREASE');
      if (!Number.isFinite(Number(spread.realisedReturnSpreadPct)) || Number(spread.realisedReturnSpreadPct) >= 0) blockers.push('REGIME_GOVERNANCE_SUBPERIOD_RETURN_SPREAD_DOES_NOT_SUPPORT_DECREASE');
    }
    return {
      index,
      sampleSize: block.length,
      positiveCount,
      negativeCount,
      firstForecastAt: block[0]?.forecastAt || block[0]?.forecastSampleDate || null,
      lastForecastAt: block.at(-1)?.forecastAt || block.at(-1)?.forecastSampleDate || null,
      rocAuc: round(auc, 4),
      positiveRateSpread: spread.positiveRateSpread,
      realisedReturnSpreadPct: spread.realisedReturnSpreadPct,
      status: blockers.length ? 'UNSTABLE' : 'STABLE',
      blockers,
    };
  });
  const stable = blocks.length === blockCount && blocks.every((block) => block.status === 'STABLE');
  return {
    direction,
    status: stable ? 'STABILITY_READY' : 'UNSTABLE',
    stableAcrossSubperiods: stable,
    thresholds: { blockCount, minimumBlockSample, minimumBlockClassCount, supportAuc, inversionAuc },
    subperiods: blocks,
  };
}

function currentWeights() {
  return Object.fromEntries(DOMAINS.map((domain) => [domain, Number(CURRENT_WEIGHTS[domain])]));
}

function sumWeights(weights = {}) {
  return Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0);
}

function finalizeWeights(weights, correctionDomain) {
  const rounded = Object.fromEntries(DOMAINS.map((domain) => [domain, round(Number(weights[domain]), 6)]));
  const residual = round(1 - sumWeights(rounded), 6);
  if (Math.abs(residual) > 0 && correctionDomain) rounded[correctionDomain] = round(rounded[correctionDomain] + residual, 6);
  return rounded;
}

function proposedRegimeWeights(domain, direction, delta) {
  if (!DOMAINS.includes(domain)) return null;
  if (direction === 'DECREASE_REVIEW' && domain === 'RISK') return null;
  const before = currentWeights();
  const after = { ...before };
  const magnitude = Math.max(0.001, Math.min(0.01, Number(delta) || 0.01));
  if (direction === 'INCREASE_REVIEW') {
    const donors = DOMAINS.filter((candidate) => candidate !== domain && candidate !== 'RISK');
    const donorWeight = donors.reduce((sum, candidate) => sum + before[candidate], 0);
    if (donorWeight <= magnitude) return null;
    after[domain] += magnitude;
    for (const donor of donors) after[donor] -= magnitude * (before[donor] / donorWeight);
    return { beforeWeights: before, reviewWeights: finalizeWeights(after, donors[0]), delta: magnitude };
  }
  const receivers = DOMAINS.filter((candidate) => candidate !== domain);
  const receiverWeight = receivers.reduce((sum, candidate) => sum + before[candidate], 0);
  if (before[domain] <= magnitude || receiverWeight <= 0) return null;
  after[domain] -= magnitude;
  for (const receiver of receivers) after[receiver] += magnitude * (before[receiver] / receiverWeight);
  return { beforeWeights: before, reviewWeights: finalizeWeights(after, receivers[0]), delta: -magnitude };
}

function evaluateDomain(input, group, records, domain, options = {}) {
  const contributingRecords = records.filter((record) => domainValue(record, domain) !== null);
  const positiveCount = contributingRecords.filter((record) => record.positiveOutcome === 1).length;
  const negativeCount = contributingRecords.length - positiveCount;
  const featureCoveragePct = records.length ? contributingRecords.length / records.length * 100 : 0;
  const upstreamSignal = upstreamRegimeFactorSignal(input, group, domain);
  const upstreamRegime = upstreamRegimeResearch(input, group);
  const minimumMatured = Math.max(120, Number(options.regimeWeightGovernanceMinimumMaturedSample || 200));
  const minimumClassCount = Math.max(20, Number(options.regimeWeightGovernanceMinimumClassCount || 40));
  const minimumFeatureCoveragePct = Math.max(60, Math.min(100, Number(options.regimeWeightGovernanceMinimumFeatureCoveragePct || 80)));
  const increaseAuc = Number(options.regimeWeightGovernanceIncreaseAuc ?? 0.60);
  const decreaseAuc = Number(options.regimeWeightGovernanceDecreaseAuc ?? 0.40);
  const minimumSpread = Number(options.regimeWeightGovernanceMinimumPositiveRateSpread ?? 0.12);
  const auc = rocAuc(contributingRecords, domain);
  const spread = tailSpread(contributingRecords, domain, options.regimeWeightGovernanceTailFraction || 0.25);
  const sampleIndependence = evaluateOosSampleIndependence(contributingRecords, {
    minimumDistinctForecastDates: options.regimeWeightGovernanceMinimumDistinctForecastDates ?? 40,
    minimumDistinctInstruments: options.regimeWeightGovernanceMinimumDistinctInstruments ?? 10,
    maximumSingleForecastDateSharePct: options.regimeWeightGovernanceMaximumSingleForecastDateSharePct ?? 10,
  });
  const outcomeWindowIndependence = evaluateOosOutcomeWindowIndependence(contributingRecords, {
    minimumEffectiveNonOverlappingWindows: options.regimeWeightGovernanceMinimumEffectiveNonOverlappingWindows ?? 12,
  });
  const instrumentConcentration = evaluateOosInstrumentConcentration(contributingRecords, {
    maximumSingleInstrumentSharePct: options.regimeWeightGovernanceMaximumSingleInstrumentSharePct ?? 25,
    minimumEffectiveInstrumentCount: options.regimeWeightGovernanceMinimumEffectiveInstrumentCount ?? 6,
  });
  const taxonomyConcentration = evaluateOosTaxonomyConcentration(contributingRecords, {
    minimumClassificationCoveragePct: options.regimeWeightGovernanceMinimumClassificationCoveragePct ?? 90,
    materialTaxonomyMinimumSharePct: options.regimeWeightGovernanceMaterialTaxonomyMinimumSharePct ?? 15,
    materialTaxonomyMinimumRecordCount: options.regimeWeightGovernanceMaterialTaxonomyMinimumRecordCount ?? 50,
    maximumSingleNativeClusterSharePct: options.regimeWeightGovernanceMaximumSingleNativeClusterSharePct ?? 30,
    minimumEffectiveNativeClusterCount: options.regimeWeightGovernanceMinimumEffectiveNativeClusterCount ?? 4,
  });

  const blockers = [];
  if (!upstreamRegime) blockers.push('UPSTREAM_REGIME_RESEARCH_READY_REQUIRED');
  if (upstreamSignal?.status !== 'REGIME_FACTOR_RESEARCH_READY') blockers.push('UPSTREAM_REGIME_FACTOR_RESEARCH_READY_REQUIRED');
  if (!['SUPPORTED_IN_REGIME', 'INVERTED_IN_REGIME'].includes(upstreamSignal?.signal)) blockers.push('UPSTREAM_REGIME_FACTOR_DIRECTION_REQUIRED');
  if (contributingRecords.length < minimumMatured) blockers.push('REGIME_GOVERNANCE_MATURED_OOS_SAMPLE_TOO_SMALL');
  if (positiveCount < minimumClassCount) blockers.push('REGIME_GOVERNANCE_POSITIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (negativeCount < minimumClassCount) blockers.push('REGIME_GOVERNANCE_NEGATIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (featureCoveragePct < minimumFeatureCoveragePct) blockers.push('REGIME_GOVERNANCE_FEATURE_COVERAGE_TOO_LOW');
  blockers.push(...sampleIndependence.blockers);
  blockers.push(...outcomeWindowIndependence.blockers);
  blockers.push(...instrumentConcentration.blockers);
  blockers.push(...taxonomyConcentration.blockers);

  let direction = null;
  if (upstreamSignal?.signal === 'SUPPORTED_IN_REGIME' && Number.isFinite(auc) && auc >= increaseAuc && Number(spread.positiveRateSpread) >= minimumSpread && Number(spread.realisedReturnSpreadPct) > 0) {
    direction = 'INCREASE_REVIEW';
  } else if (upstreamSignal?.signal === 'INVERTED_IN_REGIME' && Number.isFinite(auc) && auc <= decreaseAuc && Number(spread.positiveRateSpread) <= -minimumSpread && Number(spread.realisedReturnSpreadPct) < 0) {
    direction = 'DECREASE_REVIEW';
  } else {
    blockers.push('REGIME_GOVERNANCE_FULL_PERIOD_SIGNAL_NOT_STRONG_ENOUGH');
  }
  if (direction === 'DECREASE_REVIEW' && domain === 'RISK') blockers.push('RISK_WEIGHT_DECREASE_PROHIBITED');

  const stability = direction ? temporalStability(contributingRecords, domain, direction, options) : {
    direction: null,
    status: 'NOT_EVALUATED',
    stableAcrossSubperiods: false,
    subperiods: [],
  };
  if (direction && stability.status !== 'STABILITY_READY') blockers.push('REGIME_GOVERNANCE_SIGNAL_NOT_TEMPORALLY_STABLE');

  const uniqueBlockers = [...new Set(blockers)];
  const eligible = uniqueBlockers.length === 0 && direction !== null;
  const weights = eligible ? proposedRegimeWeights(domain, direction, options.regimeWeightGovernanceProposalDelta || 0.01) : null;
  if (eligible && !weights) uniqueBlockers.push('REGIME_GOVERNANCE_REVIEW_VECTOR_FAILED');

  return {
    domain,
    status: eligible && weights ? 'REGIME_WEIGHT_MANUAL_REVIEW_PROPOSAL_READY' : 'NO_PROPOSAL',
    currentGlobalWeight: CURRENT_WEIGHTS[domain],
    maturedSampleSize: contributingRecords.length,
    positiveCount,
    negativeCount,
    featureCoveragePct: round(featureCoveragePct, 2),
    rocAuc: round(auc, 4),
    topBottom: spread,
    upstreamRegimeResearchStatus: upstreamRegime?.status || null,
    upstreamRegimeFactorStatus: upstreamSignal?.status || null,
    upstreamRegimeFactorSignal: upstreamSignal?.signal || null,
    sampleIndependence,
    outcomeWindowIndependence,
    instrumentConcentration,
    taxonomyConcentration,
    temporalStability: stability,
    proposedDirection: eligible && weights ? direction : null,
    reviewWeights: weights,
    blockers: uniqueBlockers,
    researchOnly: true,
    automaticRegimeWeightingEnabled: false,
    automaticFactorReweightingEnabled: false,
    automaticProposalApplicationEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
  };
}

function buildProposal(group, evaluation) {
  const weights = evaluation.reviewWeights;
  if (!weights || !evaluation.proposedDirection) return null;
  const proposal = {
    scope: 'REGIME_ONLY_MANUAL_REVIEW',
    assetClass: group.assetClass,
    horizon: group.horizon,
    regimeKey: group.regimeKey,
    riskTone: group.riskTone,
    trendRegime: group.trendRegime,
    momentumRegime: group.momentumRegime,
    volatilityRegime: group.volatilityRegime,
    domain: evaluation.domain,
    direction: evaluation.proposedDirection,
    currentGlobalWeight: evaluation.currentGlobalWeight,
    proposedRegimeWeight: round(evaluation.currentGlobalWeight + weights.delta, 6),
    directWeightDelta: weights.delta,
    beforeGlobalWeights: weights.beforeWeights,
    reviewRegimeWeights: weights.reviewWeights,
    beforeWeightSum: round(sumWeights(weights.beforeWeights), 6),
    reviewWeightSum: round(sumWeights(weights.reviewWeights), 6),
    evidence: {
      maturedSampleSize: evaluation.maturedSampleSize,
      positiveCount: evaluation.positiveCount,
      negativeCount: evaluation.negativeCount,
      featureCoveragePct: evaluation.featureCoveragePct,
      rocAuc: evaluation.rocAuc,
      topBottom: evaluation.topBottom,
      upstreamRegimeResearchStatus: evaluation.upstreamRegimeResearchStatus,
      upstreamRegimeFactorStatus: evaluation.upstreamRegimeFactorStatus,
      upstreamRegimeFactorSignal: evaluation.upstreamRegimeFactorSignal,
      sampleIndependence: evaluation.sampleIndependence,
      outcomeWindowIndependence: evaluation.outcomeWindowIndependence,
      instrumentConcentration: evaluation.instrumentConcentration,
      taxonomyConcentration: evaluation.taxonomyConcentration,
      temporalStability: evaluation.temporalStability,
    },
    rationale: [
      'CURRENT_MODEL_LINEAGE_ONLY',
      'FROZEN_FORECAST_TIME_REGIME_ONLY',
      'UPSTREAM_REGIME_RESEARCH_READY',
      'UPSTREAM_REGIME_FACTOR_RESEARCH_READY',
      'STRICT_OOS_INDEPENDENCE_GATES_PASSED',
      'TEMPORAL_STABILITY_WITHIN_REGIME_PASSED',
      'MANUAL_REVIEW_ONLY_NO_AUTOMATIC_APPLICATION',
    ],
    reviewState: 'MANUAL_REVIEW_REQUIRED',
    changesGlobalWeights: false,
    automaticApplicationAllowed: false,
    requiresNewRegimePolicyVersionOnApproval: true,
    rollbackPlan: {
      restoreCurrentGlobalWeights: true,
      removeRegimeOverlay: true,
      rewriteHistoricalOosRecords: false,
    },
    researchOnly: true,
    automaticRegimeWeightingEnabled: false,
    automaticFactorReweightingEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
  };
  return { proposalId: contentHash(proposal), ...proposal };
}

function evaluateGroup(input, records, options = {}) {
  const snapshot = records[0]?.marketRegimeSnapshot || {};
  const group = {
    assetClass: records[0]?.assetClass || 'UNKNOWN',
    horizon: records[0]?.horizon || 'UNKNOWN',
    regimeKey: snapshot.regimeKey || null,
    riskTone: snapshot.riskTone || null,
    trendRegime: snapshot.trendRegime || null,
    momentumRegime: snapshot.momentumRegime || null,
    volatilityRegime: snapshot.volatilityRegime || null,
  };
  const domains = DOMAINS.map((domain) => evaluateDomain(input, group, records, domain, options));
  const proposals = domains.map((evaluation) => buildProposal(group, evaluation)).filter(Boolean);
  return {
    factorFeatureVectorPolicyVersion: FORECAST_FEATURE_VECTOR_VERSION,
    factorScorePolicyVersion: FORECAST_FACTOR_SCORE_VERSION,
    ...group,
    maturedRegimeRecordCount: records.length,
    domainCount: domains.length,
    proposalCount: proposals.length,
    domains,
    proposals,
    researchOnly: true,
    automaticRegimeWeightingEnabled: false,
    automaticFactorReweightingEnabled: false,
    automaticProposalApplicationEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
  };
}

export function buildForecastRegimeFactorWeightGovernanceStatus(input = {}) {
  const records = (Array.isArray(input.records) ? input.records : input.archive?.records || []).filter(currentLineage);
  const map = new Map();
  for (const record of records) {
    const key = groupKey(record);
    const group = map.get(key) || [];
    group.push(record);
    map.set(key, group);
  }
  const groups = [...map.values()]
    .map((groupRecords) => evaluateGroup(input, groupRecords, input.options || {}))
    .sort((a, b) => String(a.assetClass).localeCompare(String(b.assetClass)) || String(a.horizon).localeCompare(String(b.horizon)) || String(a.regimeKey).localeCompare(String(b.regimeKey)));
  const proposals = groups.flatMap((group) => group.proposals);
  return {
    format: 'investor-control-forecast-regime-factor-weight-governance-status',
    version: 1,
    policyVersion: FORECAST_REGIME_FACTOR_WEIGHT_GOVERNANCE_VERSION,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    source: 'LIVE_SHADOW_OOS_REGIME_CONDITIONAL_FACTOR_MANUAL_GOVERNANCE_ONLY',
    status: proposals.length ? 'REGIME_WEIGHT_REVIEW_PROPOSALS_EXIST' : records.length ? 'NO_ELIGIBLE_REGIME_WEIGHT_PROPOSALS' : 'NO_CURRENT_REGIME_FACTOR_OOS_LINEAGE',
    lineageRecordCount: records.length,
    groupCount: groups.length,
    proposalCount: proposals.length,
    groups,
    proposals,
    researchOnly: true,
    automaticRegimeWeightingEnabled: false,
    automaticFactorReweightingEnabled: false,
    automaticProposalApplicationEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
  };
}
