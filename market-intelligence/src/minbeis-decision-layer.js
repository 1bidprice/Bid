export const MINBEIS_ACTIONS = Object.freeze({
  NO_BUY: 'NO_BUY',
  WATCH: 'WATCH',
  HOLD: 'HOLD',
  REDUCE: 'REDUCE',
  BUY_PROBE: 'BUY_PROBE',
  BUY_STARTER: 'BUY_STARTER',
  BUY_CORE: 'BUY_CORE',
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function baseDecision(action, allocationPct, reason, finalAction) {
  return {
    format: 'investor-control-minbeis-decision',
    version: 1,
    action,
    allocationPct,
    reason,
    humanApprovalRequired: true,
    automaticBrokerOrder: false,
    sourcePolicyVersion: finalAction?.policyVersion || null,
    sourceStatus: finalAction?.status || null,
    confidenceScore: Number.isFinite(Number(finalAction?.confidenceScore))
      ? clamp(finalAction.confidenceScore, 0, 100)
      : null,
    dataQualityScore: Number.isFinite(Number(finalAction?.dataQualityScore))
      ? clamp(finalAction.dataQualityScore, 0, 100)
      : null,
    blockers: Array.isArray(finalAction?.blockers) ? finalAction.blockers : [],
  };
}

export function buildMinbeisDecision({
  finalAction,
  opportunityPurchase = null,
  hasPosition = false,
} = {}) {
  if (!finalAction || finalAction.status !== 'FINAL') {
    return baseDecision(
      MINBEIS_ACTIONS.NO_BUY,
      0,
      'FINAL_ACTION_NOT_AVAILABLE',
      finalAction,
    );
  }

  const activeAction = hasPosition
    ? finalAction.holderAction
    : finalAction.nonHolderAction;

  if (hasPosition) {
    if (activeAction === 'SELL_NOW') {
      return baseDecision(MINBEIS_ACTIONS.REDUCE, 0, 'FINAL_POLICY_SELL_NOW', finalAction);
    }
    if (activeAction === 'HOLD') {
      return baseDecision(MINBEIS_ACTIONS.HOLD, 0, 'FINAL_POLICY_HOLD', finalAction);
    }
    return baseDecision(MINBEIS_ACTIONS.WATCH, 0, 'NO_HOLDER_EXECUTION_SIGNAL', finalAction);
  }

  if (activeAction === 'AVOID' || activeAction === 'DO_NOT_BUY') {
    return baseDecision(MINBEIS_ACTIONS.NO_BUY, 0, 'FINAL_POLICY_BLOCKS_NEW_BUY', finalAction);
  }

  if (activeAction !== 'BUY_NOW') {
    return baseDecision(MINBEIS_ACTIONS.WATCH, 0, 'FINAL_POLICY_WATCH', finalAction);
  }

  const purchaseConfirmed =
    opportunityPurchase?.status === 'BUY_CONFIRMED' &&
    opportunityPurchase?.buyNowEligible === true;

  if (!purchaseConfirmed) {
    return baseDecision(
      MINBEIS_ACTIONS.NO_BUY,
      0,
      'BUY_NOW_REQUIRES_CONFIRMED_PURCHASE_RECONCILIATION',
      finalAction,
    );
  }

  const opportunityScore = Number(opportunityPurchase?.opportunityScore);
  const confidence = Number(finalAction?.confidenceScore);
  const quality = Number(finalAction?.dataQualityScore);

  const starterEligible =
    Number.isFinite(opportunityScore) &&
    opportunityScore >= 88 &&
    Number.isFinite(confidence) &&
    confidence >= 85 &&
    Number.isFinite(quality) &&
    quality >= 85;

  if (starterEligible) {
    return baseDecision(
      MINBEIS_ACTIONS.BUY_STARTER,
      1.0,
      'STRICT_BUY_CONFIRMED_HIGH_QUALITY_STARTER',
      finalAction,
    );
  }

  return baseDecision(
    MINBEIS_ACTIONS.BUY_PROBE,
    0.5,
    'STRICT_BUY_CONFIRMED_PROBE',
    finalAction,
  );
}
