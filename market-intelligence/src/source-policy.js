export const SOURCE_POLICY_VERSION = '2026-07-28.1';

export const SOURCE_POLICY = Object.freeze({
  official: Object.freeze([
    { id: 'sec-current-filings', authority: 'SEC', purpose: 'US market-wide event discovery', tier: 1 },
    { id: 'sec-submissions', authority: 'SEC', purpose: 'Company filing history', tier: 1 },
    { id: 'sec-companyfacts', authority: 'SEC', purpose: 'Structured US fundamentals', tier: 1 },
    { id: 'issuer-regulatory', authority: 'Issuer / exchange', purpose: 'Official company announcements', tier: 1 },
  ]),
  independentPublishers: Object.freeze({
    reuters: { name: 'Reuters', reliabilityTier: 2 },
    bloomberg: { name: 'Bloomberg', reliabilityTier: 2 },
    'financial times': { name: 'Financial Times', reliabilityTier: 2 },
    'the wall street journal': { name: 'The Wall Street Journal', reliabilityTier: 2 },
    'associated press': { name: 'Associated Press', reliabilityTier: 2 },
    cnbc: { name: 'CNBC', reliabilityTier: 3 },
    marketwatch: { name: 'MarketWatch', reliabilityTier: 3 },
    fortune: { name: 'Fortune', reliabilityTier: 3 },
  }),
  rules: Object.freeze({
    runtimeDomainExpansion: false,
    socialMediaRecommendationEvidence: false,
    primarySourceRequiredForFinalAction: true,
    independentClaimConfirmationRequired: true,
    unresolvedContradictionBlocksAction: true,
    staleReferencePriceBlocksAction: true,
  }),
});

export function sourcePolicySummary() {
  return {
    version: SOURCE_POLICY_VERSION,
    selector: 'VERSIONED_CODE_POLICY',
    runtimeAiSourceSelection: false,
    officialSourceCount: SOURCE_POLICY.official.length,
    independentPublisherCount: Object.keys(SOURCE_POLICY.independentPublishers).length,
    rules: SOURCE_POLICY.rules,
  };
}

export function independentPublisherPolicies() {
  return SOURCE_POLICY.independentPublishers;
}
