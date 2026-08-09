import { evaluateFinalAction, FINAL_ACTIONS } from './final-action-policy.js';

export const OPPORTUNITY_PURCHASE_RECONCILIATION_VERSION = '2026-08-09.1';

const BUY_TIERS = new Set(['SUPER_OPPORTUNITY_CANDIDATE', 'HIGH_PRIORITY_CANDIDATE']);

function dossierPriority(dossier = {}) {
  let score = 0;
  if (dossier.status === 'PUBLISHED') score += 40;
  else if (dossier.status === 'REVIEW_READY') score += 30;
  if (dossier.readiness?.publishable === true) score += 20;
  if (dossier.metrics?.crossCheck?.recommendationReady === true) score += 20;
  if (dossier.metrics?.fundamentals?.metricsReady === true) score += 10;
  if (dossier.metrics?.market?.readiness?.marketMetricsReady === true) score += 10;
  return score;
}

function bestDossierByCompany(dossiers = []) {
  const map = new Map();
  for (const dossier of dossiers) {
    if (!dossier?.companyId) continue;
    const current = map.get(dossier.companyId);
    if (!current || dossierPriority(dossier) > dossierPriority(current)) map.set(dossier.companyId, dossier);
  }
  return map;
}

function purchaseStatus(strictAction) {
  if (!strictAction || strictAction.status === 'BLOCKED') return 'BLOCKED';
  if (strictAction.nonHolderAction === FINAL_ACTIONS.BUY_NOW) return 'BUY_CONFIRMED';
  if ([FINAL_ACTIONS.AVOID].includes(strictAction.nonHolderAction)) return 'REJECTED';
  if (strictAction.marketAction === FINAL_ACTIONS.AVOID) return 'REJECTED';
  if (strictAction.reasons?.includes('SEVERE_RISK_CONFIGURATION')) return 'REJECTED';
  return 'WAIT_FOR_ENTRY_CONFIRMATION';
}

function statusLabel(status) {
  return {
    BUY_CONFIRMED: 'ΑΓΟΡΑ ΕΠΙΒΕΒΑΙΩΘΗΚΕ',
    WAIT_FOR_ENTRY_CONFIRMATION: 'ΠΕΡΙΜΕΝΕ — ΔΕΝ ΕΠΙΒΕΒΑΙΩΘΗΚΕ ΑΚΟΜΗ ΕΙΣΟΔΟΣ',
    REJECTED: 'ΑΠΟΡΡΙΦΘΗΚΕ ΓΙΑ ΑΓΟΡΑ',
    BLOCKED: 'ΜΠΛΟΚΑΡΙΣΜΕΝΟ — ΛΕΙΠΟΥΝ ΕΛΕΓΧΟΙ',
    NO_DEEP_DOSSIER: 'ΑΝΑΜΟΝΗ ΠΛΗΡΟΥΣ ΑΝΑΛΥΣΗΣ',
  }[status] || status;
}

function whyNotBuyNow(strictAction) {
  if (!strictAction) return ['FULL_DEEP_DOSSIER_REQUIRED'];
  if (strictAction.status === 'BLOCKED') return strictAction.blockers || ['FINAL_ACTION_BLOCKED'];
  if (strictAction.nonHolderAction === FINAL_ACTIONS.BUY_NOW) return [];
  return [...new Set([
    ...(strictAction.reasons || []),
    ...(strictAction.risk?.fundamentalFlags || []),
    ...(strictAction.risk?.marketFlags || []),
    ...(strictAction.blockers || []),
  ].filter(Boolean))];
}

export function reconcileOpportunityPurchaseDecisions(opportunityUniverse = {}, researchDossiers = [], options = {}) {
  const candidates = (opportunityUniverse?.ranking?.items || []).filter((item) => BUY_TIERS.has(item.tier));
  const dossiers = bestDossierByCompany(researchDossiers);
  const decisions = candidates.map((candidate) => {
    const dossier = dossiers.get(candidate.instrumentId) || null;
    if (!dossier) {
      return {
        format: 'investor-control-opportunity-purchase-decision',
        version: 1,
        policyVersion: OPPORTUNITY_PURCHASE_RECONCILIATION_VERSION,
        instrumentId: candidate.instrumentId,
        displayName: candidate.displayName,
        assetClass: candidate.assetClass,
        tier: candidate.tier,
        opportunityScore: candidate.opportunityScore,
        confidenceScore: candidate.confidenceScore,
        status: 'NO_DEEP_DOSSIER',
        statusLabel: statusLabel('NO_DEEP_DOSSIER'),
        buyNowEligible: false,
        strictAction: null,
        whyNotBuyNow: ['FULL_DEEP_DOSSIER_REQUIRED'],
        nextGate: 'FULL_DEEP_DOSSIER',
        automaticBrokerOrder: false,
      };
    }

    // Opportunity score nominates the setup for a strict BUY evaluation. It
    // never sets BUY directly. The existing final-action policy remains the
    // sole authority for execution-grade BUY_NOW.
    const strictAction = evaluateFinalAction({ ...dossier, proposedAction: 'CONSIDER_BUY' }, options);
    const status = purchaseStatus(strictAction);
    return {
      format: 'investor-control-opportunity-purchase-decision',
      version: 1,
      policyVersion: OPPORTUNITY_PURCHASE_RECONCILIATION_VERSION,
      instrumentId: candidate.instrumentId,
      companyId: dossier.companyId,
      dossierId: dossier.id || dossier.dossierId || null,
      displayName: candidate.displayName || dossier.companyName,
      symbol: dossier.symbol || null,
      assetClass: candidate.assetClass,
      tier: candidate.tier,
      opportunityScore: candidate.opportunityScore,
      opportunityConfidenceScore: candidate.confidenceScore,
      status,
      statusLabel: statusLabel(status),
      buyNowEligible: status === 'BUY_CONFIRMED',
      strictAction,
      whyNotBuyNow: whyNotBuyNow(strictAction),
      nextGate: status === 'BUY_CONFIRMED'
        ? 'USER_EXECUTION_ONLY'
        : status === 'REJECTED'
          ? 'NEW_EVIDENCE_OR_MATERIAL_CHANGE'
          : status === 'BLOCKED'
            ? 'COMPLETE_BLOCKING_CHECKS'
            : 'RECHECK_STRICT_BUY_GATES',
      automaticBrokerOrder: false,
    };
  });

  const counts = {
    BUY_CONFIRMED: decisions.filter((item) => item.status === 'BUY_CONFIRMED').length,
    WAIT_FOR_ENTRY_CONFIRMATION: decisions.filter((item) => item.status === 'WAIT_FOR_ENTRY_CONFIRMATION').length,
    REJECTED: decisions.filter((item) => item.status === 'REJECTED').length,
    BLOCKED: decisions.filter((item) => item.status === 'BLOCKED').length,
    NO_DEEP_DOSSIER: decisions.filter((item) => item.status === 'NO_DEEP_DOSSIER').length,
  };

  return {
    format: 'investor-control-opportunity-purchase-reconciliation',
    version: 1,
    policyVersion: OPPORTUNITY_PURCHASE_RECONCILIATION_VERSION,
    generatedAt: new Date(options.now || Date.now()).toISOString(),
    candidateCount: candidates.length,
    counts,
    decisions,
    invariant: 'OPPORTUNITY_SCORE_CAN_NOMINATE_CONSIDER_BUY_BUT_ONLY_FINAL_ACTION_POLICY_CAN_CONFIRM_BUY_NOW',
  };
}
