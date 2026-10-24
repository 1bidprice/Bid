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
    MARKET_METRICS_NOT_READY: 'Δεν έχουν ολοκληρωθεί οι έλεγχοι ιστορικού αγοράς',
    MARKET_HISTORY_SOURCE_NOT_READY: 'Η πηγή ιστορικών δεδομένων δεν έχει εγκριθεί',
    MARKET_HISTORY_NOT_CROSSCHECKED: 'Το ιστορικό τιμών δεν έχει διασταυρωθεί με ανεξάρτητη τρέχουσα τιμή',
    MARKET_BENCHMARK_NOT_READY: 'Λείπει έγκυρο συγκριτικό σημείο αναφοράς αγοράς',
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
    COMPANY_IDENTITY_REQUIRED: 'Δεν έχει επαληθευτεί η ταυτότητα της εταιρείας',
    DECISION_EVIDENCE_REQUIRED: 'Λείπει τεκμηρίωση δεμένη με τη συγκεκριμένη εταιρεία',
    EVIDENCE_ENTITY_UNVERIFIED: 'Υπάρχει πηγή χωρίς επαληθευμένη σύνδεση με τη συγκεκριμένη εταιρεία',
    EVIDENCE_ENTITY_MISMATCH: 'Εντοπίστηκε πηγή που ανήκει σε άλλη εταιρεία',
    REFERENCE_PRICE_ENTITY_MISMATCH: 'Η τιμή αναφοράς δεν ανήκει στην ίδια εταιρεία',
    REFERENCE_PRICE_SOURCE_NOT_APPROVED: 'Η πηγή της τιμής δεν είναι εγκεκριμένη για τελική απόφαση',
    REFERENCE_PRICE_TIMESTAMP_NOT_VERIFIED: 'Ο χρόνος της τιμής δεν έχει επαληθευτεί',
    REFERENCE_PRICE_NOT_DECISION_ELIGIBLE: 'Η τιμή είναι μόνο πληροφοριακή και όχι κατάλληλη για τελική απόφαση',
    REFERENCE_PRICE_NOT_EXECUTION_ELIGIBLE: 'Η τιμή δεν είναι αρκετά φρέσκια/επαληθευμένη για άμεση ενέργεια',
    LISTING_IDENTITY_MISMATCH: 'Το σύμβολο της τιμής δεν ταυτίζεται με τη χρηματιστηριακή εγγραφή',
    ACTIVE_LISTING_NOT_VERIFIED: 'Δεν έχει επιβεβαιωθεί ότι η μετοχή διαπραγματεύεται ακόμη ενεργά',
    LISTING_NOT_ACTIVE: 'Η χρηματιστηριακή εγγραφή δεν είναι ενεργή',
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
    ['COMPANY_IDENTITY_REQUIRED', 'Επαλήθευση της ταυτότητας της εταιρείας πριν από οποιαδήποτε πρόταση'],
    ['EVIDENCE_ENTITY_MISMATCH', 'Αφαίρεση των πηγών άλλης εταιρείας και νέα διασταύρωση'],
    ['EVIDENCE_ENTITY_UNVERIFIED', 'Σύνδεση κάθε πηγής με τη σωστή εταιρεία'],
    ['ACTIVE_LISTING_NOT_VERIFIED', 'Επιβεβαίωση ότι η μετοχή διαπραγματεύεται ακόμη ενεργά'],
    ['LISTING_NOT_ACTIVE', 'Απόρριψη της παλιάς/ανενεργής χρηματιστηριακής εγγραφής'],
    ['LISTING_IDENTITY_MISMATCH', 'Επανέλεγχος ticker και χρηματιστηριακής ταυτότητας'],
    ['REFERENCE_PRICE_ENTITY_MISMATCH', 'Ανάκτηση τιμής για τη σωστή εταιρεία'],
    ['REFERENCE_PRICE_SOURCE_NOT_APPROVED', 'Ανάκτηση τιμής από εγκεκριμένη πηγή'],
    ['REFERENCE_PRICE_TIMESTAMP_NOT_VERIFIED', 'Επαλήθευση χρόνου της τιμής πριν από άμεση ενέργεια'],
    ['REFERENCE_PRICE_NOT_DECISION_ELIGIBLE', 'Ανάκτηση decision-grade τιμής πριν από τελική απόφαση'],
    ['REFERENCE_PRICE_NOT_EXECUTION_ELIGIBLE', 'Ανάκτηση επαληθευμένης φρέσκιας τιμής πριν από άμεση ενέργεια'],
    ['REFERENCE_PRICE_REQUIRED', 'Ανάκτηση έγκυρης τρέχουσας τιμής'],
    ['UNRESOLVED_CONTRADICTION', 'Έλεγχος και επίλυση της αντίφασης πριν από οποιαδήποτε πρόταση'],
  ];
  for (const [code, label] of priority) if (blockers.includes(code)) return label;
  return blockers.length ? 'Συμπλήρωση των ελλιπών στοιχείων' : 'Έλεγχος τεκμηρίωσης';
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
    companyIds: Array.isArray(item.companyIds) ? [...item.companyIds] : [],
  }));
}

function ageHours(value, generatedAt) {
  const time = new Date(value).getTime();
  const now = new Date(generatedAt).getTime();
  return Number.isFinite(time) && Number.isFinite(now) ? Math.max(0, (now - time) / 3_600_000) : null;
}

function compactMarketQuote(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return {
    appSymbol: snapshot.appSymbol || snapshot.symbol || null,
    companyId: snapshot.companyId || null,
    companyName: snapshot.companyName || null,
    price: Number.isFinite(Number(snapshot.currentPrice)) ? Number(snapshot.currentPrice) : null,
    previousClose: Number.isFinite(Number(snapshot.previousClose)) ? Number(snapshot.previousClose) : null,
    currency: snapshot.currency || null,
    quoteAt: snapshot.quoteAt || null,
    checkedAt: snapshot.generatedAt || null,
    source: snapshot.source || null,
    sourceUrl: snapshot.sourceUrl || null,
    sourceQuality: snapshot.sourceQuality || null,
    quoteContract: snapshot.quoteContract || null,
  };
}

function buildQuoteRegistry(snapshots = []) {
  const registry = {};
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const quote = compactMarketQuote(snapshot);
    if (!quote?.appSymbol) continue;
    registry[String(quote.appSymbol).toUpperCase()] = quote;
  }
  return registry;
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
  const readinessBlockers = Array.isArray(dossier?.readiness?.blockers) ? dossier.readiness.blockers : [];
  const finalBlockers = Array.isArray(dossier?.finalAction?.blockers) ? dossier.finalAction.blockers : [];
  const blockers = [...new Set([...readinessBlockers, ...finalBlockers])];
  const status = dossier.status;
  const effectiveAction = dossier.finalAction?.status === 'BLOCKED'
    ? 'WATCH'
    : status === 'DRAFT_RESEARCH'
      ? 'WATCH'
      : dossier.proposedAction;
  return {
    id: dossier.dossierId,
    companyId: dossier.companyId,
    companyName: dossier.companyName,
    symbol: dossier.listing?.symbol || dossier.symbol || null,
    exchange: dossier.listing?.exchange || null,
    origin: dossier.origin || 'FOCUS_UNIVERSE',
    discovery: dossier.discovery || null,
    broadScreen: dossier.broadScreen || null,
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
    action: effectiveAction,
    actionLabel: actionLabel(effectiveAction),
    timeHorizon: dossier.timeHorizon,
    referencePrice: dossier.referencePrice,
    referencePriceAgeHours: ageHours(dossier.referencePrice?.timestamp, generatedAt),
    marketQuote: compactMarketQuote(dossier.marketQuote),
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
    nextStep: dossier.finalAction?.status === 'FINAL'
      ? 'Ανάγνωση τεκμηρίωσης και δική σου τελική απόφαση'
      : dossier.finalAction?.status === 'BLOCKED'
        ? nextStep(blockers)
        : status === 'REVIEW_READY'
          ? 'Τελικός έλεγχος και απόφαση δημοσίευσης'
          : nextStep(blockers),
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
    scoreType: 'DISCOVERY_PRIORITY',
    scoreLabel: 'Προτεραιότητα διερεύνησης',
    investmentScore: null,
    status: candidate.status,
    suggestedAction: 'WATCH',
    suggestedActionLabel: 'Παρακολούθηση μέχρι πλήρη ανάλυση',
    reasons: candidate.reasons || [],
    latestEventAt: candidate.latestEventAt,
    events: candidate.events || [],
    isExistingFocusCompany: candidate.isExistingFocusCompany === true,
  };
}

function compactOpportunityPurchaseDecision(item) {
  return {
    instrumentId: item.instrumentId,
    companyId: item.companyId || item.instrumentId,
    dossierId: item.dossierId || null,
    companyName: item.displayName || null,
    symbol: item.symbol || null,
    assetClass: item.assetClass || null,
    tier: item.tier,
    opportunityScore: item.opportunityScore,
    opportunityConfidenceScore: item.opportunityConfidenceScore ?? item.confidenceScore ?? null,
    status: item.status,
    statusLabel: item.statusLabel,
    buyNowEligible: item.buyNowEligible === true,
    strictAction: item.strictAction || null,
    whyNotBuyNow: item.whyNotBuyNow || [],
    nextGate: item.nextGate || null,
    automaticBrokerOrder: false,
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
  const sellNowDecisions = decisions.filter((item) => item.finalAction?.marketAction === 'SELL_NOW');
  const buyNowDecisions = decisions.filter((item) => item.finalAction?.marketAction === 'BUY_NOW');
  const avoidDecisions = decisions.filter((item) => item.finalAction?.marketAction === 'AVOID');
  const urgent = dossiers.filter((item) => item.finalAction?.urgency === 'IMMEDIATE' || ['EVENT_RISK', 'DETERIORATION'].includes(item.category)).slice(0, 5);
  const discoveryRadar = (report.discovery?.shortlist || []).filter((item) => !item.isExistingFocusCompany).map(compactDiscovery).slice(0, 12);
  const opportunityPurchaseDecisions = (report.opportunityPurchaseReconciliation?.decisions || []).map(compactOpportunityPurchaseDecision);
  const confirmedBuyOpportunities = opportunityPurchaseDecisions.filter((item) => item.status === 'BUY_CONFIRMED');
  const waitingEntryOpportunities = opportunityPurchaseDecisions.filter((item) => item.status === 'WAIT_FOR_ENTRY_CONFIRMATION');
  const rejectedOpportunities = opportunityPurchaseDecisions.filter((item) => item.status === 'REJECTED');
  const blockedOpportunities = opportunityPurchaseDecisions.filter((item) => ['BLOCKED', 'NO_DEEP_DOSSIER'].includes(item.status));
  const actionCounts = countFinalActions(dossiers);
  const quoteRegistry = buildQuoteRegistry(report.marketSnapshots || []);

  return {
    format: 'investor-control-mobile-intelligence-feed',
    version: 2,
    generatedAt,
    policyVersion: report.policyVersion || null,
    sourceSelection: report.discovery?.sourcePolicy || null,
    quoteRegistry,
    operationalHealth: {
      ...(report.operationalHealth || {}),
      status: report.operationalHealth?.status || 'DEGRADED',
      infrastructureStatus: report.operationalHealth?.infrastructureStatus || 'OPERATIONAL',
      marketDataStatus: report.operationalHealth?.marketDataStatus || 'DEGRADED',
      fundamentalsStatus: report.operationalHealth?.fundamentalsStatus || 'DEGRADED',
      researchStatus: report.operationalHealth?.researchStatus || 'ACTIVE',
      decisionEngineStatus: report.operationalHealth?.decisionEngineStatus || (actionCounts.finalActionCount > 0 ? 'READY' : 'BLOCKED_BY_EVIDENCE'),
      generatedAt: report.operationalHealth?.generatedAt || generatedAt,
      staleOutput: false,
    },
    sourceHealth: {
      evidenceCount: Number(report.evidenceCount || 0),
      documentReviewedCount: Number(report.documentReviewedCount || 0),
      independentDiscoveryCount: Number(report.independentDiscoveryCount || 0),
      fundamentalSnapshotCount: Number(report.fundamentalSnapshotCount || 0),
      marketSnapshotCount: Number(report.marketSnapshotCount || 0),
      historicalMarketMetricsCount: Number(report.historicalMarketMetricsCount || 0),
      readyHistoricalMarketMetricsCount: (report.historicalMarketMetrics || []).filter((item) => item?.readiness?.marketMetricsReady === true).length,
      diagnosticCount: Number((report.diagnostics || []).length + (report.discovery?.diagnostics || []).length),
    },
    summary: {
      publishedCount: published.length,
      reviewReadyCount: reviewReady.length,
      researchCount: research.length,
      urgentCount: urgent.length,
      discoveryCandidateCount: discoveryRadar.length,
      discoveryDeepAnalysisCount: Number(report.discovery?.deepAnalysisCompanyCount || 0),
      opportunityCandidateCount: opportunityPurchaseDecisions.length,
      confirmedBuyOpportunityCount: confirmedBuyOpportunities.length,
      waitingEntryOpportunityCount: waitingEntryOpportunities.length,
      rejectedOpportunityCount: rejectedOpportunities.length,
      blockedOpportunityCount: blockedOpportunities.length,
      unresolvedDiagnosticCount: Array.isArray(report.diagnostics) ? report.diagnostics.length : 0,
      ...actionCounts,
    },
    today: {
      headline: confirmedBuyOpportunities.length
        ? `${confirmedBuyOpportunities.length} ευκαιρία${confirmedBuyOpportunities.length === 1 ? '' : 'ες'} αγοράς επιβεβαιώθηκε από όλους τους ελέγχους`
        : actionCounts.sellNowCount
          ? `${actionCounts.sellNowCount} σήμα άμεσης πώλησης ή μείωσης`
          : actionCounts.buyNowCount
            ? `${actionCounts.buyNowCount} επιβεβαιωμένο σήμα άμεσης αγοράς`
            : waitingEntryOpportunities.length
              ? `${waitingEntryOpportunities.length} ισχυρή ευκαιρία υπό αναμονή επιβεβαίωσης εισόδου`
              : actionCounts.avoidCount
                ? `${actionCounts.avoidCount} περίπτωση για αποφυγή`
                : discoveryRadar.length
                  ? `${discoveryRadar.length} νέες μετοχές εντοπίστηκαν αυτόματα για έλεγχο`
                  : urgent.length
                    ? `${urgent.length} υπόθεση${urgent.length === 1 ? '' : 'εις'} αυξημένης προτεραιότητας`
                    : reviewReady.length
                      ? `${reviewReady.length} φάκελο${reviewReady.length === 1 ? 'ς' : 'ι'} έτοιμο για έλεγχο`
                      : 'Δεν υπάρχει ακόμη δημοσιεύσιμη επενδυτική πρόταση',
      primaryItem: confirmedBuyOpportunities[0] || sellNowDecisions[0] || buyNowDecisions[0] || waitingEntryOpportunities[0] || avoidDecisions[0] || urgent[0] || decisions[0] || reviewReady[0] || research[0] || null,
    },
    opportunityPurchaseDecisions,
    confirmedBuyOpportunities,
    waitingEntryOpportunities,
    rejectedOpportunities,
    blockedOpportunities,
    discoveryRadar,
    decisions,
    published,
    reviewReady,
    research,
    urgent,
    opportunityAssistantContext: opportunityPurchaseDecisions.map((item) => ({
      companyId: item.companyId,
      companyName: item.companyName,
      symbol: item.symbol,
      tier: item.tier,
      opportunityScore: item.opportunityScore,
      status: item.status,
      buyNowEligible: item.buyNowEligible,
      whyNotBuyNow: item.whyNotBuyNow,
      nextGate: item.nextGate,
      strictAction: item.strictAction,
    })),
    assistantContext: dossiers.map((item) => ({
      companyId: item.companyId,
      companyName: item.companyName,
      symbol: item.symbol,
      origin: item.origin,
      discovery: item.discovery,
      broadScreen: item.broadScreen,
      status: item.status,
      category: item.category,
      action: item.action,
      finalAction: item.finalAction,
      thesis: item.thesis,
      blockers: item.blockers,
      nextStep: item.nextStep,
      reviewDate: item.reviewDate,
    })),
    disclosure: 'Ο Opportunity Hunter σαρώνει ευρύ επενδυτικό universe και προτεραιοποιεί υποψήφιες ευκαιρίες. High/Super Opportunity δεν σημαίνει αγορά. Μόνο η δεύτερη αυστηρή αξιολόγηση BUY, με πλήρη έλεγχο πηγών, θεμελιωδών, αγοράς, ρευστότητας, φρεσκότητας, τάσης, ρίσκου και αντιφάσεων, μπορεί να εμφανίσει ΑΓΟΡΑ ΕΠΙΒΕΒΑΙΩΘΗΚΕ. Δεν εκτελούνται συναλλαγές.',
  };
}
