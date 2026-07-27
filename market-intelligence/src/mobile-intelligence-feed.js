function categoryLabel(category) {
  return {
    QUALITY_COMPOUNDER: 'Μακροχρόνια ποιοτική ανάπτυξη',
    VALUE_REPRICING: 'Πιθανή επανατιμολόγηση αξίας',
    EVENT_DRIVEN: 'Ευκαιρία συγκεκριμένου καταλύτη',
    SPECULATIVE_CATALYST: 'Κερδοσκοπικός καταλύτης',
    MOMENTUM_CONFIRMED: 'Επιβεβαιωμένη δυναμική',
    TURNAROUND: 'Πιθανή αναστροφή',
    INCOME_STABILITY: 'Σταθερότητα εισοδήματος',
    DETERIORATION: 'Επιδείνωση',
    EVENT_RISK: 'Σημαντικό επερχόμενο ρίσκο',
    INSUFFICIENT_EVIDENCE: 'Ανεπαρκή στοιχεία',
  }[category] || category;
}

function actionLabel(action) {
  return {
    CONSIDER_BUY: 'Πιθανή αγορά',
    CONSIDER_REDUCE: 'Εξέταση μείωσης',
    AVOID: 'Αποφυγή',
    HOLD: 'Διακράτηση',
    WATCH: 'Παρακολούθηση',
  }[action] || action;
}

function blockerLabel(blocker) {
  return {
    DOCUMENT_REVIEW_REQUIRED: 'Απαιτείται ανάγνωση του επίσημου εγγράφου',
    FUNDAMENTALS_REQUIRED: 'Λείπουν επαρκή θεμελιώδη στοιχεία',
    HISTORICAL_MARKET_METRICS_REQUIRED: 'Λείπει επαρκές ιστορικό τιμής και όγκου',
    INDEPENDENT_CROSS_CHECK_REQUIRED: 'Λείπει ανεξάρτητη διασταύρωση',
    REVIEWED_PRIMARY_SOURCE_REQUIRED: 'Λείπει αναγνωσμένη πρωτογενής πηγή',
    REVIEWED_INDEPENDENT_CORROBORATION_REQUIRED: 'Λείπει αναγνωσμένη ανεξάρτητη επιβεβαίωση',
    CANONICAL_CLAIM_REQUIRED: 'Δεν έχει συνδεθεί σαφής εταιρικός ισχυρισμός',
    CLAIM_CORROBORATION_REQUIRED: 'Ο συγκεκριμένος ισχυρισμός δεν έχει επιβεβαιωθεί επαρκώς',
    REFERENCE_PRICE_REQUIRED: 'Λείπει έγκυρη τιμή αναφοράς',
    REFERENCE_PRICE_STALE_FOR_PUBLICATION: 'Η τιμή αναφοράς είναι παλιά',
    THESIS_REQUIRED: 'Λείπει ολοκληρωμένη επενδυτική θέση',
    CAUSAL_MECHANISM_REQUIRED: 'Λείπει ο μηχανισμός που συνδέει το γεγονός με την αξία',
    BULL_CASE_REQUIRED: 'Λείπει θετικό σενάριο',
    BEAR_CASE_REQUIRED: 'Λείπει αρνητικό σενάριο',
    VERIFIED_CATALYST_REQUIRED: 'Λείπει επαληθευμένος καταλύτης',
    MATERIAL_RISKS_REQUIRED: 'Λείπουν ουσιαστικοί κίνδυνοι',
    INVALIDATION_CONDITION_REQUIRED: 'Λείπει σαφής συνθήκη ακύρωσης',
    REVIEW_DATE_REQUIRED: 'Λείπει ημερομηνία επανεξέτασης',
    UNRESOLVED_CONTRADICTION: 'Υπάρχει ανεπίλυτη αντίφαση στις πηγές',
  }[blocker] || blocker;
}

function nextStep(blockers = []) {
  const priority = [
    ['DOCUMENT_REVIEW_REQUIRED', 'Άνοιγμα και ανάλυση του επίσημου εγγράφου'],
    ['REVIEWED_PRIMARY_SOURCE_REQUIRED', 'Επιβεβαίωση από επίσημη πρωτογενή πηγή'],
    ['REVIEWED_INDEPENDENT_CORROBORATION_REQUIRED', 'Εύρεση και ανάγνωση ανεξάρτητης αξιόπιστης πηγής'],
    ['INDEPENDENT_CROSS_CHECK_REQUIRED', 'Διασταύρωση του ίδιου γεγονότος με ανεξάρτητη πηγή'],
    ['FUNDAMENTALS_REQUIRED', 'Συμπλήρωση θεμελιωδών οικονομικών στοιχείων'],
    ['HISTORICAL_MARKET_METRICS_REQUIRED', 'Συμπλήρωση ιστορικού τιμών, όγκου και σχετικής ισχύος'],
    ['REFERENCE_PRICE_REQUIRED', 'Ανάκτηση έγκυρης τρέχουσας τιμής'],
    ['UNRESOLVED_CONTRADICTION', 'Έλεγχος και επίλυση της αντίφασης πριν από οποιαδήποτε πρόταση'],
  ];
  for (const [code, label] of priority) if (blockers.includes(code)) return label;
  return blockers.length ? 'Συμπλήρωση των ελλιπών στοιχείων' : 'Έλεγχος του πλήρους φακέλου';
}

function compactSources(evidence = []) {
  return evidence.slice(0, 6).map((item) => ({
    sourceName: item.sourceName,
    sourceType: item.sourceType,
    title: item.title,
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt,
    reviewed: ['REVIEWED_TEXT', 'REVIEWED_PDF', 'REVIEWED_NEWS'].includes(item.documentStatus),
    primary: item.isPrimarySource === true,
  }));
}

function compactDossier(dossier) {
  const blockers = Array.isArray(dossier?.readiness?.blockers) ? dossier.readiness.blockers : [];
  const status = dossier.status;
  return {
    id: dossier.dossierId,
    companyId: dossier.companyId,
    companyName: dossier.companyName,
    symbol: dossier.listing?.symbol || null,
    exchange: dossier.listing?.exchange || null,
    status,
    statusLabel: status === 'PUBLISHED'
      ? 'Δημοσιευμένη ανάλυση'
      : status === 'REVIEW_READY'
        ? 'Έτοιμο για τελικό έλεγχο'
        : 'Έρευνα σε εξέλιξη',
    category: dossier.category,
    categoryLabel: categoryLabel(dossier.category),
    action: status === 'DRAFT_RESEARCH' ? 'WATCH' : dossier.proposedAction,
    actionLabel: actionLabel(status === 'DRAFT_RESEARCH' ? 'WATCH' : dossier.proposedAction),
    timeHorizon: dossier.timeHorizon,
    referencePrice: dossier.referencePrice,
    thesis: dossier.thesis,
    causalMechanism: dossier.causalMechanism,
    bullCase: dossier.bullCase,
    bearCase: dossier.bearCase,
    catalysts: dossier.catalysts,
    risks: dossier.risks,
    invalidationCondition: dossier.invalidationCondition,
    reviewDate: dossier.reviewDate,
    blockers,
    blockerLabels: blockers.map(blockerLabel),
    nextStep: status === 'REVIEW_READY' ? 'Τελικός έλεγχος και απόφαση δημοσίευσης' : nextStep(blockers),
    sources: compactSources(dossier.evidence),
    generatedAt: dossier.generatedAt,
  };
}

function priority(item) {
  const statusScore = { PUBLISHED: 300, REVIEW_READY: 200, DRAFT_RESEARCH: 100 }[item.status] || 0;
  const categoryScore = { EVENT_RISK: 50, DETERIORATION: 45, SPECULATIVE_CATALYST: 35, EVENT_DRIVEN: 30 }[item.category] || 10;
  return statusScore + categoryScore - item.blockers.length;
}

export function buildMobileIntelligenceFeed(report = {}, options = {}) {
  const dossiers = (Array.isArray(report.researchDossiers) ? report.researchDossiers : []).map(compactDossier);
  dossiers.sort((a, b) => priority(b) - priority(a) || String(b.generatedAt).localeCompare(String(a.generatedAt)));
  const published = dossiers.filter((item) => item.status === 'PUBLISHED');
  const reviewReady = dossiers.filter((item) => item.status === 'REVIEW_READY');
  const research = dossiers.filter((item) => item.status === 'DRAFT_RESEARCH');
  const urgent = dossiers.filter((item) => ['EVENT_RISK', 'DETERIORATION'].includes(item.category)).slice(0, 5);
  const generatedAt = new Date(options.generatedAt || report.generatedAt || Date.now()).toISOString();

  return {
    format: 'investor-control-mobile-intelligence-feed',
    version: 1,
    generatedAt,
    summary: {
      publishedCount: published.length,
      reviewReadyCount: reviewReady.length,
      researchCount: research.length,
      urgentCount: urgent.length,
      unresolvedDiagnosticCount: Array.isArray(report.diagnostics) ? report.diagnostics.length : 0,
    },
    today: {
      headline: urgent.length
        ? `${urgent.length} υπόθεση${urgent.length === 1 ? '' : 'εις'} αυξημένης προτεραιότητας`
        : reviewReady.length
          ? `${reviewReady.length} φάκελο${reviewReady.length === 1 ? 'ς' : 'ι'} έτοιμο για έλεγχο`
          : 'Δεν υπάρχει ακόμη δημοσιεύσιμη επενδυτική πρόταση',
      primaryItem: urgent[0] || reviewReady[0] || research[0] || null,
    },
    published,
    reviewReady,
    research,
    urgent,
    assistantContext: dossiers.map((item) => ({
      companyId: item.companyId,
      companyName: item.companyName,
      symbol: item.symbol,
      status: item.status,
      category: item.category,
      action: item.action,
      thesis: item.thesis,
      blockers: item.blockers,
      nextStep: item.nextStep,
      reviewDate: item.reviewDate,
    })),
    disclosure: 'Οι αναλύσεις βασίζονται σε καταγεγραμμένες πηγές και υπολογισμούς. Δεν αποτελούν εγγύηση αποτελέσματος και δεν εκτελούν συναλλαγές.',
  };
}
