const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function canonicalSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/\.(US|GR)$/i, '');
}

export function applyMinbeisPortfolioSizing(baseDecision, portfolioPositions = [], options = {}) {
  const decision = baseDecision && typeof baseDecision === 'object' ? baseDecision : null;
  if (!decision) {
    return { status: 'BLOCKED', allocationPct: 0, reason: 'MINBEIS_DECISION_REQUIRED', blockers: ['MINBEIS_DECISION_REQUIRED'] };
  }

  if (!['BUY_PROBE', 'BUY_STARTER', 'BUY_CORE'].includes(decision.action)) {
    return { ...decision, portfolioSizingStatus: 'NOT_APPLICABLE', portfolioAdjustedAllocationPct: 0, portfolioSizingBlockers: [] };
  }

  const positions = Array.isArray(portfolioPositions) ? portfolioPositions : [];
  const valued = positions.filter((position) => finite(position?.eurValue) && Number(position.eurValue) >= 0);
  const blockers = [];
  if (positions.length !== valued.length) blockers.push('PORTFOLIO_VALUATION_INCOMPLETE');

  const totalValue = valued.reduce((sum, position) => sum + Number(position.eurValue), 0);
  if (!(totalValue > 0)) blockers.push('PORTFOLIO_TOTAL_VALUE_REQUIRED');

  const symbol = canonicalSymbol(options.symbol || decision.symbol);
  const current = valued.find((position) => canonicalSymbol(position?.symbol) === symbol) || null;
  const currentWeightPct = current && totalValue > 0 ? (Number(current.eurValue) / totalValue) * 100 : 0;
  const maxSinglePositionPct = Number.isFinite(Number(options.maxSinglePositionPct))
    ? clamp(options.maxSinglePositionPct, 0.5, 25)
    : 10;
  const baseAllocationPct = clamp(decision.allocationPct, 0, 100);
  const remainingSingleNameCapacityPct = Math.max(0, maxSinglePositionPct - currentWeightPct);
  const adjusted = Math.min(baseAllocationPct, remainingSingleNameCapacityPct);

  if (remainingSingleNameCapacityPct <= 0) blockers.push('SINGLE_POSITION_CAP_REACHED');
  if (adjusted <= 0) blockers.push('NO_PORTFOLIO_CAPACITY');

  return {
    ...decision,
    portfolioSizingStatus: blockers.length ? 'BLOCKED' : adjusted < baseAllocationPct ? 'CAPPED' : 'PASS',
    portfolioAdjustedAllocationPct: blockers.length ? 0 : Number(adjusted.toFixed(2)),
    baseAllocationPct,
    currentPositionWeightPct: Number(currentWeightPct.toFixed(2)),
    maxSinglePositionPct,
    portfolioSizingBlockers: [...new Set(blockers)],
    portfolioSizingNote: blockers.length
      ? 'Η προσωπική κατανομή δεν επιτρέπει νέα θέση μέχρι να είναι πλήρης η αποτίμηση και να υπάρχει διαθέσιμο όριο συγκέντρωσης.'
      : adjusted < baseAllocationPct
        ? 'Η βασική πρόταση MINBEIS μειώθηκε από το προσωπικό όριο συγκέντρωσης.'
        : 'Η βασική πρόταση MINBEIS χωρά στο τρέχον όριο συγκέντρωσης.',
  };
}
