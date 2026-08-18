import { ASSET_CLASS } from './instrument-profile.js';

export const OPPORTUNITY_ENGINE_VERSION = '2026-08-09.2';

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));
const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));
const unique = (values = []) => [...new Set(values.filter(Boolean))];

const MODEL = Object.freeze({
  [ASSET_CLASS.EQUITY]: {
    // A fundamental opportunity must be able to qualify without a discrete
    // event catalyst or portfolio-fit score, but those dimensions improve rank.
    weights: { valuation: 0.22, quality: 0.20, growth: 0.14, momentum: 0.14, catalyst: 0.08, balanceSheet: 0.12, liquidity: 0.06, diversificationBenefit: 0.04 },
    minimumStrongPillars: 4,
    maxRiskForSuper: 60,
  },
  [ASSET_CLASS.ETF]: {
    weights: { costEfficiency: 0.14, relativeValue: 0.14, momentum: 0.14, breadth: 0.12, trackingQuality: 0.12, diversification: 0.12, liquidity: 0.12, flowSupport: 0.10 },
    minimumStrongPillars: 4,
    maxRiskForSuper: 55,
  },
  [ASSET_CLASS.FUND]: {
    weights: { feeEfficiency: 0.14, alphaPersistence: 0.18, downsideControl: 0.16, benchmarkEdge: 0.14, diversification: 0.12, managerConsistency: 0.10, liquidity: 0.08, momentum: 0.08 },
    minimumStrongPillars: 4,
    maxRiskForSuper: 55,
  },
  [ASSET_CLASS.BOND]: {
    weights: { carry: 0.20, relativeValue: 0.18, creditQuality: 0.16, creditMomentum: 0.10, durationFit: 0.10, catalyst: 0.08, liquidity: 0.10, diversificationBenefit: 0.08 },
    minimumStrongPillars: 4,
    maxRiskForSuper: 55,
  },
  [ASSET_CLASS.CRYPTO]: {
    weights: { valuation: 0.12, adoption: 0.16, tokenomics: 0.12, momentum: 0.16, catalyst: 0.12, liquidity: 0.12, protocolQuality: 0.12, diversificationBenefit: 0.08 },
    minimumStrongPillars: 5,
    maxRiskForSuper: 70,
  },
  [ASSET_CLASS.FX]: {
    weights: { carry: 0.18, macroDivergence: 0.18, valuation: 0.14, momentum: 0.14, volatilityControl: 0.12, catalyst: 0.08, liquidity: 0.10, diversificationBenefit: 0.06 },
    minimumStrongPillars: 4,
    maxRiskForSuper: 60,
  },
  [ASSET_CLASS.COMMODITY]: {
    weights: { curve: 0.16, inventories: 0.14, supplyDemand: 0.18, momentum: 0.14, macroTailwind: 0.10, catalyst: 0.08, liquidity: 0.10, diversificationBenefit: 0.10 },
    minimumStrongPillars: 4,
    maxRiskForSuper: 65,
  },
  [ASSET_CLASS.FUTURE]: {
    weights: { strategyEdge: 0.22, relativeValue: 0.14, momentum: 0.12, curve: 0.12, catalyst: 0.10, liquidity: 0.12, riskDefinition: 0.18 },
    minimumStrongPillars: 4,
    maxRiskForSuper: 65,
    requiresStrategyContext: true,
  },
  [ASSET_CLASS.OPTION]: {
    weights: { strategyEdge: 0.22, volatilityEdge: 0.18, payoffAsymmetry: 0.18, catalyst: 0.10, liquidity: 0.12, riskDefinition: 0.20 },
    minimumStrongPillars: 4,
    maxRiskForSuper: 65,
    requiresStrategyContext: true,
  },
  [ASSET_CLASS.CASH]: {
    weights: { realYield: 0.34, liquidity: 0.26, counterpartyQuality: 0.24, optionality: 0.16 },
    minimumStrongPillars: 3,
    maxRiskForSuper: 25,
  },
});

function verifiedFactor(candidate, key) {
  const factor = candidate?.factors?.[key];
  if (factor === null || factor === undefined) return null;
  if (typeof factor === 'number') return { score: clamp(factor), verified: true, sourceCount: 1, ageHours: null, peerSampleSize: null };
  if (factor.verified !== true) return null;
  const score = Number(factor.score);
  if (!Number.isFinite(score)) return null;
  return {
    score: clamp(score),
    verified: true,
    sourceCount: Math.max(1, Number(factor.sourceCount || 1)),
    ageHours: Number.isFinite(Number(factor.ageHours)) ? Math.max(0, Number(factor.ageHours)) : null,
    peerSampleSize: Number.isFinite(Number(factor.peerSampleSize)) && Number(factor.peerSampleSize) > 0 ? Number(factor.peerSampleSize) : null,
    peerKey: factor.peerKey || null,
    components: factor.components || {},
  };
}

function weightedFactors(candidate, model) {
  let weighted = 0;
  let coveredWeight = 0;
  let sourceDepth = 0;
  const factors = {};
  const missing = [];

  for (const [key, weight] of Object.entries(model.weights)) {
    const factor = verifiedFactor(candidate, key);
    if (!factor) {
      missing.push(key);
      continue;
    }
    factors[key] = factor;
    weighted += factor.score * weight;
    coveredWeight += weight;
    sourceDepth += Math.min(3, factor.sourceCount);
  }

  const factorScore = coveredWeight > 0 ? weighted / coveredWeight : 0;
  const coverageScore = coveredWeight * 100;
  const averageSourceDepth = Object.keys(factors).length ? sourceDepth / Object.keys(factors).length : 0;
  const trackedPeerSizes = Object.values(factors).map((factor) => factor.peerSampleSize).filter(Number.isFinite);
  const minimumPeerSampleSize = trackedPeerSizes.length ? Math.min(...trackedPeerSizes) : null;
  return { factors, missing, factorScore, coverageScore, averageSourceDepth, minimumPeerSampleSize };
}

function stalePenalty(factors) {
  const ages = Object.values(factors).map((factor) => factor.ageHours).filter((age) => age !== null);
  if (!ages.length) return 0;
  const stale = ages.filter((age) => age > 168).length;
  const veryStale = ages.filter((age) => age > 720).length;
  return Math.min(20, stale * 2 + veryStale * 5);
}

function tierFor(score, gates) {
  if (gates.superEligible && score >= 88) return 'SUPER_OPPORTUNITY_CANDIDATE';
  if (gates.highPriorityEligible && score >= 76) return 'HIGH_PRIORITY_CANDIDATE';
  if (score >= 62) return 'WATCHLIST_CANDIDATE';
  return 'LOW_PRIORITY';
}

export function scoreOpportunityCandidate(candidate = {}) {
  const assetClass = candidate?.profile?.assetClass || candidate.assetClass || ASSET_CLASS.UNKNOWN;
  const model = MODEL[assetClass];
  if (!model) {
    return {
      format: 'investor-control-opportunity-score',
      version: 1,
      policyVersion: OPPORTUNITY_ENGINE_VERSION,
      instrumentId: candidate.instrumentId || candidate?.profile?.instrumentId || null,
      assetClass,
      status: 'UNSUPPORTED',
      opportunityScore: 0,
      tier: 'LOW_PRIORITY',
      blockers: ['UNSUPPORTED_ASSET_CLASS'],
      finalActionEligible: false,
    };
  }

  const weighted = weightedFactors(candidate, model);
  const riskScore = clamp(candidate.riskScore ?? 100);
  const executionQuality = clamp(candidate.executionQualityScore ?? candidate.liquidityScore ?? 0);
  const evidenceQuality = clamp(candidate.evidenceQualityScore ?? 0);
  const contradictionCount = Math.max(0, Number(candidate.contradictionCount || 0));
  const severeRiskFlags = Array.isArray(candidate.severeRiskFlags) ? candidate.severeRiskFlags : [];
  const strategyContextVerified = candidate.strategyContextVerified === true;
  const stale = stalePenalty(weighted.factors);
  const peerTracked = weighted.minimumPeerSampleSize !== null;
  const superPeerReady = !peerTracked || weighted.minimumPeerSampleSize >= 5;
  const highPriorityPeerReady = !peerTracked || weighted.minimumPeerSampleSize >= 3;

  const qualityAdjustment = (evidenceQuality - 50) * 0.08;
  const executionAdjustment = (executionQuality - 50) * 0.05;
  const riskPenalty = Math.max(0, riskScore - 35) * 0.16;
  const contradictionPenalty = Math.min(18, contradictionCount * 7);
  const coveragePenalty = Math.max(0, 85 - weighted.coverageScore) * 0.20;

  const opportunityScore = clamp(
    weighted.factorScore + qualityAdjustment + executionAdjustment - riskPenalty - contradictionPenalty - coveragePenalty - stale,
  );

  const strongPillars = Object.entries(weighted.factors)
    .filter(([, factor]) => factor.score >= 75)
    .map(([key]) => key);
  const weakPillars = Object.entries(weighted.factors)
    .filter(([, factor]) => factor.score < 30)
    .map(([key]) => key);

  const blockers = [];
  if (weighted.coverageScore < 70) blockers.push('INSUFFICIENT_FACTOR_COVERAGE');
  if (evidenceQuality < 60) blockers.push('LOW_EVIDENCE_QUALITY');
  if (executionQuality < 45) blockers.push('INSUFFICIENT_EXECUTION_QUALITY');
  if (riskScore > model.maxRiskForSuper) blockers.push('RISK_TOO_HIGH_FOR_SUPER_TIER');
  if (severeRiskFlags.length) blockers.push('SEVERE_RISK_FLAG');
  if (contradictionCount > 0) blockers.push('CONTRADICTORY_EVIDENCE');
  if (model.requiresStrategyContext && !strategyContextVerified) blockers.push('STRATEGY_CONTEXT_REQUIRED');
  if (!superPeerReady) blockers.push('PEER_SAMPLE_TOO_SMALL_FOR_SUPER_TIER');

  const superEligible =
    weighted.coverageScore >= 85 &&
    evidenceQuality >= 75 &&
    executionQuality >= 55 &&
    riskScore <= model.maxRiskForSuper &&
    severeRiskFlags.length === 0 &&
    contradictionCount === 0 &&
    strongPillars.length >= model.minimumStrongPillars &&
    weakPillars.length === 0 &&
    superPeerReady &&
    (!model.requiresStrategyContext || strategyContextVerified);

  const highPriorityEligible =
    weighted.coverageScore >= 75 &&
    evidenceQuality >= 65 &&
    executionQuality >= 45 &&
    riskScore <= Math.min(85, model.maxRiskForSuper + 15) &&
    severeRiskFlags.length === 0 &&
    contradictionCount === 0 &&
    highPriorityPeerReady &&
    (!model.requiresStrategyContext || strategyContextVerified);

  const tier = tierFor(opportunityScore, { superEligible, highPriorityEligible });
  const confidenceScore = clamp(
    weighted.coverageScore * 0.35 + evidenceQuality * 0.35 + executionQuality * 0.10 + Math.min(100, weighted.averageSourceDepth * 33.33) * 0.10 + (100 - riskScore) * 0.10 - contradictionPenalty,
  );

  return {
    format: 'investor-control-opportunity-score',
    version: 1,
    policyVersion: OPPORTUNITY_ENGINE_VERSION,
    instrumentId: candidate.instrumentId || candidate?.profile?.instrumentId || null,
    displayName: candidate.displayName || candidate?.profile?.displayName || null,
    assetClass,
    analysisModel: candidate?.profile?.analysisModel || null,
    status: 'SCORED',
    tier,
    opportunityScore: round(opportunityScore),
    confidenceScore: round(confidenceScore),
    factorCoverageScore: round(weighted.coverageScore),
    evidenceQualityScore: round(evidenceQuality),
    executionQualityScore: round(executionQuality),
    riskScore: round(riskScore),
    peerSampleSize: weighted.minimumPeerSampleSize,
    strongPillars,
    weakPillars,
    missingFactors: weighted.missing,
    factors: weighted.factors,
    blockers: unique(blockers),
    severeRiskFlags: unique(severeRiskFlags),
    contradictionCount,
    discoveryAction: tier === 'SUPER_OPPORTUNITY_CANDIDATE' ? 'DEEP_VERIFY_NOW' : tier === 'HIGH_PRIORITY_CANDIDATE' ? 'DEEP_VERIFY' : 'WATCH',
    finalActionEligible: false,
    finalActionPolicy: 'OPPORTUNITY_SCORE_CAN_PRIORITIZE_RESEARCH_BUT_CAN_NEVER_BYPASS_FINAL_ACTION_POLICY',
  };
}

export function rankOpportunityUniverse(candidates = [], options = {}) {
  const scores = candidates.map(scoreOpportunityCandidate);
  const order = { SUPER_OPPORTUNITY_CANDIDATE: 4, HIGH_PRIORITY_CANDIDATE: 3, WATCHLIST_CANDIDATE: 2, LOW_PRIORITY: 1 };
  scores.sort((a, b) => (order[b.tier] || 0) - (order[a.tier] || 0) || b.opportunityScore - a.opportunityScore || b.confidenceScore - a.confidenceScore);

  const limit = Math.max(1, Number(options.limit || scores.length || 1));
  const ranked = scores.slice(0, limit).map((item, index) => ({ ...item, rank: index + 1 }));
  return {
    format: 'investor-control-opportunity-universe',
    version: 1,
    policyVersion: OPPORTUNITY_ENGINE_VERSION,
    generatedAt: new Date(options.generatedAt || Date.now()).toISOString(),
    scannedCount: candidates.length,
    rankedCount: ranked.length,
    superOpportunityCount: ranked.filter((item) => item.tier === 'SUPER_OPPORTUNITY_CANDIDATE').length,
    highPriorityCount: ranked.filter((item) => item.tier === 'HIGH_PRIORITY_CANDIDATE').length,
    items: ranked,
  };
}
