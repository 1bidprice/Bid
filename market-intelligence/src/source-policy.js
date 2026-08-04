import {
  SOURCE_GOVERNOR_VERSION,
  independentPublisherPolicies as governedIndependentPublishers,
  sourceGovernorSummary,
} from './source-governor.js';

export const SOURCE_POLICY_VERSION = SOURCE_GOVERNOR_VERSION;

export const SOURCE_POLICY = Object.freeze({
  selector: 'DETERMINISTIC_SOURCE_GOVERNOR',
  rules: Object.freeze({
    runtimeDomainExpansion: false,
    runtimeAiMayProposeSources: true,
    runtimeAiMayApproveSources: false,
    socialMediaRecommendationEvidence: false,
    primarySourceRequiredForFinalAction: true,
    independentClaimConfirmationRequired: true,
    unresolvedContradictionBlocksAction: true,
    staleReferencePriceBlocksAction: true,
    rawProviderErrorsHiddenFromUsers: true,
  }),
});

export function sourcePolicySummary() {
  return {
    ...sourceGovernorSummary(),
    rules: SOURCE_POLICY.rules,
  };
}

export function independentPublisherPolicies() {
  return Object.fromEntries(
    Object.entries(governedIndependentPublishers()).map(([key, publisher]) => [key, {
      ...publisher,
      reliabilityTier: Number(publisher.reliabilityTier || publisher.tier || 3),
    }]),
  );
}
