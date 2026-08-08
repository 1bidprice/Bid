export const DECISION_CORROBORATION_VERSION = '2026-08-08.1';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function analysisReferenceReady(marketSnapshot, marketMetrics) {
  const contract = marketSnapshot?.quoteContract || null;
  if (contract?.analysisReferenceEligible === true || contract?.valuationEligible === true) return true;
  return finite(marketMetrics?.latestClose) !== null && marketMetrics?.latestTimestamp != null;
}

function independentMarketReady(marketSnapshot, marketMetrics) {
  const role = marketSnapshot?.quoteContract?.sourceRole || marketSnapshot?.sourceRole || null;
  const roleReady = ['PRIMARY_EXCHANGE', 'LICENSED_MARKET_DATA', 'SECONDARY_MARKET_DATA'].includes(role);
  return roleReady && marketMetrics?.readiness?.marketMetricsReady === true;
}

function supportedBaselineModel(profile) {
  return ['EQUITY_OPERATING', 'EQUITY_BANK'].includes(profile?.analysisModel);
}

export function assessDecisionCorroboration(input = {}) {
  const profile = input.instrumentProfile || null;
  const fundamentals = input.fundamentals || null;
  const fundamentalRisk = input.fundamentalRisk || null;
  const marketSnapshot = input.marketSnapshot || null;
  const marketMetrics = input.marketMetrics || null;
  const structuredEvidence = Array.isArray(input.structuredEvidence) ? input.structuredEvidence : [];
  const eventCrossCheck = input.eventCrossCheck || null;

  const fundamentalEvidence = structuredEvidence.filter((record) => record?.decisionEvidenceRole === 'FUNDAMENTAL_BASELINE' && record?.document?.reviewed === true);
  const marketEvidence = structuredEvidence.filter((record) => record?.decisionEvidenceRole === 'MARKET_BASELINE' && record?.document?.reviewed === true);
  const fundamentalsReady = fundamentals?.metricsReady === true;
  const riskModelReady = fundamentalRisk?.metricsReady === true;
  const marketMetricsReady = marketMetrics?.readiness?.marketMetricsReady === true;
  const priceReferenceReady = analysisReferenceReady(marketSnapshot, marketMetrics);
  const marketIndependent = independentMarketReady(marketSnapshot, marketMetrics) && marketEvidence.length >= 1;
  const primaryFinancialEvidenceReady = fundamentalEvidence.length >= 1;
  const contradictions = Number(eventCrossCheck?.contradictionCount || 0);
  const modelSupported = supportedBaselineModel(profile);
  const dimensions = unique([
    primaryFinancialEvidenceReady ? 'PRIMARY_STRUCTURED_FUNDAMENTALS' : null,
    marketMetricsReady ? 'HISTORICAL_MARKET_STATE' : null,
    priceReferenceReady ? 'PRICE_REFERENCE' : null,
    marketIndependent ? 'ISSUER_INDEPENDENT_MARKET_DIMENSION' : null,
    riskModelReady ? 'MODEL_SPECIFIC_RISK' : null,
  ]);

  const blockers = [];
  if (!modelSupported) blockers.push('BASELINE_MODEL_NOT_SUPPORTED');
  if (!primaryFinancialEvidenceReady) blockers.push('PRIMARY_FINANCIAL_EVIDENCE_REQUIRED');
  if (!fundamentalsReady) blockers.push('FUNDAMENTALS_REQUIRED');
  if (!riskModelReady) blockers.push('MODEL_SPECIFIC_RISK_REQUIRED');
  if (!marketMetricsReady) blockers.push('HISTORICAL_MARKET_METRICS_REQUIRED');
  if (!priceReferenceReady) blockers.push('ANALYSIS_REFERENCE_PRICE_REQUIRED');
  if (!marketIndependent) blockers.push('INDEPENDENT_MARKET_DIMENSION_REQUIRED');
  if (contradictions > 0) blockers.push('UNRESOLVED_CONTRADICTION');

  return {
    format: 'investor-control-decision-corroboration',
    version: 1,
    policyVersion: DECISION_CORROBORATION_VERSION,
    companyId: input.company?.companyId || profile?.instrumentId || null,
    analysisModel: profile?.analysisModel || null,
    ready: blockers.length === 0,
    decisionBasisEligible: blockers.length === 0 ? 'FUNDAMENTAL_BASELINE' : null,
    dimensions,
    dimensionCount: dimensions.length,
    checks: {
      modelSupported,
      primaryFinancialEvidenceReady,
      fundamentalsReady,
      riskModelReady,
      marketMetricsReady,
      priceReferenceReady,
      marketIndependent,
      contradictions,
    },
    blockers,
    evidenceIds: [...fundamentalEvidence, ...marketEvidence].map((record) => record.id),
    eventClaimCorroborated: eventCrossCheck?.recommendationReady === true,
    eventClaimSeparationInvariant: 'DECISION_CORROBORATION_NEVER_UPGRADES_EVENT_CLAIM',
  };
}
