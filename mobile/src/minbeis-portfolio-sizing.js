export const CONCENTRATION_POLICY_MODES = Object.freeze({
  INFORM_ONLY: 'INFORM_ONLY',
  USER_LIMIT: 'USER_LIMIT',
  NO_LIMIT: 'NO_LIMIT',
});

const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function canonicalSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/\.(US|GR)$/i, '');
}

function concentrationBand(weightPct) {
  const value = Number(weightPct);
  if (!Number.isFinite(value)) return 'UNKNOWN';
  if (value >= 80) return 'EXTREME';
  if (value >= 50) return 'VERY_HIGH';
  if (value >= 25) return 'HIGH';
  if (value >= 10) return 'ELEVATED';
  return 'DIVERSIFIED';
}

export function applyMinbeisPortfolioSizing(baseDecision, portfolioPositions = [], options = {}) {
  const decision = baseDecision && typeof baseDecision === 'object' ? baseDecision : null;
  if (!decision) {
    return { status: 'BLOCKED', allocationPct: 0, reason: 'MINBEIS_DECISION_REQUIRED', blockers: ['MINBEIS_DECISION_REQUIRED'] };
  }

  if (!['BUY_PROBE', 'BUY_STARTER', 'BUY_CORE'].includes(decision.action)) {
    return { ...decision, portfolioSizingStatus: 'NOT_APPLICABLE', portfolioAdjustedAllocationPct: 0, portfolioSizingBlockers: [] };
  }

  const policyMode = Object.values(CONCENTRATION_POLICY_MODES).includes(options.concentrationPolicyMode)
    ? options.concentrationPolicyMode
    : CONCENTRATION_POLICY_MODES.INFORM_ONLY;

  const positions = Array.isArray(portfolioPositions) ? portfolioPositions : [];
  const valued = positions.filter((position) => finite(position?.eurValue) && Number(position.eurValue) >= 0);
  const valuationComplete = positions.length === valued.length;
  const totalValue = valued.reduce((sum, position) => sum + Number(position.eurValue), 0);
  const symbol = canonicalSymbol(options.symbol || decision.symbol);
  const current = valued.find((position) => canonicalSymbol(position?.symbol) === symbol) || null;
  const currentWeightPct = current && totalValue > 0 ? (Number(current.eurValue) / totalValue) * 100 : 0;
  const baseAllocationPct = clamp(decision.allocationPct, 0, 100);

  if (!valuationComplete || !(totalValue > 0)) {
    return {
      ...decision,
      concentrationPolicyMode: policyMode,
      portfolioSizingStatus: 'PERSONALIZATION_UNAVAILABLE',
      portfolioAdjustedAllocationPct: baseAllocationPct,
      baseAllocationPct,
      currentPositionWeightPct: null,
      projectedPositionWeightPct: null,
      concentrationBand: 'UNKNOWN',
      maxSinglePositionPct: policyMode === CONCENTRATION_POLICY_MODES.USER_LIMIT
        ? clamp(options.maxSinglePositionPct ?? 100, 0.5, 100)
        : null,
      portfolioSizingBlockers: [],
      portfolioSizingWarnings: ['PORTFOLIO_VALUATION_INCOMPLETE'],
      portfolioSizingNote: 'Η βασική απόφαση MINBEIS παραμένει διαθέσιμη, αλλά η προσωπική προσαρμογή συγκέντρωσης δεν μπορεί να υπολογιστεί με ασφάλεια μέχρι να αποτιμηθεί πλήρως το χαρτοφυλάκιο.',
    };
  }

  const projectedPositionWeightPct = Math.min(100, currentWeightPct + baseAllocationPct);
  const band = concentrationBand(projectedPositionWeightPct);

  if (policyMode === CONCENTRATION_POLICY_MODES.NO_LIMIT) {
    return {
      ...decision,
      concentrationPolicyMode: policyMode,
      portfolioSizingStatus: 'PASS_USER_NO_LIMIT',
      portfolioAdjustedAllocationPct: baseAllocationPct,
      baseAllocationPct,
      currentPositionWeightPct: Number(currentWeightPct.toFixed(2)),
      projectedPositionWeightPct: Number(projectedPositionWeightPct.toFixed(2)),
      concentrationBand: band,
      maxSinglePositionPct: null,
      portfolioSizingBlockers: [],
      portfolioSizingWarnings: band === 'DIVERSIFIED' ? [] : ['CONCENTRATION_RISK'],
      portfolioSizingNote: 'Ο χρήστης έχει επιλέξει στρατηγική χωρίς όριο συγκέντρωσης. Η εφαρμογή δεν μειώνει τη θέση· εμφανίζει μόνο την έκθεση και τον κίνδυνο.',
    };
  }

  if (policyMode === CONCENTRATION_POLICY_MODES.INFORM_ONLY) {
    return {
      ...decision,
      concentrationPolicyMode: policyMode,
      portfolioSizingStatus: 'PASS_ADVISORY',
      portfolioAdjustedAllocationPct: baseAllocationPct,
      baseAllocationPct,
      currentPositionWeightPct: Number(currentWeightPct.toFixed(2)),
      projectedPositionWeightPct: Number(projectedPositionWeightPct.toFixed(2)),
      concentrationBand: band,
      maxSinglePositionPct: null,
      portfolioSizingBlockers: [],
      portfolioSizingWarnings: band === 'DIVERSIFIED' ? [] : ['CONCENTRATION_RISK'],
      portfolioSizingNote: band === 'DIVERSIFIED'
        ? 'Η προτεινόμενη θέση δεν δημιουργεί σημαντική συγκέντρωση με τα τρέχοντα δεδομένα.'
        : 'Η εφαρμογή επισημαίνει αυξημένη συγκέντρωση, αλλά δεν αλλάζει την επιλογή ή το μέγεθος θέσης του χρήστη.',
    };
  }

  const maxSinglePositionPct = clamp(options.maxSinglePositionPct ?? 10, 0.5, 100);
  const remainingSingleNameCapacityPct = Math.max(0, maxSinglePositionPct - currentWeightPct);
  const adjusted = Math.min(baseAllocationPct, remainingSingleNameCapacityPct);
  const blockers = [];
  if (remainingSingleNameCapacityPct <= 0) blockers.push('USER_SINGLE_POSITION_LIMIT_REACHED');
  if (adjusted <= 0) blockers.push('NO_USER_POLICY_CAPACITY');

  return {
    ...decision,
    concentrationPolicyMode: policyMode,
    portfolioSizingStatus: blockers.length ? 'BLOCKED_BY_USER_POLICY' : adjusted < baseAllocationPct ? 'CAPPED_BY_USER_POLICY' : 'PASS',
    portfolioAdjustedAllocationPct: blockers.length ? 0 : Number(adjusted.toFixed(2)),
    baseAllocationPct,
    currentPositionWeightPct: Number(currentWeightPct.toFixed(2)),
    projectedPositionWeightPct: Number(Math.min(100, currentWeightPct + (blockers.length ? 0 : adjusted)).toFixed(2)),
    concentrationBand: band,
    maxSinglePositionPct,
    portfolioSizingBlockers: [...new Set(blockers)],
    portfolioSizingWarnings: band === 'DIVERSIFIED' ? [] : ['CONCENTRATION_RISK'],
    portfolioSizingNote: blockers.length
      ? 'Η νέα θέση μπλοκάρεται επειδή παραβιάζει το όριο συγκέντρωσης που επέλεξε ο ίδιος ο χρήστης.'
      : adjusted < baseAllocationPct
        ? 'Η βασική πρόταση MINBEIS μειώθηκε μόνο για να τηρηθεί το όριο συγκέντρωσης που επέλεξε ο χρήστης.'
        : 'Η βασική πρόταση MINBEIS χωρά στο όριο συγκέντρωσης που επέλεξε ο χρήστης.',
  };
}
