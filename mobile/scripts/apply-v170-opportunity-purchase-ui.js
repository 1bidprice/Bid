const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const storePath = path.join(root, 'src', 'intelligence-feed-store.js');
const opportunitiesPath = path.join(root, 'src', 'OpportunitiesView.js');

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.7.0 mobile patch failed: missing ${label}`);
  return source.replace(from, to);
}

let store = fs.readFileSync(storePath, 'utf8');

store = replaceRequired(
  store,
  "const FEED_VERSION = 1;",
  "const LEGACY_FEED_VERSION = 1;\nconst FEED_VERSION = 2;\nconst SUPPORTED_FEED_VERSIONS = new Set([LEGACY_FEED_VERSION, FEED_VERSION]);",
  'feed version contract',
);

store = replaceRequired(
  store,
  `function safeArray(value) {\n  return Array.isArray(value) ? value : [];\n}\n\nfunction normalizeItem(item) {`,
  `function safeArray(value) {\n  return Array.isArray(value) ? value : [];\n}\n\nconst OPPORTUNITY_PURCHASE_STATUSES = new Set([\n  'BUY_CONFIRMED',\n  'WAIT_FOR_ENTRY_CONFIRMATION',\n  'REJECTED',\n  'BLOCKED',\n  'NO_DEEP_DOSSIER',\n]);\n\nfunction normalizeOpportunityPurchaseDecision(item) {\n  const rawStatus = OPPORTUNITY_PURCHASE_STATUSES.has(item?.status) ? item.status : 'BLOCKED';\n  const strictAction = item?.strictAction && typeof item.strictAction === 'object' ? item.strictAction : null;\n  const strictBuyConfirmed = rawStatus === 'BUY_CONFIRMED'\n    && item?.buyNowEligible === true\n    && strictAction?.status === 'FINAL'\n    && strictAction?.nonHolderAction === 'BUY_NOW';\n  const status = rawStatus === 'BUY_CONFIRMED' && !strictBuyConfirmed ? 'BLOCKED' : rawStatus;\n  const statusLabel = status === rawStatus && item?.statusLabel\n    ? String(item.statusLabel)\n    : status === 'BLOCKED'\n      ? 'ΜΠΛΟΚΑΡΙΣΜΕΝΟ — ΛΕΙΠΟΥΝ ΕΛΕΓΧΟΙ'\n      : String(item?.statusLabel || status);\n  return {\n    ...item,\n    instrumentId: item?.instrumentId || item?.companyId || null,\n    companyId: item?.companyId || item?.instrumentId || null,\n    companyName: item?.companyName || item?.displayName || null,\n    status,\n    statusLabel,\n    buyNowEligible: status === 'BUY_CONFIRMED' && strictBuyConfirmed,\n    strictAction,\n    whyNotBuyNow: safeArray(item?.whyNotBuyNow),\n    nextGate: item?.nextGate || null,\n    automaticBrokerOrder: false,\n  };\n}\n\nfunction normalizeItem(item) {`,
  'opportunity purchase normalizer anchor',
);

store = replaceRequired(
  store,
  "  if (payload?.format !== FEED_FORMAT || Number(payload?.version) !== FEED_VERSION) {",
  "  if (payload?.format !== FEED_FORMAT || !SUPPORTED_FEED_VERSIONS.has(Number(payload?.version))) {",
  'supported feed version validation',
);

store = replaceRequired(
  store,
  `  const urgent = all.filter((item) => urgentIds.has(item.id));\n  return {`,
  `  const urgent = all.filter((item) => urgentIds.has(item.id));\n  const opportunityPurchaseDecisions = safeArray(payload.opportunityPurchaseDecisions).map(normalizeOpportunityPurchaseDecision);\n  const confirmedBuyOpportunities = opportunityPurchaseDecisions.filter((item) => item.status === 'BUY_CONFIRMED' && item.buyNowEligible === true);\n  const waitingEntryOpportunities = opportunityPurchaseDecisions.filter((item) => item.status === 'WAIT_FOR_ENTRY_CONFIRMATION');\n  const rejectedOpportunities = opportunityPurchaseDecisions.filter((item) => item.status === 'REJECTED');\n  const blockedOpportunities = opportunityPurchaseDecisions.filter((item) => ['BLOCKED', 'NO_DEEP_DOSSIER'].includes(item.status));\n  return {`,
  'opportunity purchase decision derivation',
);

store = replaceRequired(
  store,
  `      urgentCount: urgent.length,\n      unresolvedDiagnosticCount: Math.max(0, Number(payload.summary?.unresolvedDiagnosticCount || 0)),`,
  `      urgentCount: urgent.length,\n      opportunityCandidateCount: opportunityPurchaseDecisions.length,\n      confirmedBuyOpportunityCount: confirmedBuyOpportunities.length,\n      waitingEntryOpportunityCount: waitingEntryOpportunities.length,\n      rejectedOpportunityCount: rejectedOpportunities.length,\n      blockedOpportunityCount: blockedOpportunities.length,\n      unresolvedDiagnosticCount: Math.max(0, Number(payload.summary?.unresolvedDiagnosticCount || 0)),`,
  'opportunity purchase summary counters',
);

store = replaceRequired(
  store,
  `    research,\n    urgent,\n    assistantContext: safeArray(payload.assistantContext),`,
  `    research,\n    urgent,\n    opportunityPurchaseDecisions,\n    confirmedBuyOpportunities,\n    waitingEntryOpportunities,\n    rejectedOpportunities,\n    blockedOpportunities,\n    opportunityAssistantContext: opportunityPurchaseDecisions.map((item) => ({\n      companyId: item.companyId,\n      companyName: item.companyName,\n      symbol: item.symbol,\n      tier: item.tier,\n      opportunityScore: item.opportunityScore,\n      status: item.status,\n      buyNowEligible: item.buyNowEligible,\n      whyNotBuyNow: item.whyNotBuyNow,\n      nextGate: item.nextGate,\n      strictAction: item.strictAction,\n    })),\n    assistantContext: safeArray(payload.assistantContext),`,
  'opportunity purchase feed preservation',
);

fs.writeFileSync(storePath, store);

let opportunities = fs.readFileSync(opportunitiesPath, 'utf8');

const purchaseComponents = `function purchaseReasonLabel(reason) {\n  return {\n    FULL_DEEP_DOSSIER_REQUIRED: 'Απαιτείται πλήρης βαθιά ανάλυση πριν εξεταστεί αγορά.',\n    BUY_SETUP_NOT_CONFIRMED: 'Δεν έχουν επιβεβαιωθεί ακόμη όλα τα κριτήρια εισόδου.',\n    FINAL_ACTION_BLOCKED: 'Η τελική απόφαση παραμένει μπλοκαρισμένη από υποχρεωτικούς ελέγχους.',\n    SEVERE_RISK_CONFIGURATION: 'Ο συνδυασμός κινδύνων είναι υπερβολικός για αγορά.',\n    REFERENCE_PRICE_REQUIRED: 'Λείπει έγκυρη τιμή αναφοράς.',\n    REFERENCE_PRICE_STALE_FOR_PUBLICATION: 'Η τιμή αναφοράς δεν είναι αρκετά φρέσκια.',\n    FUNDAMENTALS_REQUIRED: 'Λείπουν επαρκή θεμελιώδη στοιχεία.',\n    HISTORICAL_MARKET_METRICS_REQUIRED: 'Λείπει επαρκές ιστορικό αγοράς και ρευστότητας.',\n    INDEPENDENT_CROSS_CHECK_REQUIRED: 'Λείπει ανεξάρτητη διασταύρωση.',\n  }[reason] || String(reason || '').replace(/_/g, ' ').toLowerCase();\n}\n\nfunction purchaseNextGateLabel(gate) {\n  return {\n    USER_EXECUTION_ONLY: 'Η απόφαση είναι επιβεβαιωμένη. Τυχόν εκτέλεση γίνεται μόνο από εσένα.',\n    RECHECK_STRICT_BUY_GATES: 'Επανέλεγχος των αυστηρών BUY gates όταν αλλάξουν τα δεδομένα.',\n    NEW_EVIDENCE_OR_MATERIAL_CHANGE: 'Νέα ουσιαστικά στοιχεία ή σημαντική αλλαγή πριν επανεξεταστεί.',\n    COMPLETE_BLOCKING_CHECKS: 'Ολοκλήρωση όλων των ελέγχων που λείπουν.',\n    FULL_DEEP_DOSSIER: 'Ολοκλήρωση πλήρους επενδυτικού φακέλου.',\n  }[gate] || 'Παρακολούθηση μέχρι τον επόμενο αυστηρό έλεγχο.';\n}\n\nfunction OpportunityPurchaseCard({ item }) {\n  const confirmed = item.status === 'BUY_CONFIRMED' && item.buyNowEligible === true;\n  const waiting = item.status === 'WAIT_FOR_ENTRY_CONFIRMATION';\n  const rejected = item.status === 'REJECTED';\n  const score = Number(item.opportunityScore);\n  return (\n    <View style={[styles.card, rejected && styles.riskCard]}>\n      <View style={styles.rowTop}>\n        <View style={styles.grow}>\n          <Text style={styles.company}>{item.companyName || item.symbol || item.instrumentId || 'Επενδυτική ευκαιρία'}</Text>\n          <Text style={styles.symbol}>{item.symbol || item.assetClass || '—'} · {item.tier || '—'}</Text>\n        </View>\n        <View style={[styles.badge, confirmed && styles.badgePublished, waiting && styles.badgeReview]}>\n          <Text style={[styles.badgeText, confirmed && styles.badgePublishedText, waiting && styles.badgeReviewText]}>{item.statusLabel || item.status}</Text>\n        </View>\n      </View>\n      <View style={styles.actionRow}>\n        <View style={styles.actionBox}>\n          <Text style={styles.muted}>Opportunity score</Text>\n          <Text style={styles.action}>{Number.isFinite(score) ? score.toFixed(1) : '—'}</Text>\n        </View>\n        <View style={styles.actionBox}>\n          <Text style={styles.muted}>Strict BUY</Text>\n          <Text style={[styles.action, rejected && styles.riskText]}>{confirmed ? 'ΕΠΙΒΕΒΑΙΩΘΗΚΕ' : 'ΟΧΙ'}</Text>\n        </View>\n      </View>\n      {confirmed ? (\n        <View style={styles.nextBox}>\n          <Text style={styles.nextLabel}>ΑΓΟΡΑ ΕΠΙΒΕΒΑΙΩΘΗΚΕ</Text>\n          <Text style={styles.nextText}>Πέρασε την ίδια αυστηρή τελική πολιτική BUY_NOW. Καμία εντολή broker δεν εκτελείται αυτόματα.</Text>\n        </View>\n      ) : item.whyNotBuyNow?.length ? (\n        <View style={styles.blockers}>\n          <Text style={styles.blockerTitle}>Γιατί δεν είναι αγορά τώρα</Text>\n          {item.whyNotBuyNow.slice(0, 5).map((reason, index) => <Text key={\`purchase-reason-\${index}\`} style={styles.blockerText}>• {purchaseReasonLabel(reason)}</Text>)}\n        </View>\n      ) : null}\n      <View style={styles.nextBox}>\n        <Text style={styles.nextLabel}>Επόμενη πύλη</Text>\n        <Text style={styles.nextText}>{purchaseNextGateLabel(item.nextGate)}</Text>\n      </View>\n    </View>\n  );\n}\n\nfunction PurchaseSection({ title, subtitle, items }) {\n  if (!items.length) return null;\n  return (\n    <View style={styles.sectionBlock}>\n      <Text style={styles.sectionTitle}>{title}</Text>\n      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}\n      {items.map((item, index) => <OpportunityPurchaseCard key={item.instrumentId || item.companyId || \`purchase-\${index}\`} item={item} />)}\n    </View>\n  );\n}\n\n`;

opportunities = replaceRequired(
  opportunities,
  `function Section({ title, subtitle, items }) {`,
  `${purchaseComponents}function Section({ title, subtitle, items }) {`,
  'opportunity purchase UI component anchor',
);

opportunities = replaceRequired(
  opportunities,
  `          <Section title="Αυξημένη προτεραιότητα" subtitle="Κίνδυνοι ή εξελίξεις που χρειάζονται πρώτα προσοχή" items={feed.urgent || []} />`,
  `          <PurchaseSection title="ΑΓΟΡΑ ΕΠΙΒΕΒΑΙΩΘΗΚΕ" subtitle="Μόνο ευκαιρίες που πέρασαν και τη δεύτερη αυστηρή πολιτική BUY_NOW. Καμία αυτόματη συναλλαγή." items={feed.confirmedBuyOpportunities || []} />\n          <PurchaseSection title="Ισχυρές ευκαιρίες — αναμονή εισόδου" subtitle="Υψηλή κατάταξη Opportunity Hunter, αλλά δεν έχουν επιβεβαιωθεί ακόμη όλα τα strict BUY gates." items={feed.waitingEntryOpportunities || []} />\n          <PurchaseSection title="Απορρίφθηκαν για αγορά" subtitle="Ο Opportunity Hunter τις εντόπισε, αλλά ο αυστηρός τελικός έλεγχος απέρριψε αγορά με τα τωρινά δεδομένα." items={feed.rejectedOpportunities || []} />\n          <PurchaseSection title="Μπλοκαρισμένες ευκαιρίες" subtitle="Χρειάζονται πλήρη ανάλυση ή υποχρεωτικούς ελέγχους πριν μπορούν να αξιολογηθούν για αγορά." items={feed.blockedOpportunities || []} />\n\n          <Section title="Αυξημένη προτεραιότητα" subtitle="Κίνδυνοι ή εξελίξεις που χρειάζονται πρώτα προσοχή" items={feed.urgent || []} />`,
  'opportunity purchase UI sections',
);

opportunities = replaceRequired(
  opportunities,
  `          {!feed.published?.length && !feed.reviewReady?.length && !feed.research?.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>Η σύνδεση λειτουργεί, αλλά η τρέχουσα ροή δεν περιέχει ακόμη εταιρικούς φακέλους.</Text><Text style={styles.emptyText}>Αυτό είναι ασφαλέστερο από το να εμφανιστεί μη τεκμηριωμένη πρόταση. Η επόμενη επιτυχής ημερήσια εκτέλεση θα ενημερώσει αυτόματα την οθόνη.</Text></View> : null}`,
  `          {!feed.published?.length && !feed.reviewReady?.length && !feed.research?.length && !feed.opportunityPurchaseDecisions?.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>Η σύνδεση λειτουργεί, αλλά η τρέχουσα ροή δεν περιέχει ακόμη εταιρικούς φακέλους.</Text><Text style={styles.emptyText}>Αυτό είναι ασφαλέστερο από το να εμφανιστεί μη τεκμηριωμένη πρόταση. Η επόμενη επιτυχής ημερήσια εκτέλεση θα ενημερώσει αυτόματα την οθόνη.</Text></View> : null}`,
  'empty-state hunter awareness',
);

fs.writeFileSync(opportunitiesPath, opportunities);

const verifiedStore = fs.readFileSync(storePath, 'utf8');
const verifiedOpportunities = fs.readFileSync(opportunitiesPath, 'utf8');
for (const invariant of [
  'SUPPORTED_FEED_VERSIONS',
  'normalizeOpportunityPurchaseDecision',
  'confirmedBuyOpportunities',
  'waitingEntryOpportunities',
  'rejectedOpportunities',
  'blockedOpportunities',
  'automaticBrokerOrder: false',
]) {
  if (!verifiedStore.includes(invariant)) throw new Error(`Investor Control v1.7.0 mobile verification failed: store missing ${invariant}`);
}
for (const invariant of [
  'function OpportunityPurchaseCard',
  'function PurchaseSection',
  'feed.confirmedBuyOpportunities',
  'feed.waitingEntryOpportunities',
  'feed.rejectedOpportunities',
  'feed.blockedOpportunities',
  'Καμία εντολή broker δεν εκτελείται αυτόματα.',
]) {
  if (!verifiedOpportunities.includes(invariant)) throw new Error(`Investor Control v1.7.0 mobile verification failed: UI missing ${invariant}`);
}

console.log('Investor Control v1.7.0 mobile feed v2 compatibility and reconciled Opportunity Hunter UI applied.');
