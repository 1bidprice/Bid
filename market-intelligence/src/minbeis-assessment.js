export const MINBEIS_ASSESSMENT_VERSION = '2026-09-23.1';

export const MINBEIS_ASSESSMENTS = Object.freeze({
  SETUP: 'SETUP',
  TRAP: 'TRAP',
  NO_TRADE: 'NO_TRADE',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
});

const unique = (items) => [...new Set((Array.isArray(items) ? items : []).filter(Boolean))];

function severeRisk(finalAction) {
  const reasons = finalAction?.reasons || [];
  const fundamental = finalAction?.risk?.fundamentalFlags || [];
  const market = finalAction?.risk?.marketFlags || [];
  return reasons.includes('SEVERE_RISK_CONFIGURATION')
    || fundamental.length > 0
    || market.includes('EXTREME_VOLATILITY')
    || market.includes('SEVERE_DRAWDOWN')
    || market.includes('LOW_LIQUIDITY');
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) || null;
}

function classificationFor(dossier, purchase) {
  const finalAction = dossier?.finalAction || null;

  if (!finalAction || finalAction.status !== 'FINAL') {
    return {
      classification: MINBEIS_ASSESSMENTS.CONFIRMATION_REQUIRED,
      reasonCode: 'CANONICAL_DECISION_BLOCKED',
    };
  }

  if (severeRisk(finalAction) || ['AVOID'].includes(finalAction.marketAction)) {
    return {
      classification: MINBEIS_ASSESSMENTS.TRAP,
      reasonCode: 'VERIFIED_RISK_OR_AVOIDANCE',
    };
  }

  if (finalAction.marketAction === 'BUY_NOW') {
    const confirmed = purchase?.status === 'BUY_CONFIRMED' && purchase?.buyNowEligible === true;
    return confirmed
      ? { classification: MINBEIS_ASSESSMENTS.SETUP, reasonCode: 'STRICT_BUY_CONFIRMED' }
      : { classification: MINBEIS_ASSESSMENTS.CONFIRMATION_REQUIRED, reasonCode: 'STRICT_BUY_CONFIRMATION_REQUIRED' };
  }

  if (['DO_NOT_BUY', 'WATCH', 'HOLD'].includes(finalAction.marketAction)) {
    return {
      classification: MINBEIS_ASSESSMENTS.NO_TRADE,
      reasonCode: finalAction.marketAction === 'HOLD' ? 'HOLD_NOT_NEW_ENTRY' : 'NO_CONFIRMED_ENTRY',
    };
  }

  return {
    classification: MINBEIS_ASSESSMENTS.NO_TRADE,
    reasonCode: 'NO_CONFIRMED_ENTRY',
  };
}

function headlineFor(classification) {
  return {
    SETUP: 'Επιβεβαιωμένο setup',
    TRAP: 'Αυξημένος κίνδυνος παγίδας',
    NO_TRADE: 'No-trade τώρα',
    CONFIRMATION_REQUIRED: 'Απαιτείται επιβεβαίωση',
  }[classification] || classification;
}

function explanationFor(dossier, purchase, result) {
  const finalAction = dossier?.finalAction || {};
  const blockers = unique(finalAction.blockers || dossier?.readiness?.blockers || []);
  const reasons = unique(finalAction.reasons || []);
  const riskFlags = unique([
    ...(finalAction?.risk?.fundamentalFlags || []),
    ...(finalAction?.risk?.marketFlags || []),
  ]);

  let summary;
  let whatWouldChange;

  if (result.classification === MINBEIS_ASSESSMENTS.SETUP) {
    summary = 'Η canonical ανάλυση έχει περάσει τα τελικά BUY gates και το strict purchase reconciliation. Το setup είναι επιβεβαιωμένο με τα τρέχοντα δεδομένα.';
    whatWouldChange = firstNonEmpty(dossier?.invalidationCondition, 'Νέα δεδομένα που ακυρώνουν το thesis, την τάση, τη ρευστότητα ή τη φρεσκότητα της τιμής.');
  } else if (result.classification === MINBEIS_ASSESSMENTS.TRAP) {
    summary = 'Η canonical ανάλυση εντοπίζει επαληθευμένο αυξημένο κίνδυνο ή συνθήκες αποφυγής. Το MINBEIS το αντιμετωπίζει ως πιθανή παγίδα και όχι ως νέα είσοδο.';
    whatWouldChange = 'Υποχώρηση των επαληθευμένων risk flags και νέα πλήρης canonical αξιολόγηση.';
  } else if (result.classification === MINBEIS_ASSESSMENTS.CONFIRMATION_REQUIRED) {
    summary = finalAction?.status === 'BLOCKED'
      ? 'Η ανάλυση υπάρχει, αλλά λείπει τουλάχιστον ένας υποχρεωτικός έλεγχος. Δεν παράγεται τεχνητή τελική πράξη.'
      : 'Υπάρχει θετική κατεύθυνση, αλλά δεν έχει επιβεβαιωθεί ακόμη το strict entry/purchase gate.';
    whatWouldChange = firstNonEmpty(purchase?.nextGate, dossier?.nextStep, 'Ολοκλήρωση των υποχρεωτικών ελέγχων και νέα canonical αξιολόγηση.');
  } else {
    summary = finalAction?.marketAction === 'HOLD'
      ? 'Η τρέχουσα ανάλυση μπορεί να στηρίζει διακράτηση υπάρχουσας θέσης, αλλά δεν επιβεβαιώνει νέα είσοδο.'
      : 'Δεν υπάρχει επιβεβαιωμένο setup για νέα είσοδο με τα τρέχοντα δεδομένα.';
    whatWouldChange = firstNonEmpty(purchase?.nextGate, dossier?.nextStep, 'Νέα επιβεβαιωμένα δεδομένα ή μεταβολή της αγοράς που περνά τα canonical entry gates.');
  }

  return {
    format: 'minbeis-explanation-packet',
    version: 1,
    headline: headlineFor(result.classification),
    summary,
    whyNow: unique([
      ...reasons,
      ...riskFlags,
      ...blockers.slice(0, 4),
      ...(purchase?.whyNotBuyNow || []).slice(0, 4),
    ]).slice(0, 8),
    whatWouldChange,
    invalidation: dossier?.invalidationCondition || null,
    confidenceScore: Number.isFinite(Number(finalAction?.confidenceScore)) ? Number(finalAction.confidenceScore) : null,
    dataQualityScore: Number.isFinite(Number(finalAction?.dataQualityScore)) ? Number(finalAction.dataQualityScore) : null,
  };
}

export function buildMinbeisAssessment(dossier = {}, purchase = null) {
  const result = classificationFor(dossier, purchase);
  return {
    format: 'investor-control-minbeis-assessment',
    version: 1,
    policyVersion: MINBEIS_ASSESSMENT_VERSION,
    classification: result.classification,
    reasonCode: result.reasonCode,
    decisionImpact: 'NONE',
    finalActionEligible: false,
    sourceFinalActionStatus: dossier?.finalAction?.status || null,
    sourceMarketAction: dossier?.finalAction?.marketAction || null,
    explanation: explanationFor(dossier, purchase, result),
  };
}
