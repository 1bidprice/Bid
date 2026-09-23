export const MINBEIS_MOBILE_ACTIONS = Object.freeze({
  REDUCE: 'REDUCE',
  BUY_STARTER: 'BUY_STARTER',
  BUY_PROBE: 'BUY_PROBE',
  HOLD: 'HOLD',
  WATCH: 'WATCH',
  NO_BUY: 'NO_BUY',
});

function canonicalSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/\.(US|GR)$/i, '');
}

function heldSymbols(positions = []) {
  return new Set((Array.isArray(positions) ? positions : [])
    .filter((position) => Number(position?.quantity || 0) > 0)
    .map((position) => canonicalSymbol(position?.symbol))
    .filter(Boolean));
}

function purchaseIndex(feed) {
  const byCompany = new Map();
  const bySymbol = new Map();
  for (const item of Array.isArray(feed?.opportunityPurchaseDecisions) ? feed.opportunityPurchaseDecisions : []) {
    if (item?.companyId) byCompany.set(String(item.companyId), item);
    const symbol = canonicalSymbol(item?.symbol);
    if (symbol) bySymbol.set(symbol, item);
  }
  return { byCompany, bySymbol };
}

function matchingPurchase(index, item) {
  if (item?.companyId && index.byCompany.has(String(item.companyId))) return index.byCompany.get(String(item.companyId));
  const symbol = canonicalSymbol(item?.symbol);
  return symbol ? index.bySymbol.get(symbol) || null : null;
}

function actionPriority(action) {
  return {
    REDUCE: 100,
    BUY_STARTER: 90,
    BUY_PROBE: 85,
    HOLD: 60,
    WATCH: 40,
    NO_BUY: 20,
  }[action] || 0;
}

function mappedAction(finalAction, owned, purchase) {
  const sourceAction = owned ? finalAction?.holderAction : finalAction?.nonHolderAction;

  if (owned) {
    if (sourceAction === 'SELL_NOW') return { action: MINBEIS_MOBILE_ACTIONS.REDUCE, reason: 'HOLDER_SELL_NOW' };
    if (sourceAction === 'HOLD') return { action: MINBEIS_MOBILE_ACTIONS.HOLD, reason: 'HOLDER_HOLD' };
    return { action: MINBEIS_MOBILE_ACTIONS.WATCH, reason: 'HOLDER_WATCH' };
  }

  if (sourceAction === 'BUY_NOW') {
    const confirmed = purchase?.status === 'BUY_CONFIRMED' && purchase?.buyNowEligible === true;
    if (!confirmed) return { action: MINBEIS_MOBILE_ACTIONS.NO_BUY, reason: 'BUY_REQUIRES_STRICT_PURCHASE_CONFIRMATION' };
    const serverAction = purchase?.minbeisDecision?.action;
    if (serverAction === 'BUY_STARTER') return { action: MINBEIS_MOBILE_ACTIONS.BUY_STARTER, reason: 'STRICT_PURCHASE_CONFIRMED' };
    return { action: MINBEIS_MOBILE_ACTIONS.BUY_PROBE, reason: 'STRICT_PURCHASE_CONFIRMED' };
  }

  if (sourceAction === 'AVOID' || sourceAction === 'DO_NOT_BUY') {
    return { action: MINBEIS_MOBILE_ACTIONS.NO_BUY, reason: 'NON_HOLDER_BLOCKED' };
  }

  return { action: MINBEIS_MOBILE_ACTIONS.WATCH, reason: 'NON_HOLDER_WATCH' };
}

export function buildPersonalizedMinbeisDashboard(feed, portfolioPositions = [], options = {}) {
  const held = heldSymbols(portfolioPositions);
  const purchases = purchaseIndex(feed);
  const rows = [];

  for (const item of Array.isArray(feed?.decisions) ? feed.decisions : []) {
    const finalAction = item?.finalAction;
    if (!finalAction || finalAction.status !== 'FINAL') continue;
    if (typeof options.isCurrentDecision === 'function' && options.isCurrentDecision(finalAction, item) !== true) continue;

    const symbol = canonicalSymbol(item?.symbol);
    if (!symbol) continue;
    const owned = held.has(symbol);
    const purchase = matchingPurchase(purchases, item);
    const mapped = mappedAction(finalAction, owned, purchase);

    rows.push({
      id: item?.id || item?.companyId || 'symbol:' + symbol,
      companyId: item?.companyId || null,
      companyName: item?.companyName || item?.symbol || symbol,
      symbol: item?.symbol || symbol,
      owned,
      action: mapped.action,
      reason: mapped.reason,
      urgency: finalAction?.urgency || 'NONE',
      validUntil: finalAction?.validUntil || null,
      confidenceScore: Number.isFinite(Number(finalAction?.confidenceScore)) ? Number(finalAction.confidenceScore) : null,
      dataQualityScore: Number.isFinite(Number(finalAction?.dataQualityScore)) ? Number(finalAction.dataQualityScore) : null,
      finalAction,
      purchase: purchase || null,
    });
  }

  rows.sort((a, b) => actionPriority(b.action) - actionPriority(a.action) || String(a.companyName).localeCompare(String(b.companyName)));

  const counts = Object.fromEntries(Object.values(MINBEIS_MOBILE_ACTIONS).map((action) => [action, 0]));
  for (const row of rows) counts[row.action] = (counts[row.action] || 0) + 1;

  return {
    rows,
    counts,
    ownedCount: rows.filter((row) => row.owned).length,
    newIdeaCount: rows.filter((row) => !row.owned).length,
    actionableCount: rows.filter((row) => ['REDUCE', 'BUY_PROBE', 'BUY_STARTER'].includes(row.action)).length,
  };
}
