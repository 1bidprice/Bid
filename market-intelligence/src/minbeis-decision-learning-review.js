export const MINBEIS_DECISION_LEARNING_REVIEW_VERSION = '2026-10-03.1';

const BUY_ACTIONS = new Set(['BUY_PROBE', 'BUY_STARTER', 'BUY_CORE']);
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

function candidateAttributions(record) {
  const context = record?.contextSnapshot || {};
  const decision = context?.decision || {};
  const purchase = context?.purchaseReconciliation || {};
  const research = context?.research || {};
  const candidates = [];

  const confidence = finite(decision.confidenceScore) ? Number(decision.confidenceScore) : finite(record?.confidenceScore) ? Number(record.confidenceScore) : null;
  const quality = finite(decision.dataQualityScore) ? Number(decision.dataQualityScore) : finite(record?.dataQualityScore) ? Number(record.dataQualityScore) : null;

  if (confidence !== null && confidence < 70) candidates.push('LOW_CONFIDENCE_AT_DECISION');
  if (quality !== null && quality < 70) candidates.push('LOW_DATA_QUALITY_AT_DECISION');
  if (Array.isArray(decision.blockers) && decision.blockers.length) candidates.push('DECISION_BLOCKERS_PRESENT');
  if (purchase && purchase.status && purchase.status !== 'BUY_CONFIRMED' && BUY_ACTIONS.has(record?.action)) candidates.push('PURCHASE_RECONCILIATION_FRICTION');
  if (research?.marketRegimeSnapshot) candidates.push('MARKET_REGIME_CONTEXT_REVIEW');
  if ((research?.catalystEventTypes || []).length || research?.leadEventType) candidates.push('EVENT_CONTEXT_REVIEW');
  if (record?.simpleBaselineSnapshot?.status === 'READY') {
    const baselineEntry = record.simpleBaselineSnapshot.action === 'ENTRY';
    const minbeisEntry = BUY_ACTIONS.has(record?.action);
    if (baselineEntry !== minbeisEntry) candidates.push('MINBEIS_BASELINE_DISAGREEMENT');
  }
  return [...new Set(candidates)];
}

export function buildMinbeisDecisionLearningReview(record, options = {}) {
  const horizon = String(options.horizon || '30');
  const outcome = record?.horizons?.[horizon] || null;
  if (!record?.decisionId || !outcome || outcome.status !== 'MATURED') {
    return {
      decisionId: record?.decisionId || null,
      action: record?.action || null,
      horizon,
      status: 'WAITING_FOR_MATURED_OUTCOME',
      reviewRequired: false,
      reviewSignals: [],
      candidateAttributions: [],
      causalityEstablished: false,
      humanReviewRequired: false,
    };
  }

  const realised = finite(outcome.realisedReturnPct) ? Number(outcome.realisedReturnPct) : null;
  const excess = finite(outcome.excessReturnPct) ? Number(outcome.excessReturnPct) : null;
  const adverse = finite(outcome.maxAdverseExcursionPct) ? Number(outcome.maxAdverseExcursionPct) : null;
  const returnThreshold = Math.abs(Number(options.minimumAbsoluteReturnPct ?? 8));
  const excessThreshold = Math.abs(Number(options.minimumAbsoluteExcessPct ?? 5));
  const adverseThreshold = -Math.abs(Number(options.maxAdverseExcursionReviewPct ?? 12));
  const signals = [];

  if (BUY_ACTIONS.has(record.action)) {
    if (realised !== null && realised <= -returnThreshold) signals.push('BUY_NEGATIVE_RETURN_REVIEW');
    if (excess !== null && excess <= -excessThreshold) signals.push('BUY_BENCHMARK_UNDERPERFORMANCE_REVIEW');
    if (adverse !== null && adverse <= adverseThreshold) signals.push('BUY_ADVERSE_EXCURSION_REVIEW');
  } else if (['NO_BUY', 'WATCH'].includes(record.action)) {
    if (realised !== null && excess !== null && realised >= returnThreshold && excess >= excessThreshold) {
      signals.push('MISSED_UPSIDE_REVIEW');
    }
  } else if (record.action === 'REDUCE') {
    if (realised !== null && realised >= returnThreshold && (excess === null || excess >= excessThreshold)) {
      signals.push('REDUCTION_BEFORE_UPSIDE_REVIEW');
    }
  } else if (record.action === 'HOLD') {
    if (realised !== null && realised <= -returnThreshold) signals.push('HOLD_NEGATIVE_RETURN_REVIEW');
    if (adverse !== null && adverse <= adverseThreshold) signals.push('HOLD_ADVERSE_EXCURSION_REVIEW');
  }

  const reviewRequired = signals.length > 0;
  return {
    decisionId: record.decisionId,
    action: record.action,
    horizon,
    status: reviewRequired ? 'REVIEW_REQUIRED' : 'NO_REVIEW_SIGNAL',
    reviewRequired,
    reviewSignals: signals,
    candidateAttributions: reviewRequired ? candidateAttributions(record) : [],
    causalityEstablished: false,
    humanReviewRequired: reviewRequired,
    caution: reviewRequired
      ? 'Candidate attributions are hypotheses for controlled review, not proven causes of the observed outcome.'
      : null,
  };
}

export function summarizeMinbeisDecisionLearningReviews(records = [], options = {}) {
  const reviews = (Array.isArray(records) ? records : []).map((record) => buildMinbeisDecisionLearningReview(record, options));
  const reviewRequired = reviews.filter((item) => item.reviewRequired);
  const bySignal = {};
  const byAction = {};
  for (const item of reviewRequired) {
    byAction[item.action] = (byAction[item.action] || 0) + 1;
    for (const signal of item.reviewSignals) bySignal[signal] = (bySignal[signal] || 0) + 1;
  }
  return {
    format: 'investor-control-minbeis-decision-learning-review',
    version: 1,
    policyVersion: MINBEIS_DECISION_LEARNING_REVIEW_VERSION,
    horizon: String(options.horizon || '30'),
    trackedDecisionCount: reviews.length,
    maturedDecisionCount: reviews.filter((item) => item.status !== 'WAITING_FOR_MATURED_OUTCOME').length,
    reviewRequiredCount: reviewRequired.length,
    byAction,
    bySignal,
    reviews,
    automaticModelMutationAllowed: false,
    promotionRequiresGovernedValidation: true,
  };
}
