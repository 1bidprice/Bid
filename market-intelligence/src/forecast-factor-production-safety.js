import { FORECAST_FEATURE_VECTOR_VERSION, FORECAST_FACTOR_DOMAIN_WEIGHTS } from './forecast-feature-vector.js';
import { FORECAST_FACTOR_SCORE_VERSION } from './forecast-factor-score.js';

export const FORECAST_FACTOR_PRODUCTION_OBSERVABILITY_VERSION = '2026-08-11.1';
export const FORECAST_FACTOR_PRODUCTION_OBSERVABILITY_CONTRACT = 'FACTOR_RESEARCH_GOVERNANCE_OBSERVABILITY_V1';

const WEIGHT_TOLERANCE = 0.00001;
const MAX_DIRECT_WEIGHT_DELTA = 0.020001;
const CURRENT_WEIGHTS = Object.freeze({ ...FORECAST_FACTOR_DOMAIN_WEIGHTS });
const CURRENT_DOMAINS = Object.freeze(Object.keys(CURRENT_WEIGHTS));

function assert(condition, message) {
  if (!condition) throw new Error(`FACTOR_PRODUCTION_SAFETY_REJECTED: ${message}`);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function weightSum(weights = {}) {
  return Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0);
}

function sameNumber(a, b, tolerance = WEIGHT_TOLERANCE) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
}

function sameWeightVector(a = {}, b = {}) {
  return CURRENT_DOMAINS.every((domain) => sameNumber(Number(a?.[domain]), Number(b?.[domain]))) &&
    Object.keys(a || {}).length === CURRENT_DOMAINS.length &&
    Object.keys(b || {}).length === CURRENT_DOMAINS.length;
}

function validateWeightVector(weights, label, { requireCurrent = false } = {}) {
  assert(weights && typeof weights === 'object' && !Array.isArray(weights), `${label} missing`);
  assert(Object.keys(weights).length === CURRENT_DOMAINS.length, `${label} domain count mismatch`);
  for (const domain of CURRENT_DOMAINS) {
    const value = finiteNumber(weights[domain]);
    assert(value !== null && value >= 0 && value <= 1, `${label} invalid ${domain} weight`);
  }
  assert(Math.abs(weightSum(weights) - 1) <= WEIGHT_TOLERANCE, `${label} does not sum to 1`);
  if (requireCurrent) assert(sameWeightVector(weights, CURRENT_WEIGHTS), `${label} differs from current model weights`);
}

function assertFalse(value, label) {
  assert(value === false, `${label} must be false`);
}

function requireStatus(report, key, expectedFormat) {
  const status = report?.[key];
  assert(status && typeof status === 'object', `${key} missing`);
  assert(status.format === expectedFormat, `${key} wrong format`);
  return status;
}

function safeCount(value) {
  return nonNegativeInteger(value) ?? 0;
}

export function buildForecastFactorOperationalTelemetry(input = {}) {
  const learning = input.forecastFactorLearningStatus || input.factorLearningStatus || {};
  const attribution = input.forecastFactorAttributionStatus || input.factorAttributionStatus || {};
  const governance = input.forecastFactorWeightGovernanceStatus || input.factorWeightGovernanceStatus || {};
  return {
    forecastFactorObservabilityContract: FORECAST_FACTOR_PRODUCTION_OBSERVABILITY_CONTRACT,
    forecastFactorLearningLineageRecordCount: safeCount(learning.lineageRecordCount),
    forecastFactorLearningMaturedScoredCount: safeCount(learning.maturedScoredCount),
    forecastFactorLearningPromotionCandidateGroupCount: safeCount(learning.promotionCandidateGroupCount),
    forecastFactorAttributionLineageRecordCount: safeCount(attribution.lineageRecordCount),
    forecastFactorAttributionManualWeightReviewCandidateCount: safeCount(attribution.manualWeightReviewCandidateCount),
    forecastFactorGovernanceLineageRecordCount: safeCount(governance.lineageRecordCount),
    forecastFactorGovernanceGroupCount: safeCount(governance.groupCount),
    forecastFactorGovernanceProposalCount: safeCount(governance.proposalCount),
    forecastFactorGovernanceStatus: governance.status || null,
    forecastFactorAutomaticWeightAdjustmentEnabled: governance.automaticWeightAdjustmentEnabled ?? null,
    forecastFactorAutomaticProposalApplicationEnabled: governance.automaticProposalApplicationEnabled ?? null,
    forecastFactorProbabilityCalibrationEnabled: governance.probabilityCalibrationEnabled ?? null,
    forecastFactorDecisionIntegrationEnabled: governance.decisionIntegrationEnabled ?? null,
    forecastFactorMayInfluenceFinalAction: governance.forecastMayInfluenceFinalAction ?? null,
  };
}

function verifyLearningStatus(learning) {
  assertFalse(learning.probabilityCalibrationEnabled, 'factor learning probability calibration');
  assertFalse(learning.decisionIntegrationEnabled, 'factor learning decision integration');
  assertFalse(learning.forecastMayInfluenceFinalAction, 'factor learning final-action influence');
  const groups = Array.isArray(learning.groups) ? learning.groups : [];
  assert(nonNegativeInteger(learning.groupCount) === groups.length, 'factor learning group count mismatch');
  const candidates = groups.filter((group) => group?.status === 'PROMOTION_CANDIDATE').length;
  assert(nonNegativeInteger(learning.promotionCandidateGroupCount) === candidates, 'factor learning promotion count mismatch');
}

function verifyAttributionStatus(attribution) {
  assertFalse(attribution.automaticWeightAdjustmentEnabled, 'factor attribution automatic weight adjustment');
  assertFalse(attribution.decisionIntegrationEnabled, 'factor attribution decision integration');
  assertFalse(attribution.forecastMayInfluenceFinalAction, 'factor attribution final-action influence');
  const groups = Array.isArray(attribution.groups) ? attribution.groups : [];
  assert(nonNegativeInteger(attribution.groupCount) === groups.length, 'factor attribution group count mismatch');
  const candidates = groups.reduce((sum, group) => sum + (Array.isArray(group?.domains) ? group.domains.filter((domain) => domain?.manualWeightReviewCandidate === true).length : 0), 0);
  assert(nonNegativeInteger(attribution.manualWeightReviewCandidateCount) === candidates, 'factor attribution manual-review count mismatch');
}

function verifyProposal(proposal, index) {
  const prefix = `governance proposal ${index}`;
  assert(typeof proposal?.proposalId === 'string' && proposal.proposalId.length > 0, `${prefix} missing id`);
  assert(proposal.reviewState === 'MANUAL_REVIEW_REQUIRED', `${prefix} is not manual review`);
  assert(proposal.factorFeatureVectorPolicyVersion === FORECAST_FEATURE_VECTOR_VERSION, `${prefix} feature-vector lineage mismatch`);
  assert(proposal.factorScorePolicyVersion === FORECAST_FACTOR_SCORE_VERSION, `${prefix} factor-score lineage mismatch`);
  assert(CURRENT_DOMAINS.includes(proposal.domain), `${prefix} unknown domain`);
  assert(['INCREASE_REVIEW', 'DECREASE_REVIEW'].includes(proposal.direction), `${prefix} invalid direction`);
  assertFalse(proposal.automaticApplicationAllowed, `${prefix} automatic application`);
  assert(proposal.requiresNewPolicyVersionOnApproval === true, `${prefix} missing new-version requirement`);
  assertFalse(proposal.probabilityCalibrationEnabled, `${prefix} probability calibration`);
  assertFalse(proposal.decisionIntegrationEnabled, `${prefix} decision integration`);
  assertFalse(proposal.forecastMayInfluenceFinalAction, `${prefix} final-action influence`);

  validateWeightVector(proposal.beforeWeights, `${prefix} beforeWeights`, { requireCurrent: true });
  validateWeightVector(proposal.afterWeights, `${prefix} afterWeights`);
  assert(sameNumber(Number(proposal.beforeWeightSum), 1), `${prefix} beforeWeightSum mismatch`);
  assert(sameNumber(Number(proposal.afterWeightSum), 1), `${prefix} afterWeightSum mismatch`);
  assert(sameNumber(Number(proposal.currentWeight), Number(proposal.beforeWeights[proposal.domain])), `${prefix} currentWeight mismatch`);
  assert(sameNumber(Number(proposal.proposedWeight), Number(proposal.afterWeights[proposal.domain])), `${prefix} proposedWeight mismatch`);
  const delta = Number(proposal.afterWeights[proposal.domain]) - Number(proposal.beforeWeights[proposal.domain]);
  assert(sameNumber(Number(proposal.directWeightDelta), delta), `${prefix} direct delta mismatch`);
  assert(Math.abs(delta) <= MAX_DIRECT_WEIGHT_DELTA, `${prefix} direct delta exceeds bound`);
  assert(Number(proposal.afterWeights.RISK) + WEIGHT_TOLERANCE >= Number(proposal.beforeWeights.RISK), `${prefix} reduces RISK weight`);

  const rollback = proposal.rollbackPlan;
  assert(rollback?.strategy === 'RESTORE_BEFORE_WEIGHTS_WITH_NEW_POLICY_VERSION', `${prefix} rollback strategy missing`);
  assert(rollback?.rewriteHistoricalOosRecords === false, `${prefix} rewrites historical OOS records`);
  assert(rollback?.restoreFeatureVectorPolicyVersionReference === FORECAST_FEATURE_VECTOR_VERSION, `${prefix} rollback feature-vector lineage mismatch`);
  assert(rollback?.restoreFactorScorePolicyVersionReference === FORECAST_FACTOR_SCORE_VERSION, `${prefix} rollback factor-score lineage mismatch`);
  validateWeightVector(rollback?.restoreWeights, `${prefix} rollback restoreWeights`, { requireCurrent: true });
  assert(sameWeightVector(rollback.restoreWeights, proposal.beforeWeights), `${prefix} rollback does not restore beforeWeights`);
}

function verifyGovernanceStatus(governance) {
  assert(governance.currentFeatureVectorPolicyVersion === FORECAST_FEATURE_VECTOR_VERSION, 'governance current feature-vector version mismatch');
  assert(governance.currentFactorScorePolicyVersion === FORECAST_FACTOR_SCORE_VERSION, 'governance current factor-score version mismatch');
  validateWeightVector(governance.currentWeights, 'governance currentWeights', { requireCurrent: true });
  assertFalse(governance.automaticWeightAdjustmentEnabled, 'governance automatic weight adjustment');
  assertFalse(governance.automaticProposalApplicationEnabled, 'governance automatic proposal application');
  assertFalse(governance.probabilityCalibrationEnabled, 'governance probability calibration');
  assertFalse(governance.decisionIntegrationEnabled, 'governance decision integration');
  assertFalse(governance.forecastMayInfluenceFinalAction, 'governance final-action influence');

  const groups = Array.isArray(governance.groups) ? governance.groups : [];
  const proposals = Array.isArray(governance.proposals) ? governance.proposals : [];
  assert(nonNegativeInteger(governance.groupCount) === groups.length, 'governance group count mismatch');
  assert(nonNegativeInteger(governance.proposalCount) === proposals.length, 'governance proposal count mismatch');
  const groupProposalCount = groups.reduce((sum, group) => {
    const items = Array.isArray(group?.proposals) ? group.proposals : [];
    assert(nonNegativeInteger(group?.proposalCount) === items.length, `governance group proposal count mismatch: ${group?.assetClass || 'UNKNOWN'}:${group?.horizon || 'UNKNOWN'}`);
    return sum + items.length;
  }, 0);
  assert(groupProposalCount === proposals.length, 'governance group/global proposal count mismatch');

  const ids = new Set();
  proposals.forEach((proposal, index) => {
    verifyProposal(proposal, index);
    assert(!ids.has(proposal.proposalId), `duplicate governance proposal id: ${proposal.proposalId}`);
    ids.add(proposal.proposalId);
  });
}

function verifyOperationalTelemetry(report, expected) {
  const health = report?.operationalHealth;
  assert(health && typeof health === 'object', 'operationalHealth missing');
  for (const [key, expectedValue] of Object.entries(expected)) {
    assert(Object.prototype.hasOwnProperty.call(health, key), `operationalHealth telemetry missing: ${key}`);
    assert(health[key] === expectedValue, `operationalHealth telemetry mismatch: ${key}`);
  }
  const serialized = JSON.stringify(health);
  for (const forbidden of ['"beforeWeights"', '"afterWeights"', '"factorDomainSnapshot"', '"automaticApplicationAllowed"']) {
    assert(!serialized.includes(forbidden), `raw factor governance payload leaked into operationalHealth: ${forbidden}`);
  }
}

export function verifyForecastFactorProductionSafety(report = {}) {
  const learning = requireStatus(report, 'forecastFactorLearningStatus', 'investor-control-forecast-factor-learning-status');
  const attribution = requireStatus(report, 'forecastFactorAttributionStatus', 'investor-control-forecast-factor-attribution-status');
  const governance = requireStatus(report, 'forecastFactorWeightGovernanceStatus', 'investor-control-forecast-factor-weight-governance-status');
  verifyLearningStatus(learning);
  verifyAttributionStatus(attribution);
  verifyGovernanceStatus(governance);
  const expectedTelemetry = buildForecastFactorOperationalTelemetry(report);
  verifyOperationalTelemetry(report, expectedTelemetry);
  return {
    status: 'VERIFIED',
    contract: FORECAST_FACTOR_PRODUCTION_OBSERVABILITY_CONTRACT,
    telemetry: expectedTelemetry,
  };
}
