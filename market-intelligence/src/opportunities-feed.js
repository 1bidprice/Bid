function actionPriority(action) {
  return {
    CONSIDER_BUY: 5,
    CONSIDER_REDUCE: 4,
    AVOID: 3,
    HOLD: 2,
    WATCH: 1,
  }[action] || 0;
}

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

export function buildOpportunitiesFeed(dossiers = [], options = {}) {
  const includeReviewReady = options.includeReviewReady === true;
  const eligibleStatuses = includeReviewReady ? ['PUBLISHED', 'REVIEW_READY'] : ['PUBLISHED'];
  const rejected = [];
  const items = [];

  for (const dossier of dossiers) {
    if (!eligibleStatuses.includes(dossier?.status)) {
      rejected.push({ dossierId: dossier?.dossierId || null, reason: 'DOSSIER_NOT_PUBLISHED' });
      continue;
    }
    if (dossier?.readiness?.publishable !== true || !dossier?.referencePrice) {
      rejected.push({ dossierId: dossier?.dossierId || null, reason: 'DOSSIER_NOT_READY' });
      continue;
    }

    items.push({
      id: dossier.dossierId,
      companyId: dossier.companyId,
      companyName: dossier.companyName,
      symbol: dossier.listing.symbol,
      exchange: dossier.listing.exchange,
      category: dossier.category,
      categoryLabel: categoryLabel(dossier.category),
      action: dossier.proposedAction,
      actionLabel: actionLabel(dossier.proposedAction),
      timeHorizon: dossier.timeHorizon,
      referencePrice: dossier.referencePrice,
      thesis: dossier.thesis,
      catalysts: dossier.catalysts,
      risks: dossier.risks,
      invalidationCondition: dossier.invalidationCondition,
      reviewDate: dossier.reviewDate,
      evidenceCount: dossier.evidence.length,
      generatedAt: dossier.generatedAt,
      disclosure: dossier.disclosure,
    });
  }

  items.sort((a, b) => {
    const actionOrder = actionPriority(b.action) - actionPriority(a.action);
    if (actionOrder) return actionOrder;
    return String(b.generatedAt).localeCompare(String(a.generatedAt));
  });

  return {
    format: 'investor-control-opportunities-feed',
    version: 1,
    generatedAt: new Date(options.generatedAt || Date.now()).toISOString(),
    itemCount: items.length,
    items,
    rejected,
  };
}
