function categoryLabel(category, status) {
  if (status === 'DRAFT_RESEARCH' && ['EVENT_DRIVEN', 'SPECULATIVE_CATALYST'].includes(category)) {
    return 'Υπόθεση καταλύτη υπό έλεγχο';
  }
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

function ageHours(value, generatedAt) {
  const time = new Date(value).getTime();
  const now = new Date(generatedAt).getTime();
  return Number.isFinite(time) && Number.isFinite(now) ? Math.max(0, (now - time) / 3_600_000) : null;
}

function metricNotes(dossier) {
  const notes = [];
  const metrics = dossier?.metrics?.fundamentals?.metrics || dossier?.metrics?.fundamentals || {};
  const margin = Number(metrics.netMarginPct ?? metrics.annualNetMarginPct);
  if (Number.isFinite(margin) && Math.abs(margin) > 1000) {
    notes.push('Το ακραίο καθαρό περιθώριο επηρεάζεται από πολύ χαμηλή βάση εσόδων σε σχέση με τις ζημίες και χρειάζεται ανάγνωση μαζί με τα απόλυτα ποσά.');
  }
  return notes;
}

function compactDossier(dossier, generatedAt) {
  const blockers = Array.isArray(dossier?.readiness?.blockers) ? dossier.readiness.blockers : [];
  const status = dossier.status;
  return {
    id: dossier.dossierId,
    companyId: dossier.companyId,
    companyName: dossier.companyName,
    symbol: dossier.listing?.symbol || null,
    exchange: dossier.listing?.exchange || null,
    origin: dossier.origin || 'FOCUS_UNIVERSE',
    discovery: dossier.discovery || null,
    status,
    statusLabel: status === 'PUBLISHED'
      ? 'Δημοσιευμένη ανάλυση'
      : status === 'REVIEW_READY'
        ? 'Έτοιμο για τελικό έλεγχο'
        : dossier.origin === 'AUTONOMOUS_DISCOVERY'
          ? 'Αυτόματη ανακάλυψη · έρευνα σε εξέλιξη'
          : 'Έρευνα σε εξέλιξη',
    category: dossier.category,
    categoryLabel: categoryLabel(dossier.category, status),
    action: status === 'DRAFT_RESEARCH' ? 'WATCH' : dossier.proposedAction,
    actionLabel: actionLabel(status === 'DRAFT_RESEARCH' ? 'WATCH' : dossier.proposedAction),
    timeHorizon: dossier.timeHorizon,
    referencePrice: dossier.referencePrice,
    referencePriceAgeHours: ageHours(dossier.referencePrice?.timestamp, generatedAt),
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
    metricNotes: metricNotes(dossier),
    generatedAt: dossier.generatedAt,
    publicationMode: dossier.publicationMode || null,
    finalAction: dossier.finalAction || null,
  };
}

function compactDiscovery(candidate) {
  return {
    discoveryId: candidate.discoveryId,
    companyId: candidate.companyId,
    companyName: candidate.companyName,
    symbol: candidate.symbol,
    exchange: candidate.exchange,
    discoveryScore: candidate.discoveryScore,
    status: candidate.status,
    suggestedAction: 'WATCH',
    suggestedActionLabel: 'Παρακολούθηση μέχρι πλήρη ανάλυση',
    reasons: candidate.reasons || [],
    latestEventAt: candidate.latestEventAt,
    events: candidate.events || [],
    isExistingFocusCompany: candidate.isExistingFocusCompany === true,
  };
}

function priority(item) {
  const statusScore = { PUBLISHED: 300, REVIEW_READY: 200, DRAFT_RESEARCH: 100 }[item.status] || 0;
  const finalActionScore = {
    SELL_NOW: 90,
    BUY_NOW: 85,
    AVOID: 80,
    DO_NOT_BUY: 70,
    HOLD: 50,
    WATCH: 0,
  }[item.finalAction?.marketAction] || 0;
  const urgencyScore = { IMMEDIATE: 40, TODAY: 25, NORMAL: 10, NONE: 0 }[item.finalAction?.urgency] || 0;
  const discoveryScore = item.origin === 'AUTONOMOUS_DISCOVERY' ? Number(item.discovery?.discoveryScore || 0) / 4 : 0;
  const categoryScore = { EVENT_RISK: 50, DETERIORATION: 45, SPECULATIVE_CATALYST: 35, EVENT_DRIVEN: 30 }[item.category] || 10;
  return statusScore + finalActionScore + urgencyScore + discoveryScore + categoryScore - item.blockers.length;
}

function countFinalActions(items) {
  const counts = {
    finalActionCount: 0,
    buyNowCount: 0,
    sellNowCount: 0,
    holdCount: 0,
    doNotBuyCount: 0,
    avoidCount: 0,
    blockedDecisionCount: 0,
  };
  for (const item of items) {
    const finalAction = item.finalAction;
    if (!finalAction || finalAction.status !== 'FINAL') {
      counts.blockedDecisionCount += 1;
      continue;
    }
    counts.finalActionCount += 1;
    if (finalAction.marketAction === 'BUY_NOW') counts.buyNowCount += 1;
    if (finalAction.marketAction === 'SELL_NOW') counts.sellNowCount += 1;
    if (finalAction.marketAction === 'HOLD') counts.holdCount += 1;
    if (finalAction.marketAction === 'DO_NOT_BUY') counts.doNotBuyCount += 1;
    if (finalAction.marketAction === 'AVOID') counts.avoidCount += 1;
  }
  return counts;
}

export function buildMobileIntelligenceFeed(report = {}, options = {}) {
  const generatedAt = new Date(options.generatedAt || report.generatedAt || Date.now()).toISOString();
  const dossiers = (Array.isArray(report.researchDossiers) ? report.researchDossiers : []).map((item) => compactDossier(item, generatedAt));
  dossiers.sort((a, b) => priority(b) - priority(a) || String(b.generatedAt).localeCompare(String(a.generatedAt)));
  const published = dossiers.filter((item) => item.status === 'PUBLISHED');
  const reviewReady = dossiers.filter((item) => item.status === 'REVIEW_READY');
  const research = dossiers.filter((item) => item.status === 'DRAFT_RESEARCH');
  const decisions = dossiers.filter((item) => item.finalAction?.status === 'FINAL');
  const urgent = dossiers.filter((item) => item.finalAction?.urgency === 'IMMEDIATE' || ['EVENT_RISK', 'DETERIORATION'].includes(item.category)).slice(0, 5);
  const discoveryRadar = (report.discovery?.shortlist || []).filter((item) => !item.isExistingFocusCompany).map(compactDiscovery).slice(0, 12);
  const actionCounts = countFinalActions(dossiers);

  return {
    format: 'investor-control-mobile-intelligence-feed',
    version: 2,
    generatedAt,
    policyVersion: report.policyVersion || null,
    sourceSelection: report.discovery?.sourcePolicy || null,
    summary: {
      publishedCount: published.length,
      reviewReadyCount: reviewReady.length,
      researchCount: research.length,
      urgentCount: urgent.length,
      discoveryCandidateCount: discoveryRadar.length,
      discoveryDeepAnalysisCount: Number(report.discovery?.deepAnalysisCompanyCount || 0),
      unresolvedDiagnosticCount: Array.isArray(report.diagnostics) ? report.diagnostics.length : 0,
      ...actionCounts,
    },
    today: {
      headline: actionCounts.sellNowCount
        ? `${actionCounts.sellNowCount} σήμα άμεσης πώλησης ή μείωσης`
        : actionCounts.buyNowCount
          ? `${actionCounts.buyNowCount} επιβεβαιωμένο σήμα άμεσης αγοράς`
          : actionCounts.avoidCount
            ? `${actionCounts.avoidCount} περίπτωση για αποφυγή`
            : discoveryRadar.length
              ? `${discoveryRadar.length} νέες μετοχές εντοπίστηκαν αυτόματα για έλεγχο`
              : urgent.length
                ? `${urgent.length} υπόθεση${urgent.length === 1 ? '' : 'εις'} αυξημένης προτεραιότητας`
                : reviewReady.length
                  ? `${reviewReady.length} φάκελο${reviewReady.length === 1 ? 'ς' : 'ι'} έτοιμο για έλεγχο`
                  : 'Δεν υπάρχει ακόμη δημοσιεύσιμη επενδυτική πρόταση',
      primaryItem: urgent[0] || decisions[0] || reviewReady[0] || research[0] || null,
    },
    discoveryRadar,
    decisions,
    published,
    reviewReady,
    research,
    urgent,
    assistantContext: dossiers.map((item) => ({
      companyId: item.companyId,
      companyName: item.companyName,
      symbol: item.symbol,
      origin: item.origin,
      discovery: item.discovery,
      status: item.status,
      category: item.category,
      action: item.action,
      finalAction: item.finalAction,
      thesis: item.thesis,
      blockers: item.blockers,
      nextStep: item.nextStep,
      reviewDate: item.reviewDate,
    })),
    disclosure: 'Οι νέες μετοχές εντοπίζονται αυτόματα από επίσημα γεγονότα και περνούν σε βαθιά ανάλυση. Καμία ανακάλυψη δεν γίνεται πρόταση αγοράς πριν περάσουν όλοι οι έλεγχοι πηγών, θεμελιωδών, αγοράς, ρευστότητας, φρεσκότητας και αντιφάσεων. Δεν εκτελούνται συναλλαγές.',
  };
}
