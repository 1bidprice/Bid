import { classifyFundamentalModel } from './fundamental-model.js';

export const OPPORTUNITY_MODEL_GATE_VERSION = '2026-08-09.1';

export function gateBroadEquityOpportunityCandidate(candidate = {}) {
  const model = classifyFundamentalModel(candidate);
  const eligible =
    model.type === 'GENERIC_OPERATING' &&
    model.genericValuationEligible === true &&
    model.specializedModelRequired !== true;
  return {
    eligible,
    stage: 'BROAD_IDENTITY_GATE',
    model,
    reason: eligible ? 'GENERIC_OPERATING_IDENTITY' : 'SPECIALIZED_MODEL_REQUIRES_DEDICATED_OPPORTUNITY_LANE',
    policyVersion: OPPORTUNITY_MODEL_GATE_VERSION,
  };
}

export function gateDeepEquityOpportunityModel(profile = {}, fundamentals = null) {
  const model = fundamentals?.model || null;
  const eligible =
    profile?.assetClass === 'EQUITY' &&
    profile?.analysisModel === 'EQUITY_OPERATING' &&
    model?.type === 'GENERIC_OPERATING' &&
    model?.genericValuationEligible === true &&
    model?.specializedModelRequired !== true &&
    model?.modelReady !== false;
  let reason = 'GENERIC_OPERATING_MODEL_VERIFIED';
  if (!model) reason = 'FUNDAMENTAL_MODEL_NOT_VERIFIED';
  else if (model.specializedModelRequired === true || model.type !== 'GENERIC_OPERATING') reason = 'SPECIALIZED_MODEL_REQUIRES_DEDICATED_OPPORTUNITY_LANE';
  else if (profile?.assetClass !== 'EQUITY' || profile?.analysisModel !== 'EQUITY_OPERATING') reason = 'INSTRUMENT_PROFILE_NOT_GENERIC_OPERATING_EQUITY';
  else if (model.modelReady === false || model.genericValuationEligible !== true) reason = 'GENERIC_MODEL_NOT_READY';
  return {
    eligible,
    stage: 'DEEP_FUNDAMENTAL_GATE',
    model,
    reason,
    policyVersion: OPPORTUNITY_MODEL_GATE_VERSION,
  };
}
