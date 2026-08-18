import { contentHash } from './content-hash.js';
import { FORECAST_FACTOR_DOMAIN_WEIGHTS } from './forecast-feature-vector.js';

export const FORECAST_REGIME_FACTOR_GOVERNANCE_PRODUCTION_SAFETY_VERSION = '2026-08-12.1';

function assert(condition, message) {
  if (!condition) throw new Error(`Forecast regime-factor governance production safety: ${message}`);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function authorityDisabled(object, prefix) {
  assert(object?.researchOnly === true, `${prefix} must remain research-only`);
  for (const field of [
    'automaticRegimeWeightingEnabled',
    'automaticFactorReweightingEnabled',
    'automaticProposalApplicationEnabled',
    'probabilityCalibrationEnabled',
    'decisionIntegrationEnabled',
    'forecastMayInfluenceFinalAction',
  ]) {
    if (Object.prototype.hasOwnProperty.call(object || {}, field)) assert(object[field] === false, `${prefix} ${field} must remain false`);
  }
}

function weightSum(weights = {}) {
  return Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0);
}

function assertCurrentWeights(weights, prefix) {
  const domains = Object.keys(FORECAST_FACTOR_DOMAIN_WEIGHTS);
  assert(weights && typeof weights === 'object' && !Array.isArray(weights), `${prefix} weights missing`);
  assert(Object.keys(weights).sort().join('|') === domains.slice().sort().join('|'), `${prefix} weight domains mismatch`);
  for (const domain of domains) assert(Math.abs(Number(weights[domain]) - Number(FORECAST_FACTOR_DOMAIN_WEIGHTS[domain])) <= 1e-6, `${prefix} global weight mutated for ${domain}`);
  assert(Math.abs(weightSum(weights) - 1) <= 1e-6, `${prefix} weights do not sum to 1`);
}

function verifyIndependenceEvidence(proposal, prefix) {
  const evidence = proposal?.evidence || {};
  const sample = evidence.sampleIndependence;
  assert(sample?.status === 'INDEPENDENCE_READY', `${prefix} sample independence not ready`);
  assert(finiteNumber(sample?.thresholds?.minimumDistinctForecastDates) >= 40, `${prefix} distinct-date threshold too weak`);
  assert(finiteNumber(sample?.thresholds?.minimumDistinctInstruments) >= 10, `${prefix} distinct-instrument threshold too weak`);
  assert(finiteNumber(sample?.thresholds?.maximumSingleForecastDateSharePct) <= 10, `${prefix} date concentration threshold too weak`);

  const windows = evidence.outcomeWindowIndependence;
  assert(windows?.status === 'WINDOW_INDEPENDENCE_READY', `${prefix} outcome-window independence not ready`);
  assert(finiteNumber(windows?.thresholds?.minimumEffectiveNonOverlappingWindows) >= 12, `${prefix} outcome-window threshold too weak`);
  assert(nonNegativeInteger(windows?.invalidWindowRecordCount) === 0, `${prefix} invalid outcome windows present`);

  const instruments = evidence.instrumentConcentration;
  assert(instruments?.status === 'INSTRUMENT_DIVERSIFICATION_READY', `${prefix} instrument diversification not ready`);
  assert(finiteNumber(instruments?.thresholds?.maximumSingleInstrumentSharePct) <= 25, `${prefix} instrument concentration threshold too weak`);
  assert(finiteNumber(instruments?.thresholds?.minimumEffectiveInstrumentCount) >= 6, `${prefix} effective instrument threshold too weak`);
  assert(nonNegativeInteger(instruments?.missingInstrumentIdentityCount) === 0, `${prefix} missing instrument identities`);

  const taxonomy = evidence.taxonomyConcentration;
  assert(taxonomy?.status === 'TAXONOMY_DIVERSIFICATION_READY', `${prefix} taxonomy diversification not ready`);
  assert(taxonomy?.crossTaxonomyMappingUsed === false, `${prefix} cross-taxonomy mapping forbidden`);
  assert(taxonomy?.inferenceUsed === false, `${prefix} taxonomy inference forbidden`);
  assert(taxonomy?.decisionImpact === 'NONE', `${prefix} taxonomy decision impact forbidden`);
  assert(finiteNumber(taxonomy?.thresholds?.minimumClassificationCoveragePct) >= 90, `${prefix} classification coverage threshold too weak`);
  assert(finiteNumber(taxonomy?.thresholds?.maximumSingleNativeClusterSharePct) <= 30, `${prefix} native cluster concentration threshold too weak`);
  assert(finiteNumber(taxonomy?.thresholds?.minimumEffectiveNativeClusterCount) >= 4, `${prefix} effective native cluster threshold too weak`);
  assert(nonNegativeInteger(taxonomy?.invalidClassificationSnapshotCount) === 0, `${prefix} invalid classification snapshots present`);
  assert(nonNegativeInteger(taxonomy?.nativeClusterMissingCount) === 0, `${prefix} native taxonomy cluster missing`);
}

function verifyTemporalStability(stability, prefix) {
  assert(stability?.status === 'STABILITY_READY' && stability?.stableAcrossSubperiods === true, `${prefix} temporal stability not ready`);
  const thresholds = stability?.thresholds || {};
  assert(finiteNumber(thresholds.blockCount) >= 3, `${prefix} temporal block count too weak`);
  assert(finiteNumber(thresholds.minimumBlockSample) >= 40, `${prefix} temporal block sample too weak`);
  assert(finiteNumber(thresholds.minimumBlockClassCount) >= 10, `${prefix} temporal block class support too weak`);
  const subperiods = Array.isArray(stability?.subperiods) ? stability.subperiods : [];
  assert(subperiods.length >= 3 && subperiods.every((period) => period?.status === 'STABLE' && Array.isArray(period?.blockers) && period.blockers.length === 0), `${prefix} temporal subperiods not all stable`);
}

function verifyProposal(proposal, prefix) {
  authorityDisabled(proposal, prefix);
  assert(proposal?.scope === 'REGIME_ONLY_MANUAL_REVIEW', `${prefix} scope must remain regime-only`);
  assert(proposal?.changesGlobalWeights === false, `${prefix} cannot change global weights`);
  assert(proposal?.reviewState === 'MANUAL_REVIEW_REQUIRED', `${prefix} manual review state required`);
  assert(proposal?.automaticApplicationAllowed === false, `${prefix} automatic application forbidden`);
  assert(proposal?.requiresNewRegimePolicyVersionOnApproval === true, `${prefix} new regime policy version required`);
  assert(typeof proposal?.regimeKey === 'string' && proposal.regimeKey.length > 0, `${prefix} regime key missing`);
  assert(typeof proposal?.domain === 'string' && Object.prototype.hasOwnProperty.call(FORECAST_FACTOR_DOMAIN_WEIGHTS, proposal.domain), `${prefix} domain invalid`);
  assert(['INCREASE_REVIEW', 'DECREASE_REVIEW'].includes(proposal?.direction), `${prefix} direction invalid`);
  const delta = finiteNumber(proposal?.directWeightDelta);
  assert(delta !== null && Math.abs(delta) > 0 && Math.abs(delta) <= 0.01, `${prefix} delta exceeds 0.01 bound`);
  assert((proposal.direction === 'INCREASE_REVIEW' && delta > 0) || (proposal.direction === 'DECREASE_REVIEW' && delta < 0), `${prefix} delta direction mismatch`);
  if (proposal.domain === 'RISK') assert(proposal.direction !== 'DECREASE_REVIEW', `${prefix} reduces RISK weight`);

  assertCurrentWeights(proposal.beforeGlobalWeights, `${prefix} beforeGlobalWeights`);
  const reviewWeights = proposal?.reviewRegimeWeights;
  assert(reviewWeights && typeof reviewWeights === 'object' && !Array.isArray(reviewWeights), `${prefix} review regime weights missing`);
  assert(Math.abs(weightSum(reviewWeights) - 1) <= 1e-6, `${prefix} review regime weights do not sum to 1`);
  assert(Number(reviewWeights.RISK) + 1e-6 >= Number(proposal.beforeGlobalWeights.RISK), `${prefix} review vector reduces RISK weight`);
  assert(Math.abs(Number(reviewWeights[proposal.domain]) - Number(proposal.proposedRegimeWeight)) <= 1e-6, `${prefix} proposed regime weight mismatch`);
  assert(Math.abs(Number(proposal.proposedRegimeWeight) - (Number(proposal.currentGlobalWeight) + delta)) <= 1e-6, `${prefix} direct delta mismatch`);

  const evidence = proposal?.evidence || {};
  assert(evidence.upstreamRegimeResearchStatus === 'REGIME_RESEARCH_READY', `${prefix} upstream regime research not ready`);
  assert(evidence.upstreamRegimeFactorStatus === 'REGIME_FACTOR_RESEARCH_READY', `${prefix} upstream regime-factor research not ready`);
  if (proposal.direction === 'INCREASE_REVIEW') assert(evidence.upstreamRegimeFactorSignal === 'SUPPORTED_IN_REGIME', `${prefix} upstream signal does not support increase`);
  if (proposal.direction === 'DECREASE_REVIEW') assert(evidence.upstreamRegimeFactorSignal === 'INVERTED_IN_REGIME', `${prefix} upstream signal does not support decrease`);
  assert(nonNegativeInteger(evidence.maturedSampleSize) >= 200, `${prefix} matured sample too small`);
  assert(nonNegativeInteger(evidence.positiveCount) >= 40 && nonNegativeInteger(evidence.negativeCount) >= 40, `${prefix} class support too small`);
  assert(finiteNumber(evidence.featureCoveragePct) >= 80, `${prefix} feature coverage too low`);
  verifyIndependenceEvidence(proposal, prefix);
  verifyTemporalStability(evidence.temporalStability, prefix);

  const rollback = proposal?.rollbackPlan;
  assert(rollback?.restoreCurrentGlobalWeights === true, `${prefix} rollback global-weight restoration missing`);
  assert(rollback?.removeRegimeOverlay === true, `${prefix} rollback regime-overlay removal missing`);
  assert(rollback?.rewriteHistoricalOosRecords === false, `${prefix} rollback rewrites historical OOS records`);

  const { proposalId, ...payload } = proposal;
  assert(proposalId === contentHash(payload), `${prefix} proposal id/content hash mismatch`);
}

export function buildForecastRegimeFactorGovernanceOperationalTelemetry(status = null) {
  return {
    forecastRegimeFactorGovernanceObservabilityContract: 'REGIME_FACTOR_WEIGHT_GOVERNANCE_OBSERVABILITY_V1',
    forecastRegimeFactorGovernanceLineageRecordCount: Number(status?.lineageRecordCount || 0),
    forecastRegimeFactorGovernanceGroupCount: Number(status?.groupCount || 0),
    forecastRegimeFactorGovernanceProposalCount: Number(status?.proposalCount || 0),
    forecastRegimeFactorGovernanceStatus: status?.status || 'NO_CURRENT_REGIME_FACTOR_OOS_LINEAGE',
    forecastRegimeFactorGovernanceAutomaticRegimeWeightingEnabled: false,
    forecastRegimeFactorGovernanceAutomaticFactorReweightingEnabled: false,
    forecastRegimeFactorGovernanceAutomaticProposalApplicationEnabled: false,
    forecastRegimeFactorGovernanceProbabilityCalibrationEnabled: false,
    forecastRegimeFactorGovernanceDecisionIntegrationEnabled: false,
    forecastRegimeFactorGovernanceMayInfluenceFinalAction: false,
  };
}

export function verifyForecastRegimeFactorGovernanceProductionSafety(report = {}) {
  const status = report?.forecastRegimeFactorWeightGovernanceStatus;
  assert(status?.format === 'investor-control-forecast-regime-factor-weight-governance-status', 'governance status missing or invalid');
  assert(status?.version === 1, 'governance status version invalid');
  assert(typeof status?.policyVersion === 'string' && status.policyVersion.length > 0, 'governance policy version missing');
  authorityDisabled(status, 'governance status');
  const groups = Array.isArray(status?.groups) ? status.groups : [];
  const proposals = Array.isArray(status?.proposals) ? status.proposals : [];
  assert(nonNegativeInteger(status?.lineageRecordCount) !== null, 'lineage record count invalid');
  assert(nonNegativeInteger(status?.groupCount) === groups.length, 'group count mismatch');
  assert(nonNegativeInteger(status?.proposalCount) === proposals.length, 'proposal count mismatch');

  const groupedProposalIds = [];
  for (const [groupIndex, group] of groups.entries()) {
    authorityDisabled(group, `group ${groupIndex}`);
    const groupProposals = Array.isArray(group?.proposals) ? group.proposals : [];
    assert(nonNegativeInteger(group?.proposalCount) === groupProposals.length, `group ${groupIndex} proposal count mismatch`);
    for (const [proposalIndex, proposal] of groupProposals.entries()) {
      verifyProposal(proposal, `group ${groupIndex} proposal ${proposalIndex}`);
      assert(proposal.assetClass === group.assetClass && proposal.horizon === group.horizon && proposal.regimeKey === group.regimeKey, `group ${groupIndex} proposal scope identity mismatch`);
      groupedProposalIds.push(proposal.proposalId);
    }
  }
  assert(groupedProposalIds.slice().sort().join('|') === proposals.map((proposal) => proposal.proposalId).sort().join('|'), 'top-level proposal set mismatch');
  for (const [index, proposal] of proposals.entries()) verifyProposal(proposal, `proposal ${index}`);

  const expectedTelemetry = buildForecastRegimeFactorGovernanceOperationalTelemetry(status);
  const health = report?.operationalHealth || {};
  for (const [key, expected] of Object.entries(expectedTelemetry)) assert(health[key] === expected, `operational telemetry mismatch for ${key}`);

  return {
    status: 'VERIFIED',
    policyVersion: FORECAST_REGIME_FACTOR_GOVERNANCE_PRODUCTION_SAFETY_VERSION,
    groupCount: groups.length,
    proposalCount: proposals.length,
  };
}
