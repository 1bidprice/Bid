function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function evaluateSignalReadiness(input = {}) {
  const blockers = [];
  const documentReviewed = input.evidence?.document?.reviewed === true;
  const fundamentalsReady = input.fundamentals?.metricsReady === true;
  const marketMetricsReady = input.marketMetrics?.readiness?.marketMetricsReady === true;
  const crossCheckReady = input.crossCheck?.recommendationReady === true;
  const thesisReady = typeof input.thesis === 'string' && input.thesis.trim().length >= 80;
  const invalidationReady = typeof input.invalidationCondition === 'string' && input.invalidationCondition.trim().length >= 20;
  const risksReady = Array.isArray(input.risks) && input.risks.filter(Boolean).length >= 2;

  if (!documentReviewed) blockers.push('DOCUMENT_REVIEW_REQUIRED');
  if (!fundamentalsReady) blockers.push('FUNDAMENTALS_REQUIRED');
  if (!marketMetricsReady) blockers.push('HISTORICAL_MARKET_METRICS_REQUIRED');
  if (!crossCheckReady) blockers.push('INDEPENDENT_CROSS_CHECK_REQUIRED');
  if (!thesisReady) blockers.push('THESIS_REQUIRED');
  if (!invalidationReady) blockers.push('INVALIDATION_CONDITION_REQUIRED');
  if (!risksReady) blockers.push('MATERIAL_RISKS_REQUIRED');

  const publishable = blockers.length === 0;
  return {
    format: 'investor-control-signal-readiness',
    version: 1,
    publishable,
    stage: publishable
      ? 'RECOMMENDATION_READY'
      : documentReviewed
        ? marketMetricsReady && fundamentalsReady
          ? 'EVIDENCE_SYNTHESIS_REQUIRED'
          : 'METRICS_PENDING'
        : 'DOCUMENT_PENDING',
    checks: {
      documentReviewed,
      fundamentalsReady,
      marketMetricsReady,
      crossCheckReady,
      thesisReady,
      invalidationReady,
      risksReady,
    },
    blockers: unique(blockers),
  };
}
