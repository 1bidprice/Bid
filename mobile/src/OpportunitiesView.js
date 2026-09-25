import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  clearIntelligenceFeed,
  importIntelligenceFeedAsync,
  intelligenceFeedFreshness,
  loadCachedIntelligenceFeed,
  loadIntelligenceSyncState,
  syncIntelligenceFeedAsync,
} from './intelligence-feed-store';
import FinalDecisionCard from './FinalDecisionCard';
import { finalActionIsCurrent } from './decision-validity';
import { intelligenceSystemReady } from './intelligence-readiness';
import { applyMinbeisPortfolioSizing } from './minbeis-portfolio-sizing';
import { buildPersonalizedMinbeisDashboard } from './minbeis-mobile-decision';
import { recordLocalMinbeisClarityFeedback, startLocalMinbeisProductSession } from './minbeis-product-metrics';

function money(referencePrice, item) {
  const value = Number(referencePrice?.value);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const currency = inferredReferenceCurrency(referencePrice, item);
  if (!currency) return `${value.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} · νόμισμα μη διαθέσιμο`;
  try {
    return new Intl.NumberFormat('el-GR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(value);
  } catch {
    return `${value.toLocaleString('el-GR')} ${currency}`.trim();
  }
}

function canonicalDecisionSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/\.(US|GR)$/, '');
}

function inferredReferenceCurrency(referencePrice, item) {
  const explicit = String(referencePrice?.currency || item?.marketQuote?.currency || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(explicit)) return explicit;
  const symbol = String(item?.marketQuote?.appSymbol || item?.symbol || '').trim().toUpperCase();
  const exchange = String(item?.exchange || '').trim().toUpperCase();
  if (symbol.endsWith('.US') || /NASDAQ|NYSE|NEW YORK STOCK EXCHANGE/.test(exchange)) return 'USD';
  if (symbol.endsWith('.GR') || /EURONEXT ATHENS|ATHENS/.test(exchange)) return 'EUR';
  return null;
}

function personalizedDecisionCounts(feed, portfolioPositions, decisionContext = {}) {
  const held = new Set((Array.isArray(portfolioPositions) ? portfolioPositions : [])
    .filter((position) => Number(position?.quantity || 0) > 0)
    .map((position) => canonicalDecisionSymbol(position?.symbol))
    .filter(Boolean));
  const decisions = Array.isArray(feed?.decisions) ? feed.decisions : [];
  let buyNowCount = 0;
  let sellNowCount = 0;
  for (const item of decisions) {
    const finalAction = item?.finalAction;
    if (!finalActionIsCurrent(finalAction, decisionContext)) continue;
    const hasPosition = held.has(canonicalDecisionSymbol(item?.symbol));
    const action = hasPosition ? finalAction.holderAction : finalAction.nonHolderAction;
    if (action === 'BUY_NOW') buyNowCount += 1;
    if (action === 'SELL_NOW') sellNowCount += 1;
  }
  return {
    ...(feed?.summary || {}),
    buyNowCount,
    sellNowCount,
    finalActionCount: decisions.length || Number(feed?.summary?.finalActionCount || 0),
  };
}

function when(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('el-GR');
}

function claimText(value) {
  if (typeof value === 'string') return value;
  return value?.text || '';
}

function StatusBadge({ item }) {
  const review = item.status === 'REVIEW_READY';
  const published = item.status === 'PUBLISHED';
  return (
    <View style={[styles.badge, review && styles.badgeReview, published && styles.badgePublished]}>
      <Text style={[styles.badgeText, review && styles.badgeReviewText, published && styles.badgePublishedText]}>{item.statusLabel}</Text>
    </View>
  );
}

function IntelligenceCard({ item, decisionContext }) {
  const [expanded, setExpanded] = useState(false);
  const risk = ['EVENT_RISK', 'DETERIORATION'].includes(item.category);
  const referenceAge = Number(item.referencePriceAgeHours);
  return (
    <View style={[styles.card, risk && styles.riskCard]}>
      <Pressable onPress={() => setExpanded((current) => !current)}>
        <View style={styles.rowTop}>
          <View style={styles.grow}>
            <Text style={styles.company}>{item.companyName}</Text>
            <Text style={styles.symbol}>{item.symbol || '—'} · {item.exchange || '—'}</Text>
          </View>
          <StatusBadge item={item} />
        </View>
        <Text style={[styles.category, risk && styles.riskText]}>{item.categoryLabel}</Text>
        <MinbeisAssessmentStrip assessment={item.minbeisAssessment} />
        <HistoricalContextCard context={item.historicalContext} />
        <FinalDecisionCard item={item} decisionContext={decisionContext} />
        <View style={styles.actionRow}>
          <View style={styles.actionBox}><Text style={styles.muted}>Γενική ερευνητική ένδειξη</Text><Text style={[styles.action, risk && styles.riskText]}>{item.actionLabel}</Text><Text style={styles.ageText}>Δεν είναι η προσωπική σου πράξη</Text></View>
          <View style={styles.actionBox}><Text style={styles.muted}>Τιμή αναφοράς</Text><Text style={styles.action}>{money(item.referencePrice, item)}</Text><Text style={styles.ageText}>{Number.isFinite(referenceAge) ? (referenceAge < 1 ? 'πριν από λιγότερο από 1 ώρα' : 'πριν από ' + referenceAge.toFixed(1) + ' ώρες') : 'χωρίς έγκυρη ώρα'}</Text></View>
        </View>
        {item.marketQuote?.quoteContract?.publicMessage ? <View style={styles.marketQuoteContract}><Text style={styles.marketQuoteContractText}>{item.marketQuote.quoteContract.publicMessage}</Text></View> : null}
        {item.thesis ? <Text style={styles.thesis} numberOfLines={expanded ? undefined : 4}>{item.thesis}</Text> : <Text style={styles.warning}>Δεν έχει ολοκληρωθεί ακόμη τεκμηριωμένη επενδυτική θέση.</Text>}
        <View style={styles.nextBox}><Text style={styles.nextLabel}>Επόμενο βήμα</Text><Text style={styles.nextText}>{item.nextStep}</Text></View>
        <Text style={styles.expand}>{expanded ? 'Απόκρυψη λεπτομερειών' : 'Προβολή πλήρους φακέλου'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.details}>
          <View style={styles.timeContext}><Text style={styles.timeTitle}>Χρόνοι ανάλυσης</Text><Text style={styles.timeText}>Τελευταία αυτόματη ενημέρωση: {when(item.generatedAt)}</Text><Text style={styles.timeText}>Επίσημη επανεξέταση επενδυτικής υπόθεσης: {item.reviewDate || '—'}</Text></View>
          {item.metricNotes?.map((note, index) => <View key={'m-' + index} style={styles.metricNote}><Text style={styles.metricNoteTitle}>Επεξήγηση ακραίας μέτρησης</Text><Text style={styles.detailText}>{note}</Text></View>)}
          {item.causalMechanism ? <><Text style={styles.detailTitle}>Γιατί μπορεί να επηρεάσει τη μετοχή</Text><Text style={styles.detailText}>{item.causalMechanism}</Text></> : null}
          {item.bullCase ? <><Text style={styles.detailTitle}>Θετικό σενάριο</Text><Text style={styles.detailText}>{item.bullCase}</Text></> : null}
          {item.bearCase ? <><Text style={styles.detailTitle}>Αρνητικό σενάριο</Text><Text style={styles.detailText}>{item.bearCase}</Text></> : null}
          {item.invalidationCondition ? <View style={styles.invalidation}><Text style={styles.invalidationTitle}>Τι ακυρώνει την υπόθεση</Text><Text style={styles.detailText}>{item.invalidationCondition}</Text></View> : null}
          {item.catalysts?.length ? <><Text style={styles.detailTitle}>Καταλύτες</Text>{item.catalysts.map((entry, index) => <Text key={'c-' + index} style={styles.bullet}>• {claimText(entry)}</Text>)}</> : null}
          {item.risks?.length ? <><Text style={styles.detailTitle}>Κίνδυνοι</Text>{item.risks.map((entry, index) => <Text key={'r-' + index} style={styles.bullet}>• {claimText(entry)}</Text>)}</> : null}
          {item.blockerLabels?.length ? <View style={styles.blockers}><Text style={styles.blockerTitle}>Γιατί δεν είναι ακόμη τελική πρόταση</Text>{item.blockerLabels.map((label, index) => <Text key={'b-' + index} style={styles.blockerText}>• {label}</Text>)}</View> : null}
          <Text style={styles.detailTitle}>Πηγές</Text>
          {item.sources?.length ? item.sources.map((sourceItem, index) => <Pressable key={sourceItem.sourceUrl + '-' + index} style={styles.sourceRow} onPress={() => Linking.openURL(sourceItem.sourceUrl).catch(() => Alert.alert('Πηγή', 'Δεν ήταν δυνατό να ανοίξει ο σύνδεσμος.'))}><View style={styles.grow}><Text style={styles.sourceName}>{sourceItem.sourceName}</Text><Text style={styles.sourceTitle}>{sourceItem.title}</Text></View><Text style={styles.sourceState}>{sourceItem.reviewed ? 'Ελεγμένη' : 'Εντοπίστηκε'}</Text></Pressable>) : <Text style={styles.muted}>Δεν υπάρχουν διαθέσιμες πηγές στην τρέχουσα ροή.</Text>}
        </View>
      ) : null}
    </View>
  );
}

function DiscoveryRadarCard({ item }) {
  return <View style={styles.discoveryCard}><View style={styles.rowTop}><View style={styles.grow}><Text style={styles.company}>{item.companyName}</Text><Text style={styles.symbol}>{item.symbol || '—'} · {item.exchange || '—'}</Text></View><View style={styles.discoveryScore}><Text style={styles.discoveryScoreValue}>{Math.round(Number(item.discoveryScore || 0))}</Text><Text style={styles.discoveryScoreLabel}>προτερ.</Text></View></View><Text style={styles.discoveryStatus}>ΑΥΤΟΜΑΤΗ ΑΝΑΚΑΛΥΨΗ · ΟΧΙ ΑΚΟΜΗ ΠΡΟΤΑΣΗ ΑΓΟΡΑΣ</Text><Text style={styles.discoveryDisclaimer}>Βαθμός προτεραιότητας διερεύνησης — όχι επενδυτική βαθμολογία.</Text>{(item.reasons || []).slice(0, 3).map((reason, index) => <Text key={index} style={styles.discoveryReason}>• {reason}</Text>)}<Text style={styles.discoveryTime}>Νεότερο γεγονός: {when(item.latestEventAt)}</Text></View>;
}

function historicalHorizonLabel(key) {
  return {
    week1: '1 εβδομάδα',
    month1: '1 μήνας',
    month3: '3 μήνες',
  }[key] || key;
}

function HistoricalContextCard({ context }) {
  const [expanded, setExpanded] = useState(false);
  if (!context || context.status !== 'RESEARCH_READY_UNCALIBRATED') return null;
  const rows = Object.entries(context.horizons || {}).filter(([, item]) => item?.status === 'RESEARCH_READY_UNCALIBRATED');
  if (!rows.length) return null;
  return (
    <View style={styles.historicalCard}>
      <Pressable onPress={() => setExpanded((value) => !value)} style={styles.historicalHeader}>
        <View style={styles.grow}>
          <Text style={styles.historicalTitle}>Ιστορικά ανάλογα</Text>
          <Text style={styles.historicalMeta}>Research context · όχι πρόβλεψη</Text>
        </View>
        <Text style={styles.historicalToggle}>{expanded ? 'Απόκρυψη' : 'Προβολή'}</Text>
      </Pressable>
      {expanded ? <>
        {context.regime ? <Text style={styles.historicalMeta}>Regime: {String(context.regime).replace(/_/g, ' ')}</Text> : null}
        {rows.map(([key, item]) => (
          <View key={key} style={styles.historicalRow}>
            <Text style={styles.historicalHorizon}>{historicalHorizonLabel(key)}</Text>
            <Text style={styles.historicalValue}>
              {Number.isFinite(Number(item.historicalPositiveFrequencyPct)) ? `${Number(item.historicalPositiveFrequencyPct).toFixed(0)}% θετικές ιστορικές εκβάσεις` : 'χωρίς επαρκή συχνότητα'}
            </Text>
            <Text style={styles.historicalMeta}>{item.selectedAnalogCount || 0} ανεξάρτητα ανάλογα · effective sample {Number.isFinite(Number(item.effectiveSampleSize)) ? Number(item.effectiveSampleSize).toFixed(1) : '—'}</Text>
          </View>
        ))}
        <Text style={styles.historicalCaution}>{context.caution}</Text>
      </> : null}
    </View>
  );
}

function minbeisAssessmentLabel(classification) {
  return {
    SETUP: 'SETUP',
    TRAP: 'TRAP',
    NO_TRADE: 'NO-TRADE',
    CONFIRMATION_REQUIRED: 'ΧΡΕΙΑΖΕΤΑΙ ΕΠΙΒΕΒΑΙΩΣΗ',
  }[classification] || classification || '—';
}

function MinbeisAssessmentStrip({ assessment, compact = false }) {
  if (!assessment) return null;
  const classification = assessment.classification;
  const risk = classification === 'TRAP';
  const setup = classification === 'SETUP';
  return (
    <View style={[styles.assessmentStrip, risk && styles.assessmentTrap, setup && styles.assessmentSetup]}>
      <View style={styles.rowTop}>
        <Text style={[styles.assessmentLabel, risk && styles.riskText]}>{minbeisAssessmentLabel(classification)}</Text>
        <Text style={styles.assessmentMeta}>MINBEIS</Text>
      </View>
      {!compact && assessment?.explanation?.summary ? <Text style={styles.assessmentSummary}>{assessment.explanation.summary}</Text> : null}
      {!compact && assessment?.explanation?.whatWouldChange ? <Text style={styles.assessmentChange}>Τι θα άλλαζε την εικόνα: {assessment.explanation.whatWouldChange}</Text> : null}
    </View>
  );
}

function minbeisActionLabel(action) {
  return {
    NO_BUY: 'NO BUY',
    WATCH: 'WATCH',
    HOLD: 'HOLD',
    REDUCE: 'REDUCE',
    BUY_PROBE: 'BUY PROBE',
    BUY_STARTER: 'BUY STARTER',
    BUY_CORE: 'BUY CORE',
  }[action] || action || '—';
}

function minbeisAllocationText(decision) {
  const adjusted = Number(decision?.portfolioAdjustedAllocationPct);
  const base = Number(decision?.allocationPct);
  const value = Number.isFinite(adjusted) ? adjusted : base;
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${value.toLocaleString('el-GR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}% χαρτοφυλακίου`;
}

function minbeisReasonText(row) {
  return {
    HOLDER_SELL_NOW: 'Η θέση σου έχει ενεργό σήμα μείωσης/πώλησης από τον canonical decision engine.',
    HOLDER_HOLD: 'Η θέση σου παραμένει σε διακράτηση με τα τρέχοντα επαληθευμένα δεδομένα.',
    HOLDER_WATCH: 'Δεν υπάρχει ενεργή εντολή μείωσης ή ενίσχυσης για τη θέση σου.',
    STRICT_PURCHASE_CONFIRMED: 'Η νέα αγορά πέρασε και το strict purchase reconciliation.',
    BUY_REQUIRES_STRICT_PURCHASE_CONFIRMATION: 'Υπάρχει θετική κατεύθυνση, αλλά δεν έχει περάσει ακόμη το strict purchase reconciliation.',
    NON_HOLDER_BLOCKED: 'Η τρέχουσα canonical απόφαση δεν επιτρέπει νέα αγορά.',
    NON_HOLDER_WATCH: 'Δεν υπάρχει επιβεβαιωμένη αγορά τώρα· παραμένει σε παρακολούθηση.',
  }[row?.reason] || 'Η απόφαση προκύπτει από τον canonical MINBEIS decision engine.';
}

function portfolioBlockedReason(item) {
  const blockers = Array.isArray(item?.finalAction?.blockers) ? item.finalAction.blockers : [];
  const labels = {
    ACTIVE_LISTING_NOT_VERIFIED: 'Χρειάζεται επιβεβαίωση ότι η μετοχή διαπραγματεύεται ενεργά.',
    LISTING_NOT_ACTIVE: 'Η κατάσταση της εισαγωγής δεν επιτρέπει ενεργή επενδυτική απόφαση.',
    REFERENCE_PRICE_TIMESTAMP_NOT_VERIFIED: 'Η τιμή υπάρχει, αλλά ο ακριβής χρόνος της δεν είναι επαληθευμένος για τελική απόφαση.',
    REFERENCE_PRICE_NOT_DECISION_ELIGIBLE: 'Η διαθέσιμη τιμή είναι κατάλληλη για ενημέρωση/αποτίμηση, όχι για τελική επενδυτική πράξη.',
    REFERENCE_PRICE_NOT_EXECUTION_ELIGIBLE: 'Η διαθέσιμη τιμή δεν είναι αρκετά φρέσκια για execution-sensitive απόφαση.',
    QUOTE_TIMESTAMP_NOT_VERIFIED: 'Ο χρόνος της χρηματιστηριακής τιμής δεν είναι επαληθευμένος.',
    QUOTE_NOT_DECISION_ELIGIBLE: 'Η τρέχουσα χρηματιστηριακή τιμή δεν επιτρέπεται να οδηγήσει τελική απόφαση.',
  };
  const explained = blockers.map((code) => labels[code]).filter(Boolean);
  if (explained.length) return explained.join(' ');
  return item?.nextStep || 'Η ανάλυση υπάρχει, αλλά ένας υποχρεωτικός έλεγχος δεν έχει ολοκληρωθεί.';
}

function blockedPortfolioDossierIndex(feed) {
  const map = new Map();
  const groups = [feed?.reviewReady, feed?.research, feed?.published, feed?.urgent];
  for (const item of groups.flatMap((group) => Array.isArray(group) ? group : [])) {
    const symbol = canonicalDecisionSymbol(item?.symbol);
    if (!symbol || item?.finalAction?.status !== 'BLOCKED') continue;
    const current = map.get(symbol);
    if (!current || item?.status === 'REVIEW_READY') map.set(symbol, item);
  }
  return map;
}

function capabilityLabel(capability) {
  if (capability?.onboardingStatus === 'IDENTITY_VERIFIED_ANALYSIS_ONBOARDING_REQUIRED') {
    return {
      QUEUED: 'ΣΤΗΝ ΟΥΡΑ ΕΡΕΥΝΑΣ',
      COMPLETED: 'ΕΡΕΥΝΑ ΟΛΟΚΛΗΡΩΘΗΚΕ',
      QUEUE_NOT_CONFIGURED: 'ΕΤΟΙΜΟ ΓΙΑ ΕΡΕΥΝΑ',
      QUEUE_FAILED: 'ΟΥΡΑ · ΠΡΟΣΩΡΙΝΟ ΣΦΑΛΜΑ',
      NOT_QUEUED: 'ΑΝΑΜΟΝΗ ΕΡΕΥΝΑΣ',
    }[capability?.queueStatus] || 'ΤΑΥΤΟΠΟΙΗΘΗΚΕ';
  }
  return {
    READY: 'MINBEIS READY',
    IDENTITY_NOT_VERIFIED: 'ΧΡΕΙΑΖΕΤΑΙ ΤΑΥΤΟΠΟΙΗΣΗ',
    GATEWAY_NOT_CONFIGURED: 'ONBOARDING ΜΗ ΔΙΑΘΕΣΙΜΟ',
    CHECK_FAILED: 'ΕΛΕΓΧΟΣ ΑΠΕΤΥΧΕ',
  }[capability?.onboardingStatus] || null;
}

function capabilityText(capability) {
  if (capability?.onboardingStatus === 'IDENTITY_VERIFIED_ANALYSIS_ONBOARDING_REQUIRED') {
    return {
      QUEUED: 'Το προϊόν ταυτοποιήθηκε και μπήκε στη μόνιμη MINBEIS research queue. Θα αποκτήσει πλήρη canonical ανάλυση όταν ολοκληρωθεί ο research κύκλος.',
      COMPLETED: 'Η research queue έχει ολοκληρώσει το onboarding. Αναμένεται η επόμενη έγκυρη mobile feed για να εμφανιστεί η canonical ανάλυση.',
      QUEUE_NOT_CONFIGURED: 'Το symbol και η χρηματιστηριακή ταυτότητα επαληθεύτηκαν. Η server-side μόνιμη research queue δεν έχει ακόμη ενεργοποιηθεί, οπότε δεν δηλώνεται ψευδώς ότι το προϊόν μπήκε σε ανάλυση.',
      QUEUE_FAILED: 'Το προϊόν ταυτοποιήθηκε, αλλά η αποστολή του στη research queue απέτυχε προσωρινά. Η θέση παραμένει αποθηκευμένη και δεν παράγεται τεχνητή απόφαση.',
      NOT_QUEUED: 'Το προϊόν ταυτοποιήθηκε, αλλά δεν έχει ακόμη καταχωρηθεί στη research queue.',
    }[capability?.queueStatus] || 'Το symbol και η χρηματιστηριακή ταυτότητα επαληθεύτηκαν. Η πλήρης MINBEIS research coverage δεν έχει ακόμη γίνει canonical.';
  }
  return {
    READY: 'Το προϊόν είναι canonical και υποστηρίζεται για πλήρη MINBEIS ανάλυση. Δεν υπάρχει ακόμη ενεργή τελική απόφαση στη σημερινή ροή.',
    IDENTITY_NOT_VERIFIED: 'Το προϊόν αποθηκεύτηκε στο χαρτοφυλάκιο, αλλά το MINBEIS δεν θα δημιουργήσει απόφαση μέχρι να επαληθευτεί η canonical ταυτότητά του.',
    GATEWAY_NOT_CONFIGURED: 'Το προϊόν αποθηκεύτηκε, αλλά ο κεντρικός gateway δεν είναι διαθέσιμος σε αυτή την έκδοση για automatic onboarding.',
    CHECK_FAILED: 'Η καταχώρηση του προϊόντος αποθηκεύτηκε κανονικά, αλλά ο αυτόματος έλεγχος MINBEIS δεν ολοκληρώθηκε.',
  }[capability?.onboardingStatus] || null;
}

function buildPositionClarity({ row, blockedDossier, interimPlan, capability, assessment }) {
  if (row) {
    return {
      now: minbeisActionLabel(row.action),
      why: assessment?.explanation?.summary || minbeisReasonText(row),
      change: assessment?.explanation?.whatWouldChange || 'Νέα επαληθευμένα δεδομένα που αλλάζουν την canonical αξιολόγηση.',
    };
  }
  if (interimPlan) {
    return {
      now: interimPlan.holderActionLabel || 'ΠΑΡΑΚΟΛΟΥΘΗΣΗ',
      why: interimPlan.rationale || 'Υπάρχει προσωρινό risk-control πλάνο όσο η τελική απόφαση παραμένει μπλοκαρισμένη.',
      change: assessment?.explanation?.whatWouldChange || portfolioBlockedReason(blockedDossier),
    };
  }
  if (blockedDossier) {
    return {
      now: 'ΠΕΡΙΜΕΝΕ · ΟΧΙ ΤΕΛΙΚΗ ΠΡΑΞΗ',
      why: portfolioBlockedReason(blockedDossier),
      change: assessment?.explanation?.whatWouldChange || blockedDossier?.nextStep || 'Να λυθεί ο υποχρεωτικός blocker και να τρέξει νέα canonical αξιολόγηση.',
    };
  }
  if (capability?.queueStatus === 'QUEUED') {
    return {
      now: 'ΠΕΡΙΜΕΝΕ ΤΗΝ ΑΝΑΛΥΣΗ',
      why: capabilityText(capability),
      change: 'Να ολοκληρωθεί η πλήρης έρευνα και να δημοσιευτεί νέα επαληθευμένη ανάλυση MINBEIS.',
    };
  }
  if (capability?.onboardingStatus === 'READY') {
    return {
      now: 'ΠΕΡΙΜΕΝΕ ΝΕΑ ΑΞΙΟΛΟΓΗΣΗ',
      why: capabilityText(capability),
      change: 'Να παραχθεί ενεργή canonical απόφαση στην επόμενη έγκυρη ροή.',
    };
  }
  return {
    now: 'ΑΝΑΜΟΝΗ ΕΛΕΓΧΟΥ',
    why: capabilityText(capability) || 'Η θέση είναι καταχωρημένη, αλλά δεν υπάρχει ακόμη επαρκής επαληθευμένη ανάλυση για πράξη.',
    change: 'Να ολοκληρωθούν τα identity/data/research checks.',
  };
}

function PositionClarityCard({ clarity }) {
  if (!clarity) return null;
  return (
    <View style={styles.positionClarityCard}>
      <View style={styles.positionClarityNow}>
        <Text style={styles.positionClarityLabel}>ΤΩΡΑ</Text>
        <Text style={styles.positionClarityAction}>{clarity.now}</Text>
      </View>
      <View style={styles.positionClarityRow}>
        <Text style={styles.positionClarityLabel}>ΓΙΑΤΙ</Text>
        <Text style={styles.positionClarityText}>{clarity.why}</Text>
      </View>
      <View style={styles.positionClarityRow}>
        <Text style={styles.positionClarityLabel}>ΤΙ ΘΑ ΑΛΛΑΞΕΙ ΤΗΝ ΕΙΚΟΝΑ</Text>
        <Text style={styles.positionClarityText}>{clarity.change}</Text>
      </View>
    </View>
  );
}

function portfolioMinbeisPriority(position, rowBySymbol, blockedBySymbol, instrumentCapabilities) {
  const symbol = canonicalDecisionSymbol(position?.symbol);
  const row = rowBySymbol.get(symbol) || null;
  const blocked = blockedBySymbol.get(symbol) || null;
  const assessment = row?.minbeisAssessment || blocked?.minbeisAssessment || null;
  const capability = instrumentCapabilities?.[String(position?.symbol || '').trim().toUpperCase()] || null;
  if (row?.action === 'REDUCE') return 100;
  if (assessment?.classification === 'TRAP') return 95;
  if (blocked?.finalAction?.controlledPlan?.status === 'AVAILABLE') return 85;
  if (blocked || assessment?.classification === 'CONFIRMATION_REQUIRED') return 80;
  if (row?.action === 'HOLD') return 65;
  if (capability?.queueStatus === 'QUEUED') return 45;
  if (capability?.onboardingStatus === 'CHECK_FAILED' || capability?.queueStatus === 'QUEUE_FAILED') return 40;
  return 20;
}

function PortfolioMinbeisSection({ dashboard, portfolioPositions = [], feed = null, instrumentCapabilities = {} }) {
  const rowBySymbol = new Map((dashboard?.rows || []).map((row) => [canonicalDecisionSymbol(row?.symbol), row]));
  const blockedBySymbol = blockedPortfolioDossierIndex(feed);
  const positions = (Array.isArray(portfolioPositions) ? portfolioPositions : [])
    .filter((position) => Number(position?.quantity || 0) > 0);
  if (!positions.length) return null;

  const coveredCount = positions.filter((position) => { const symbol = canonicalDecisionSymbol(position?.symbol); return rowBySymbol.has(symbol) || blockedBySymbol.has(symbol); }).length;
  const attentionCount = positions.filter((position) => portfolioMinbeisPriority(position, rowBySymbol, blockedBySymbol, instrumentCapabilities) >= 80).length;
  const queuedCount = positions.filter((position) => instrumentCapabilities?.[String(position?.symbol || '').trim().toUpperCase()]?.queueStatus === 'QUEUED').length;
  const orderedPositions = [...positions].sort((a, b) => {
    const priority = portfolioMinbeisPriority(b, rowBySymbol, blockedBySymbol, instrumentCapabilities)
      - portfolioMinbeisPriority(a, rowBySymbol, blockedBySymbol, instrumentCapabilities);
    return priority || String(a?.symbol || '').localeCompare(String(b?.symbol || ''));
  });

  return (
    <View style={styles.portfolioMinbeisSection}>
      <View style={styles.portfolioMinbeisHeader}>
        <View style={styles.grow}>
          <Text style={styles.sectionTitle}>Οι θέσεις μου</Text>
          <Text style={styles.sectionSubtitle}>Πρώτα εμφανίζονται όσα χρειάζονται προσοχή.</Text>
          <View style={styles.portfolioStatusRow}>
            <Text style={styles.portfolioStatusText}>Προσοχή: {attentionCount}</Text>
            <Text style={styles.portfolioStatusText}>Ανάλυση: {coveredCount}/{positions.length}</Text>
            <Text style={styles.portfolioStatusText}>Σε έρευνα: {queuedCount}</Text>
          </View>
        </View>
      </View>
      {orderedPositions.map((position) => {
        const symbol = canonicalDecisionSymbol(position?.symbol);
        const row = rowBySymbol.get(symbol) || null;
        const blockedDossier = blockedBySymbol.get(symbol) || null;
        const assessment = row?.minbeisAssessment || blockedDossier?.minbeisAssessment || null;
        const historicalContext = row?.historicalContext || blockedDossier?.historicalContext || null;
        const capability = instrumentCapabilities?.[String(position?.symbol || '').trim().toUpperCase()] || null;
        const interimPlan = blockedDossier?.finalAction?.controlledPlan?.status === 'AVAILABLE'
          ? blockedDossier.finalAction.controlledPlan
          : null;
        const badgeLabel = row
          ? minbeisActionLabel(row.action)
          : interimPlan
            ? 'ΠΡΟΣΩΡΙΝΟ ΠΛΑΝΟ'
            : blockedDossier
              ? 'ΜΠΛΟΚΑΡΙΣΜΕΝΗ ΑΠΟΦΑΣΗ'
              : capabilityLabel(capability) || 'ΑΝΑΛΥΣΗ ΕΚΚΡΕΜΕΙ';
        const clarity = buildPositionClarity({ row, blockedDossier, interimPlan, capability, assessment });
        return (
          <View key={position.symbol} style={styles.portfolioMinbeisCard}>
            <View style={styles.rowTop}>
              <View style={styles.grow}>
                <Text style={styles.company}>{position.company || position.symbol}</Text>
                <Text style={styles.symbol}>{position.symbol} · {Number(position.quantity || 0).toLocaleString('el-GR')} μετοχές</Text>
              </View>
              <View style={[styles.minbeisActionBadge, !row && styles.pendingActionBadge]}>
                <Text style={[styles.minbeisActionText, !row && styles.pendingActionText]}>{badgeLabel}</Text>
              </View>
            </View>
            <PositionClarityCard clarity={clarity} />
            <View style={styles.positionContextRow}>
              <MinbeisAssessmentStrip assessment={assessment} compact />
              {row ? <Text style={styles.ageText}>Confidence {Number.isFinite(Number(row.confidenceScore)) ? Number(row.confidenceScore).toFixed(0) : '—'} · Data {Number.isFinite(Number(row.dataQualityScore)) ? Number(row.dataQualityScore).toFixed(0) : '—'}</Text> : blockedDossier ? <Text style={styles.ageText}>Fail-closed μέχρι να λυθεί ο blocker</Text> : null}
            </View>
            <HistoricalContextCard context={historicalContext} />
            {!row && !blockedDossier && capability?.queueStatus === 'QUEUED' && capability?.queuedAt ? <Text style={styles.queueStatusText}>Στην ουρά από {when(capability.queuedAt)}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function buildNewIdeaClarity(row) {
  const assessment = row?.minbeisAssessment || null;
  const action = row?.action || 'WATCH';
  const confirmedBuy = ['BUY_PROBE', 'BUY_STARTER', 'BUY_CORE'].includes(action);
  return {
    now: confirmedBuy ? minbeisActionLabel(action) : action === 'NO_BUY' ? 'ΟΧΙ ΑΓΟΡΑ ΤΩΡΑ' : 'ΠΕΡΙΜΕΝΕ',
    why: assessment?.explanation?.summary || minbeisReasonText(row),
    change: assessment?.explanation?.whatWouldChange
      || (row?.purchase?.nextGate ? purchaseNextGateLabel(row.purchase.nextGate) : null)
      || 'Νέα επαληθευμένα δεδομένα που περνούν τα strict entry gates.',
  };
}

function MinbeisDashboard({ dashboard, sourceDecisionCount = 0, decisionContext }) {
  const rows = (Array.isArray(dashboard?.rows) ? dashboard.rows : []).filter((row) => !row.owned);
  const assessmentCounts = rows.reduce((acc, row) => {
    const key = row?.minbeisAssessment?.classification || 'UNKNOWN';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const setupCount = Number(assessmentCounts.SETUP || 0);
  const trapCount = Number(assessmentCounts.TRAP || 0);
  const noTradeCount = Number(assessmentCounts.NO_TRADE || 0);
  const confirmCount = Number(assessmentCounts.CONFIRMATION_REQUIRED || 0);
  const headline = setupCount > 0
    ? `${setupCount} επιβεβαιωμένο setup${setupCount === 1 ? '' : 's'} τώρα`
    : trapCount > 0
      ? `${trapCount} πιθανή παγίδα${trapCount === 1 ? '' : 'ες'} χρειάζεται προσοχή`
      : rows.length
        ? 'Δεν υπάρχει επιβεβαιωμένο setup για νέα είσοδο τώρα'
        : sourceDecisionCount > 0
          ? 'Υπάρχουν αναλύσεις, αλλά καμία νέα ιδέα δεν περνά τώρα τους ενεργούς κανόνες'
          : 'Δεν υπάρχουν ακόμη τελικές αναλύσεις αγοράς';

  return (
    <View style={styles.minbeisShell}>
      <View style={styles.minbeisHero}>
        <Text style={styles.minbeisEyebrow}>MINBEIS · ΣΗΜΕΡΙΝΗ ΣΑΡΩΣΗ ΑΓΟΡΑΣ</Text>
        <Text style={styles.minbeisHeroTitle}>{headline}</Text>
        <Text style={styles.minbeisHeroText}>Αυτή η ενότητα αφορά νέες ιδέες εκτός του χαρτοφυλακίου σου. Οι δικές σου θέσεις εμφανίζονται ξεχωριστά παραπάνω. Δεν εκτελούνται συναλλαγές.</Text>
        <View style={styles.minbeisCountRow}>
          <View style={styles.minbeisCountBox}><Text style={styles.minbeisCountValue}>{setupCount}</Text><Text style={styles.minbeisCountLabel}>ΥΠΟΨΗΦΙΑ</Text></View>
          <View style={styles.minbeisCountBox}><Text style={styles.minbeisCountValue}>{trapCount}</Text><Text style={styles.minbeisCountLabel}>ΠΑΓΙΔΑ</Text></View>
          <View style={styles.minbeisCountBox}><Text style={styles.minbeisCountValue}>{noTradeCount}</Text><Text style={styles.minbeisCountLabel}>ΑΠΟΧΗ</Text></View>
          <View style={styles.minbeisCountBox}><Text style={styles.minbeisCountValue}>{confirmCount}</Text><Text style={styles.minbeisCountLabel}>ΕΛΕΓΧΟΣ</Text></View>
        </View>
        {!decisionContext?.feedFresh ? <Text style={styles.minbeisCaution}>Οι ενεργές πράξεις απενεργοποιούνται όταν η ροή δεν είναι αρκετά πρόσφατη.</Text> : null}
      </View>

      {rows.length ? <><Text style={styles.sectionTitle}>Νέες ιδέες</Text><Text style={styles.sectionSubtitle}>Μετοχές εκτός του χαρτοφυλακίου σου που πέρασαν στη σημερινή επαληθευμένη ανάλυση.</Text></> : null}
      {rows.slice(0, 10).map((row) => (
        <View key={row.id} style={styles.minbeisDecisionCard}>
          <View style={styles.rowTop}>
            <View style={styles.grow}>
              <Text style={styles.company}>{row.companyName}</Text>
              <Text style={styles.symbol}>{row.symbol || '—'} · {row.owned ? 'ΘΕΣΗ ΣΟΥ' : 'ΝΕΑ ΙΔΕΑ'}</Text>
            </View>
            <View style={styles.minbeisActionBadge}>
              <Text style={styles.minbeisActionText}>{minbeisActionLabel(row.action)}</Text>
            </View>
          </View>
          <PositionClarityCard clarity={buildNewIdeaClarity(row)} />
          <View style={styles.positionContextRow}>
            <MinbeisAssessmentStrip assessment={row.minbeisAssessment} compact />
            <Text style={styles.ageText}>Confidence {Number.isFinite(Number(row.confidenceScore)) ? Number(row.confidenceScore).toFixed(0) : '—'} · Data {Number.isFinite(Number(row.dataQualityScore)) ? Number(row.dataQualityScore).toFixed(0) : '—'}</Text>
          </View>
          <HistoricalContextCard context={row.historicalContext} />
        </View>
      ))}
    </View>
  );
}

function MinbeisProductFeedback({ feedback, summary, onFeedback }) {
  const measurable = summary?.minimumEvidenceMet === true;
  return (
    <View style={styles.productFeedbackCard}>
      <Text style={styles.productFeedbackTitle}>Σου ξεκαθάρισε τι χρειάζεται προσοχή;</Text>
      <Text style={styles.productFeedbackText}>Μετράμε αν το MINBEIS πραγματικά μειώνει τη σύγχυση — όχι μόνο αν παράγει περισσότερα σήματα.</Text>
      {feedback === null ? (
        <View style={styles.productFeedbackActions}>
          <Pressable style={styles.productFeedbackYes} onPress={() => onFeedback(true)}>
            <Text style={styles.productFeedbackYesText}>Ναι, ξεκαθάρισε</Text>
          </Pressable>
          <Pressable style={styles.productFeedbackNo} onPress={() => onFeedback(false)}>
            <Text style={styles.productFeedbackNoText}>Όχι ακόμη</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.productFeedbackThanks}>{feedback ? 'Καταγράφηκε ως χρήσιμη συνεδρία.' : 'Καταγράφηκε ότι χρειάζεται καλύτερη εξήγηση.'}</Text>
      )}
      <Text style={styles.productFeedbackPrivacy}>Μόνο στη συσκευή · χωρίς ticker, ποσότητες, κόστος, P/L ή επενδυτικές αποφάσεις.</Text>
      {measurable ? (
        <Text style={styles.productFeedbackMetric}>30 ημέρες · χρήσιμες ημέρες {summary.usefulDays}/{summary.activeDays} · median time-to-clarity {summary.medianTimeToClaritySec ?? '—'}″</Text>
      ) : summary?.sessions > 0 ? (
        <Text style={styles.productFeedbackMetric}>Ιδιωτικό alpha δείγμα: {summary.sessions} συνεδρία{summary.sessions === 1 ? '' : 'ες'} · δεν υπάρχει ακόμη αρκετό δείγμα για συμπέρασμα.</Text>
      ) : null}
    </View>
  );
}

function purchaseReasonLabel(reason) {
  return {
    FULL_DEEP_DOSSIER_REQUIRED: 'Απαιτείται πλήρης βαθιά ανάλυση πριν εξεταστεί αγορά.',
    BUY_SETUP_NOT_CONFIRMED: 'Δεν έχουν επιβεβαιωθεί ακόμη όλα τα κριτήρια εισόδου.',
    FINAL_ACTION_BLOCKED: 'Η τελική απόφαση παραμένει μπλοκαρισμένη από υποχρεωτικούς ελέγχους.',
    SEVERE_RISK_CONFIGURATION: 'Ο συνδυασμός κινδύνων είναι υπερβολικός για αγορά.',
    REFERENCE_PRICE_REQUIRED: 'Λείπει έγκυρη τιμή αναφοράς.',
    REFERENCE_PRICE_STALE_FOR_PUBLICATION: 'Η τιμή αναφοράς δεν είναι αρκετά φρέσκια.',
    FUNDAMENTALS_REQUIRED: 'Λείπουν επαρκή θεμελιώδη στοιχεία.',
    HISTORICAL_MARKET_METRICS_REQUIRED: 'Λείπει επαρκές ιστορικό αγοράς και ρευστότητας.',
    INDEPENDENT_CROSS_CHECK_REQUIRED: 'Λείπει ανεξάρτητη διασταύρωση.',
  }[reason] || String(reason || '').replace(/_/g, ' ').toLowerCase();
}

function purchaseNextGateLabel(gate) {
  return {
    USER_EXECUTION_ONLY: 'Η απόφαση είναι επιβεβαιωμένη. Τυχόν εκτέλεση γίνεται μόνο από εσένα.',
    RECHECK_STRICT_BUY_GATES: 'Επανέλεγχος των αυστηρών BUY gates όταν αλλάξουν τα δεδομένα.',
    NEW_EVIDENCE_OR_MATERIAL_CHANGE: 'Νέα ουσιαστικά στοιχεία ή σημαντική αλλαγή πριν επανεξεταστεί.',
    COMPLETE_BLOCKING_CHECKS: 'Ολοκλήρωση όλων των ελέγχων που λείπουν.',
    FULL_DEEP_DOSSIER: 'Ολοκλήρωση πλήρους επενδυτικού φακέλου.',
  }[gate] || 'Παρακολούθηση μέχρι τον επόμενο αυστηρό έλεγχο.';
}

function OpportunityPurchaseCard({ item, portfolioPositions = [], portfolioPolicy = {} }) {
  const personalizedMinbeisDecision = item.minbeisDecision ? applyMinbeisPortfolioSizing(item.minbeisDecision, portfolioPositions, { symbol: item.symbol, concentrationPolicyMode: portfolioPolicy.concentrationPolicyMode, maxSinglePositionPct: portfolioPolicy.maxSinglePositionPct }) : null;
  const confirmed = item.status === 'BUY_CONFIRMED' && item.buyNowEligible === true;
  const waiting = item.status === 'WAIT_FOR_ENTRY_CONFIRMATION';
  const rejected = item.status === 'REJECTED';
  const score = Number(item.opportunityScore);
  return (
    <View style={[styles.card, rejected && styles.riskCard]}>
      <View style={styles.rowTop}>
        <View style={styles.grow}>
          <Text style={styles.company}>{item.companyName || item.symbol || item.instrumentId || 'Επενδυτική ευκαιρία'}</Text>
          <Text style={styles.symbol}>{item.symbol || item.assetClass || '—'} · {item.tier || '—'}</Text>
        </View>
        <View style={[styles.badge, confirmed && styles.badgePublished, waiting && styles.badgeReview]}>
          <Text style={[styles.badgeText, confirmed && styles.badgePublishedText, waiting && styles.badgeReviewText]}>{item.statusLabel || item.status}</Text>
        </View>
      </View>
      <View style={styles.actionRow}>
        <View style={styles.actionBox}>
          <Text style={styles.muted}>Opportunity score</Text>
          <Text style={styles.action}>{Number.isFinite(score) ? score.toFixed(1) : '—'}</Text>
        </View>
        <View style={styles.actionBox}>
          <Text style={styles.muted}>Strict BUY</Text>
          <Text style={[styles.action, rejected && styles.riskText]}>{confirmed ? 'ΕΠΙΒΕΒΑΙΩΘΗΚΕ' : 'ΟΧΙ'}</Text>
        </View>
      </View>
      {confirmed ? (
        <View style={styles.nextBox}>
          <Text style={styles.nextLabel}>ΑΓΟΡΑ ΕΠΙΒΕΒΑΙΩΘΗΚΕ</Text>
          <Text style={styles.nextText}>Πέρασε την ίδια αυστηρή τελική πολιτική BUY_NOW. Καμία εντολή broker δεν εκτελείται αυτόματα.</Text>
        </View>
      ) : item.whyNotBuyNow?.length ? (
        <View style={styles.blockers}>
          <Text style={styles.blockerTitle}>Γιατί δεν είναι αγορά τώρα</Text>
          {item.whyNotBuyNow.slice(0, 5).map((reason, index) => <Text key={`purchase-reason-${index}`} style={styles.blockerText}>• {purchaseReasonLabel(reason)}</Text>)}
        </View>
      ) : null}
      {personalizedMinbeisDecision ? (
        <View style={styles.nextBox}>
          <Text style={styles.nextLabel}>MINBEIS · ΠΡΟΣΑΡΜΟΣΜΕΝΟ ΣΤΟ ΧΑΡΤΟΦΥΛΑΚΙΟ</Text>
          <Text style={styles.nextText}>{minbeisActionLabel(personalizedMinbeisDecision.action)} · {minbeisAllocationText(personalizedMinbeisDecision)}</Text>
          {personalizedMinbeisDecision.portfolioSizingStatus === 'BLOCKED_BY_USER_POLICY' ? <Text style={styles.warning}>Η νέα θέση μπλοκάρεται μόνο επειδή παραβιάζει το όριο συγκέντρωσης που όρισες εσύ.</Text> : null}
          {personalizedMinbeisDecision.portfolioSizingStatus === 'PERSONALIZATION_UNAVAILABLE' ? <Text style={styles.warning}>Η βασική πρόταση παραμένει διαθέσιμη, αλλά δεν μπορεί να γίνει προσωπική προσαρμογή συγκέντρωσης μέχρι να είναι πλήρης η αποτίμηση του χαρτοφυλακίου.</Text> : null}
          {personalizedMinbeisDecision.portfolioSizingNote ? <Text style={styles.ageText}>{personalizedMinbeisDecision.portfolioSizingNote}</Text> : null}
          <Text style={styles.ageText}>Απαιτείται ανθρώπινη έγκριση · καμία αυτόματη εντολή broker</Text>
        </View>
      ) : null}
      <View style={styles.nextBox}>
        <Text style={styles.nextLabel}>Επόμενη πύλη</Text>
        <Text style={styles.nextText}>{purchaseNextGateLabel(item.nextGate)}</Text>
      </View>
    </View>
  );
}

function PurchaseSection({ title, subtitle, items, portfolioPositions = [], portfolioPolicy = {} }) {
  if (!items.length) return null;
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      {items.map((item, index) => <OpportunityPurchaseCard key={item.instrumentId || item.companyId || `purchase-${index}`} item={item} portfolioPositions={portfolioPositions} portfolioPolicy={portfolioPolicy} />)}
    </View>
  );
}

function Section({ title, subtitle, items, decisionContext }) {
  if (!items.length) return null;
  return <View style={styles.sectionBlock}><Text style={styles.sectionTitle}>{title}</Text>{subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}{items.map((item) => <IntelligenceCard key={item.id} item={item} decisionContext={decisionContext} />)}</View>;
}

export default function OpportunitiesView({ portfolioPositions = [], portfolioPolicy = {}, instrumentCapabilities = {} }) {
  const [feed, setFeed] = useState(null);
  const [syncState, setSyncState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [showSystemDetails, setShowSystemDetails] = useState(false);
  const [productSessionStartedAt, setProductSessionStartedAt] = useState(null);
  const [productMetrics, setProductMetrics] = useState(null);
  const [clarityFeedback, setClarityFeedback] = useState(null);

  useEffect(() => {
    let active = true;
    startLocalMinbeisProductSession()
      .then((result) => {
        if (!active) return;
        setProductSessionStartedAt(result.sessionStartedAt);
        setProductMetrics(result.summary);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const submitClarityFeedback = useCallback(async (useful) => {
    if (!productSessionStartedAt || clarityFeedback !== null) return;
    setClarityFeedback(useful);
    try {
      const summary = await recordLocalMinbeisClarityFeedback(productSessionStartedAt, useful);
      setProductMetrics(summary);
    } catch {
      // Product-evaluation telemetry is optional and must never block MINBEIS.
    }
  }, [productSessionStartedAt, clarityFeedback]);

  const sync = useCallback(async ({ manual = false } = {}) => {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await syncIntelligenceFeedAsync();
      setFeed(result.feed);
      setSyncState(result.syncState);
      if (manual) Alert.alert('Market Intelligence', result.changed ? 'Η συσκευή ενημερώθηκε με τη νεότερη έγκυρη ροή.' : 'Η συσκευή έχει ήδη την τελευταία διαθέσιμη έγκυρη ροή.');
    } catch (error) {
      setSyncState(error.syncState || await loadIntelligenceSyncState());
      setSyncError(error.message);
      if (manual) Alert.alert('Δεν ολοκληρώθηκε η ενημέρωση', `${error.message}\n\nΗ τελευταία έγκυρη αποθηκευμένη ροή παραμένει διαθέσιμη.`);
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [cached, previousSync] = await Promise.all([
        loadCachedIntelligenceFeed(),
        loadIntelligenceSyncState(),
      ]);
      if (!mounted) return;
      setFeed(cached);
      setSyncState(previousSync);
      setLoading(false);
      await sync();
    })().catch((error) => {
      if (mounted) {
        setLoading(false);
        setSyncError(error.message);
      }
    });
    return () => { mounted = false; };
  }, [sync]);

  useEffect(() => {
    const interval = setInterval(() => { sync().catch(() => {}); }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [sync]);

  const counts = useMemo(() => feed?.summary || {
    publishedCount: 0,
    reviewReadyCount: 0,
    researchCount: 0,
    urgentCount: 0,
    finalActionCount: 0,
    buyNowCount: 0,
    sellNowCount: 0,
    discoveryCandidateCount: 0,
    discoveryDeepAnalysisCount: 0,
  }, [feed]);
  const freshness = useMemo(() => intelligenceFeedFreshness(feed), [feed]);
  const operationalHealth = feed?.operationalHealth || null;
  const sourceHealth = feed?.sourceHealth || null;
  const historicalAnalyticsStatus = operationalHealth?.historicalAnalyticsStatus || 'UNAVAILABLE';
  const historicalAnalyticsPartial = ['PARTIAL', 'UNAVAILABLE'].includes(historicalAnalyticsStatus);
  const systemReady = intelligenceSystemReady(operationalHealth || {});
  const decisionContext = useMemo(() => ({
    feedFresh: freshness.state === 'fresh',
    systemReady,
  }), [freshness.state, systemReady]);
  const productionReady = decisionContext.feedFresh && decisionContext.systemReady;
  const personalizedCounts = useMemo(
    () => personalizedDecisionCounts(feed, portfolioPositions, decisionContext),
    [feed, portfolioPositions, decisionContext],
  );
  const minbeisDashboard = useMemo(
    () => buildPersonalizedMinbeisDashboard(feed, portfolioPositions, {
      isCurrentDecision: (finalAction) => finalActionIsCurrent(finalAction, decisionContext),
    }),
    [feed, portfolioPositions, decisionContext],
  );

  const importFeed = async () => {
    setImporting(true);
    try {
      const imported = await importIntelligenceFeedAsync();
      if (imported) {
        setFeed(imported);
        setSyncState(await loadIntelligenceSyncState());
        setSyncError(null);
        Alert.alert('Market Intelligence', 'Η χειροκίνητη ροή ελέγχθηκε και αποθηκεύτηκε μόνο στη συσκευή.');
      }
    } catch (error) {
      Alert.alert('Μη έγκυρη ροή', error.message);
    } finally {
      setImporting(false);
    }
  };

  const clear = () => Alert.alert(
    'Διαγραφή ροής έρευνας',
    'Θα διαγραφούν μόνο οι αναλύσεις και τα στοιχεία συγχρονισμού. Οι συναλλαγές και το χαρτοφυλάκιο δεν επηρεάζονται.',
    [
      { text: 'Άκυρο', style: 'cancel' },
      {
        text: 'Διαγραφή',
        style: 'destructive',
        onPress: async () => {
          await clearIntelligenceFeed();
          setFeed(null);
          setSyncState(null);
          setSyncError(null);
        },
      },
    ],
  );

  if (loading) return <View style={styles.loading}><ActivityIndicator color="#0B66FF" /><Text style={styles.muted}>Φόρτωση Market Intelligence…</Text></View>;

  return (
    <View>
      <View style={styles.headerRow}>
        <View style={styles.grow}>
          <Text style={styles.title}>MINBEIS</Text>
          <Text style={styles.subtitle}>Προσωπική επενδυτική νοημοσύνη · αποφάσεις, ρίσκο και επόμενη πράξη</Text>
        </View>
        <Pressable style={[styles.syncSmall, syncing && styles.disabled]} onPress={() => sync({ manual: true })} disabled={syncing}>
          {syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.syncSmallText}>Ανανέωση</Text>}
        </Pressable>
      </View>

      <View style={[styles.connectionCard, freshness.state === 'stale' && styles.connectionBad]}>
        <View style={styles.connectionTop}>
          <View style={styles.grow}>
            <Text style={styles.connectionTitle}>Αυτόματη ασφαλής ενημέρωση</Text>
            <Text style={styles.connectionText}>{feed ? `${freshness.label} · ηλικία ${freshness.ageHours.toFixed(1)} ωρών · δημιουργία ${when(feed.generatedAt)}` : 'Δεν έχει ληφθεί ακόμη έγκυρη ροή.'}</Text>
          </View>
          <View style={[styles.healthBadge, freshness.state === 'fresh' && styles.healthGood, freshness.state === 'stale' && styles.healthBad]}>
            <Text style={[styles.healthText, freshness.state === 'fresh' && styles.healthGoodText, freshness.state === 'stale' && styles.healthBadText]}>{freshness.state === 'fresh' ? 'ΠΡΟΣΦΑΤΗ' : freshness.state === 'stale' ? 'ΠΑΛΙΑ' : 'ΕΛΕΓΧΟΣ'}</Text>
          </View>
        </View>
        <Text style={styles.connectionMeta}>Τελευταίος επιτυχής συγχρονισμός: {when(syncState?.lastSuccessAt)}</Text>
        <Pressable style={styles.systemDetailsToggle} onPress={() => setShowSystemDetails((value) => !value)}>
          <Text style={styles.systemDetailsToggleText}>{showSystemDetails ? 'Απόκρυψη κατάστασης συστήματος' : 'Κατάσταση συστήματος'}</Text>
        </Pressable>
        {showSystemDetails ? <>
        <View style={styles.sourcePolicyBox}><Text style={styles.sourcePolicyTitle}>Ποιος επιλέγει τις πηγές;</Text><Text style={styles.sourcePolicyText}>Έκδοση πολιτικής: {feed?.sourceSelection?.version || '—'}. Οι πηγές επιλέγονται από κλειδωμένη πολιτική κώδικα και επιτρεπόμενη λίστα, όχι αυθαίρετα από το AI.</Text></View>
        <View style={[styles.productionHealth, productionReady ? styles.productionHealthGood : styles.productionHealthLimited]}>
          <View style={styles.productionHealthTop}><View style={styles.grow}><Text style={styles.productionHealthEyebrow}>ΚΑΤΑΣΤΑΣΗ ΠΑΡΑΓΩΓΙΚΟΥ ΣΥΣΤΗΜΑΤΟΣ</Text><Text style={styles.productionHealthTitle}>{productionReady ? (historicalAnalyticsPartial ? 'Κανονική λειτουργία · μερική ιστορική κάλυψη' : 'Πλήρης αυτοματοποιημένη λειτουργία') : 'Περιορισμένη λειτουργία — χωρίς αυθαίρετα σήματα'}</Text></View><View style={[styles.productionHealthBadge, productionReady && styles.productionHealthBadgeGood]}><Text style={[styles.productionHealthBadgeText, productionReady && styles.productionHealthBadgeTextGood]}>{productionReady ? 'ΕΝΕΡΓΟ' : 'ΠΕΡΙΟΡΙΣΜΕΝΟ'}</Text></View></View>
          <Text style={styles.productionHealthText}>{productionReady ? (historicalAnalyticsPartial ? 'Η ροή είναι πρόσφατη και οι τρέχοντες έλεγχοι αγοράς και θεμελιωδών λειτουργούν. Η ιστορική ανάλυση είναι διαθέσιμη μόνο όπου έχει επαρκή και επαληθευμένα δεδομένα· οι υπόλοιποι φάκελοι παραμένουν μπλοκαρισμένοι.' : 'Η ροή είναι πρόσφατη και οι υποχρεωτικοί έλεγχοι αγοράς, ιστορικού και θεμελιωδών λειτουργούν.') : 'Το σύστημα συνεχίζει να συλλέγει και να ελέγχει δεδομένα, αλλά δεν εγκρίνει αγορά ή πώληση όταν λείπει πηγή, ιστορικό, benchmark, θεμελιώδη ή διασταύρωση.'}</Text>
          <Text style={styles.healthSplitText}>Υποδομή: {operationalHealth?.infrastructureStatus || '—'} · Τρέχουσα αγορά: {operationalHealth?.marketDataStatus || '—'} · Ιστορική ανάλυση: {historicalAnalyticsStatus} · Θεμελιώδη: {operationalHealth?.fundamentalsStatus || '—'} · Αποφάσεις: {operationalHealth?.decisionEngineStatus || '—'}</Text>
          <View style={styles.productionMetrics}>
            <View style={styles.productionMetric}><Text style={styles.productionMetricValue}>{sourceHealth?.marketSnapshotCount || 0}</Text><Text style={styles.productionMetricLabel}>Τρέχουσες τιμές</Text></View>
            <View style={styles.productionMetric}><Text style={styles.productionMetricValue}>{sourceHealth?.readyHistoricalMarketMetricsCount || 0}/{operationalHealth?.analysedCompanyCount || sourceHealth?.historicalMarketMetricsCount || 0}</Text><Text style={styles.productionMetricLabel}>Ιστορική κάλυψη</Text></View>
            <View style={styles.productionMetric}><Text style={styles.productionMetricValue}>{sourceHealth?.fundamentalSnapshotCount || 0}</Text><Text style={styles.productionMetricLabel}>Θεμελιώδη</Text></View>
          </View>
          <Text style={styles.productionHealthMeta}>Τελευταία παραγωγή: {when(operationalHealth?.generatedAt || feed?.generatedAt)} · Διαγνωστικά: {sourceHealth?.diagnosticCount || 0}</Text>
        </View>
        </> : null}
        {syncError ? <Text style={styles.syncWarning}>Η online ενημέρωση απέτυχε: {syncError} Προβάλλεται η τελευταία έγκυρη αποθηκευμένη ροή.</Text> : null}
      </View>

      {!feed ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Η εφαρμογή συνδέεται πλέον αυτόματα με τη μηχανή έρευνας.</Text>
          <Text style={styles.emptyText}>Πάτησε «Σύνδεση και ενημέρωση». Η εφαρμογή αποδέχεται μόνο το εγκεκριμένο HTTPS κανάλι, ελέγχει τη δομή της ροής και δεν αντικαθιστά ποτέ νεότερα τοπικά δεδομένα με παλαιότερα.</Text>
          <Pressable style={[styles.primary, syncing && styles.disabled]} onPress={() => sync({ manual: true })} disabled={syncing}>
            {syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Σύνδεση και ενημέρωση</Text>}
          </Pressable>
          <Pressable style={styles.secondary} onPress={importFeed} disabled={importing}>
            {importing ? <ActivityIndicator color="#16345f" /> : <Text style={styles.secondaryText}>Εφεδρική εισαγωγή αρχείου JSON</Text>}
          </Pressable>
          <Text style={styles.privacy}>Η ροή αποθηκεύεται σε ξεχωριστό τοπικό κλειδί. Δεν αλλάζει συναλλαγές, τιμές αγοράς, Decision Gate ή λογιστικά δεδομένα.</Text>
        </View>
      ) : (
        <>
          <PortfolioMinbeisSection dashboard={minbeisDashboard} portfolioPositions={portfolioPositions} feed={feed} instrumentCapabilities={instrumentCapabilities} />
          <MinbeisDashboard dashboard={minbeisDashboard} sourceDecisionCount={(feed.decisions || []).length} decisionContext={decisionContext} />
          <MinbeisProductFeedback feedback={clarityFeedback} summary={productMetrics} onFeedback={submitClarityFeedback} />
          <View style={styles.summaryCard}>
            <Text style={styles.summaryHeadline}>{feed.today?.headline || 'Ημερήσια σύνοψη'}</Text>
            <Text style={styles.updated}>Έγκυρη ροή: {when(feed.generatedAt)}</Text>
            <View style={styles.countRow}>
              <View style={styles.countBox}><Text style={styles.countValue}>{personalizedCounts.buyNowCount || 0}</Text><Text style={styles.countLabel}>Canonical BUY</Text></View>
              <View style={styles.countBox}><Text style={styles.countValue}>{personalizedCounts.sellNowCount || 0}</Text><Text style={styles.countLabel}>Canonical SELL</Text></View>
              <View style={styles.countBox}><Text style={styles.countValue}>{counts.finalActionCount || 0}</Text><Text style={styles.countLabel}>Τελικές αναλύσεις</Text></View>
            </View>
          </View>

          {feed.discoveryRadar?.length ? <View style={styles.sectionBlock}><Text style={styles.sectionTitle}>Ραντάρ νέων μετοχών</Text><Text style={styles.sectionSubtitle}>Το σύστημα σαρώνει αυτόματα επίσημα γεγονότα της αγοράς, κατατάσσει νέες εταιρείες και περνά τις ισχυρότερες σε πλήρη ανάλυση.</Text>{feed.discoveryRadar.map((item) => <DiscoveryRadarCard key={item.discoveryId} item={item} />)}</View> : null}
          <PurchaseSection title="ΑΓΟΡΑ ΕΠΙΒΕΒΑΙΩΘΗΚΕ" subtitle="Μόνο ευκαιρίες που πέρασαν και τη δεύτερη αυστηρή πολιτική BUY_NOW. Καμία αυτόματη συναλλαγή." items={decisionContext.feedFresh && decisionContext.systemReady ? (feed.confirmedBuyOpportunities || []) : []} portfolioPositions={portfolioPositions} portfolioPolicy={portfolioPolicy} />
          <PurchaseSection title="Ισχυρές ευκαιρίες — αναμονή εισόδου" subtitle="Υψηλή κατάταξη Opportunity Hunter, αλλά δεν έχουν επιβεβαιωθεί ακόμη όλα τα strict BUY gates." items={feed.waitingEntryOpportunities || []} portfolioPositions={portfolioPositions} portfolioPolicy={portfolioPolicy} />
          <PurchaseSection title="Απορρίφθηκαν για αγορά" subtitle="Ο Opportunity Hunter τις εντόπισε, αλλά ο αυστηρός τελικός έλεγχος απέρριψε αγορά με τα τωρινά δεδομένα." items={feed.rejectedOpportunities || []} portfolioPositions={portfolioPositions} portfolioPolicy={portfolioPolicy} />
          <PurchaseSection title="Μπλοκαρισμένες ευκαιρίες" subtitle="Χρειάζονται πλήρη ανάλυση ή υποχρεωτικούς ελέγχους πριν μπορούν να αξιολογηθούν για αγορά." items={feed.blockedOpportunities || []} portfolioPositions={portfolioPositions} portfolioPolicy={portfolioPolicy} />

          <Section title="Αυξημένη προτεραιότητα" subtitle="Κίνδυνοι ή εξελίξεις που χρειάζονται πρώτα προσοχή" items={feed.urgent || []} decisionContext={decisionContext} />
          <Section title="Δημοσιευμένες ευκαιρίες" subtitle="Φάκελοι που πέρασαν όλους τους ελέγχους και τη διαδικασία δημοσίευσης" items={feed.published || []} decisionContext={decisionContext} />
          <Section title="Έτοιμα για τελικό έλεγχο" subtitle="Πλήρεις φάκελοι που δεν έχουν ακόμη δημοσιευτεί" items={feed.reviewReady || []} decisionContext={decisionContext} />
          <Section title="Έρευνα σε εξέλιξη" subtitle="Το σύστημα δείχνει καθαρά τι λείπει και δεν επιτρέπει πρόωρη κατεύθυνση αγοράς ή πώλησης" items={feed.research || []} decisionContext={decisionContext} />
          {!feed.published?.length && !feed.reviewReady?.length && !feed.research?.length && !feed.opportunityPurchaseDecisions?.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>Η σύνδεση λειτουργεί, αλλά η τρέχουσα ροή δεν περιέχει ακόμη εταιρικούς φακέλους.</Text><Text style={styles.emptyText}>Αυτό είναι ασφαλέστερο από το να εμφανιστεί μη τεκμηριωμένη πρόταση. Η επόμενη επιτυχής ημερήσια εκτέλεση θα ενημερώσει αυτόματα την οθόνη.</Text></View> : null}
          <Text style={styles.disclosure}>{feed.disclosure}</Text>
          <Pressable style={styles.secondary} onPress={importFeed} disabled={importing}><Text style={styles.secondaryText}>Εφεδρική εισαγωγή αρχείου</Text></Pressable>
          <Pressable style={styles.clearButton} onPress={clear}><Text style={styles.clearText}>Διαγραφή μόνο της ροής έρευνας</Text></Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  grow: { flex: 1, minWidth: 0 },
  title: { color: '#16345f', fontSize: 28, lineHeight: 34, fontWeight: '900' },
  subtitle: { color: '#718096', fontSize: 13, lineHeight: 19, marginTop: 3 },
  syncSmall: { minHeight: 44, minWidth: 92, borderRadius: 15, paddingHorizontal: 12, backgroundColor: '#0B66FF', alignItems: 'center', justifyContent: 'center' },
  syncSmallText: { color: '#fff', fontWeight: '900' },
  disabled: { opacity: 0.62 },
  connectionCard: { backgroundColor: '#eef7ff', borderWidth: 1, borderColor: '#bdd9ff', borderRadius: 20, padding: 15, marginBottom: 16 },
  connectionBad: { backgroundColor: '#fff8e7', borderColor: '#efd8a3' },
  connectionTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  connectionTitle: { color: '#16345f', fontSize: 16, fontWeight: '900' },
  connectionText: { color: '#52647d', fontSize: 12, lineHeight: 18, marginTop: 3 },
  connectionMeta: { color: '#718096', fontSize: 11, marginTop: 9 }, sourcePolicyBox: { backgroundColor: '#fff', borderRadius: 13, padding: 10, marginTop: 10 }, sourcePolicyTitle: { color: '#16345f', fontSize: 12, fontWeight: '900' }, sourcePolicyText: { color: '#62738a', fontSize: 11, lineHeight: 16, marginTop: 3 }, productionHealth: { borderRadius: 16, borderWidth: 1, padding: 12, marginTop: 11 }, productionHealthGood: { backgroundColor: '#eaf8f0', borderColor: '#9bd7b2' }, productionHealthLimited: { backgroundColor: '#fff7e5', borderColor: '#e8cf91' }, productionHealthTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, productionHealthEyebrow: { color: '#6d7b8f', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 }, productionHealthTitle: { color: '#16345f', fontSize: 14, lineHeight: 18, fontWeight: '900', marginTop: 3 }, productionHealthBadge: { borderRadius: 11, backgroundColor: '#fff0d2', paddingHorizontal: 8, paddingVertical: 5 }, productionHealthBadgeGood: { backgroundColor: '#d6f2e1' }, productionHealthBadgeText: { color: '#996600', fontSize: 8, fontWeight: '900' }, productionHealthBadgeTextGood: { color: '#147a4a' }, productionHealthText: { color: '#617187', fontSize: 11, lineHeight: 17, marginTop: 8 }, healthSplitText: { color: '#40536f', fontSize: 9, lineHeight: 14, fontWeight: '800', marginTop: 6 }, productionMetrics: { flexDirection: 'row', gap: 7, marginTop: 10 }, productionMetric: { flex: 1, backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: 11, padding: 8 }, productionMetricValue: { color: '#16345f', fontSize: 15, fontWeight: '900' }, productionMetricLabel: { color: '#718096', fontSize: 8, lineHeight: 11, marginTop: 2 }, productionHealthMeta: { color: '#7b889d', fontSize: 9, lineHeight: 13, marginTop: 8 },
  syncWarning: { color: '#8a5d00', fontSize: 12, lineHeight: 18, marginTop: 9, fontWeight: '700' },
  healthBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: '#edf2f8' },
  healthGood: { backgroundColor: '#e4f7ed' },
  healthBad: { backgroundColor: '#fff0f2' },
  healthText: { color: '#65758a', fontSize: 10, fontWeight: '900' },
  healthGoodText: { color: '#087846' },
  healthBadText: { color: '#b42336' },
  empty: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d5dfec', borderRadius: 23, padding: 20, marginBottom: 16 },
  emptyTitle: { color: '#16345f', fontSize: 20, lineHeight: 26, fontWeight: '900' },
  emptyText: { color: '#5f6f84', fontSize: 15, lineHeight: 22, marginTop: 10 },
  primary: { minHeight: 56, borderRadius: 18, backgroundColor: '#0B66FF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 18 },
  primaryText: { color: '#fff', fontWeight: '900', textAlign: 'center' },
  privacy: { color: '#718096', fontSize: 12, lineHeight: 18, marginTop: 13 },
  portfolioMinbeisSection: { marginBottom: 20 },
  portfolioMinbeisHeader: { marginBottom: 8 },
  portfolioStatusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  portfolioStatusText: { color: '#60728b', fontSize: 9, fontWeight: '800', backgroundColor: '#edf3fb', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  positionClarityCard: { backgroundColor: '#f8fbff', borderRadius: 15, borderWidth: 1, borderColor: '#d5e1f1', padding: 12, marginTop: 11 },
  positionClarityNow: { paddingBottom: 9, borderBottomWidth: 1, borderBottomColor: '#e2e9f3' },
  positionClarityRow: { paddingTop: 9 },
  positionClarityLabel: { color: '#7c899c', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  positionClarityAction: { color: '#16345f', fontSize: 18, lineHeight: 23, fontWeight: '900', marginTop: 3 },
  positionClarityText: { color: '#43566f', fontSize: 11, lineHeight: 17, marginTop: 3 },
  positionContextRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  portfolioMinbeisCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#b9cce8', borderRadius: 18, padding: 14, marginBottom: 8 },
  pendingActionBadge: { backgroundColor: '#fff3d8' },
  pendingActionText: { color: '#976500' },
  queueStatusText: { color: '#60728b', fontSize: 9, lineHeight: 14, marginTop: 6, fontWeight: '700' },
  interimPlanBox: { backgroundColor: '#fff8e7', borderRadius: 13, padding: 11, marginTop: 10 },
  interimPlanEyebrow: { color: '#8a5d00', fontSize: 9, lineHeight: 13, fontWeight: '900', letterSpacing: 0.4 },
  interimPlanAction: { color: '#16345f', fontSize: 16, lineHeight: 21, fontWeight: '900', marginTop: 5 },
  systemDetailsToggle: { marginTop: 10, minHeight: 42, borderRadius: 13, borderWidth: 1, borderColor: '#bdd9ff', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  systemDetailsToggleText: { color: '#0B66FF', fontSize: 11, fontWeight: '900' },
  productFeedbackCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd9ec', borderRadius: 18, padding: 14, marginBottom: 16 },
  productFeedbackTitle: { color: '#16345f', fontSize: 14, fontWeight: '900' },
  productFeedbackText: { color: '#5f7088', fontSize: 11, lineHeight: 17, marginTop: 4 },
  productFeedbackActions: { flexDirection: 'row', gap: 8, marginTop: 11 },
  productFeedbackYes: { flex: 1, minHeight: 40, borderRadius: 12, backgroundColor: '#0B66FF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  productFeedbackYesText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  productFeedbackNo: { flex: 1, minHeight: 40, borderRadius: 12, borderWidth: 1, borderColor: '#cbd9ec', backgroundColor: '#f8fbff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  productFeedbackNoText: { color: '#40536f', fontSize: 11, fontWeight: '900' },
  productFeedbackThanks: { color: '#40536f', fontSize: 11, lineHeight: 16, marginTop: 10, fontWeight: '800' },
  productFeedbackPrivacy: { color: '#8793a6', fontSize: 9, lineHeight: 14, marginTop: 8 },
  productFeedbackMetric: { color: '#60728b', fontSize: 9, lineHeight: 14, marginTop: 5, fontWeight: '700' },
  historicalCard: { backgroundColor: '#f7f5ff', borderWidth: 1, borderColor: '#d8cff3', borderRadius: 14, padding: 11, marginBottom: 8 },
  historicalHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  historicalToggle: { color: '#0B66FF', fontSize: 10, fontWeight: '900' },
  historicalTitle: { color: '#44366e', fontSize: 11, fontWeight: '900' },
  historicalRow: { borderTopWidth: 1, borderTopColor: '#e6e0f4', paddingTop: 7, marginTop: 7 },
  historicalHorizon: { color: '#5b4b82', fontSize: 10, fontWeight: '900' },
  historicalValue: { color: '#263c5e', fontSize: 12, fontWeight: '800', marginTop: 2 },
  historicalMeta: { color: '#77849a', fontSize: 9, lineHeight: 13, marginTop: 2 },
  historicalCaution: { color: '#6d6482', fontSize: 9, lineHeight: 14, marginTop: 8, fontStyle: 'italic' },
  assessmentStrip: { backgroundColor: '#f3f7fd', borderWidth: 1, borderColor: '#cbd9ec', borderRadius: 14, padding: 11, marginTop: 10, marginBottom: 8 },
  assessmentTrap: { backgroundColor: '#fff1f1', borderColor: '#f1b9b9' },
  assessmentSetup: { backgroundColor: '#eefaf3', borderColor: '#b8dfc8' },
  assessmentLabel: { color: '#18385f', fontSize: 12, fontWeight: '900' },
  assessmentMeta: { color: '#8090a7', fontSize: 9, fontWeight: '900' },
  assessmentSummary: { color: '#40536f', fontSize: 12, lineHeight: 18, marginTop: 6 },
  assessmentChange: { color: '#64758e', fontSize: 10, lineHeight: 15, marginTop: 6, fontWeight: '700' },
  minbeisShell: { marginBottom: 20 },
  minbeisHero: { backgroundColor: '#081d3d', borderRadius: 24, padding: 18, marginBottom: 10 },
  minbeisEyebrow: { color: '#8fbaff', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  minbeisHeroTitle: { color: '#fff', fontSize: 22, lineHeight: 29, fontWeight: '900', marginTop: 7 },
  minbeisHeroText: { color: '#c8d9f5', fontSize: 12, lineHeight: 18, marginTop: 7 },
  minbeisCountRow: { flexDirection: 'row', gap: 7, marginTop: 15 },
  minbeisCountBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 13, paddingVertical: 9, alignItems: 'center' },
  minbeisCountValue: { color: '#fff', fontSize: 19, fontWeight: '900' },
  minbeisCountLabel: { color: '#c8d9f5', fontSize: 8, fontWeight: '900', marginTop: 2 },
  minbeisCaution: { color: '#ffd98a', fontSize: 11, lineHeight: 16, marginTop: 12, fontWeight: '800' },
  minbeisDecisionCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#bfd3ef', borderRadius: 18, padding: 14, marginBottom: 8 },
  minbeisActionBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#eaf2ff' },
  minbeisActionText: { color: '#0B66FF', fontSize: 10, fontWeight: '900' },
  minbeisDecisionReason: { color: '#40536f', fontSize: 12, lineHeight: 18, marginTop: 9 },
  summaryCard: { backgroundColor: '#0b2d61', borderRadius: 23, padding: 18, marginBottom: 20 },
  summaryHeadline: { color: '#fff', fontSize: 20, lineHeight: 27, fontWeight: '900' },
  updated: { color: '#c8dcff', fontSize: 12, marginTop: 5 },
  countRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  countBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 15, paddingVertical: 11, paddingHorizontal: 8, alignItems: 'center' },
  countValue: { color: '#fff', fontSize: 22, fontWeight: '900' },
  countLabel: { color: '#d9e7ff', fontSize: 10, lineHeight: 14, textAlign: 'center', fontWeight: '800' },
  sectionBlock: { marginBottom: 18 }, discoveryCard: { backgroundColor: '#f4f8ff', borderWidth: 1, borderColor: '#cbdcf6', borderRadius: 19, padding: 14, marginBottom: 10 }, discoveryScore: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#0B66FF', alignItems: 'center', justifyContent: 'center' }, discoveryScoreValue: { color: '#fff', fontSize: 17, fontWeight: '900' }, discoveryScoreLabel: { color: '#dceaff', fontSize: 8, fontWeight: '800' }, discoveryStatus: { color: '#0B66FF', fontSize: 10, lineHeight: 14, fontWeight: '900', marginTop: 10 }, discoveryDisclaimer: { color: '#6f7e92', fontSize: 9, lineHeight: 13, fontWeight: '800', marginTop: 4 }, discoveryReason: { color: '#40536f', fontSize: 12, lineHeight: 18, marginTop: 4 }, discoveryTime: { color: '#7b889d', fontSize: 10, marginTop: 8 },
  sectionTitle: { color: '#16345f', fontSize: 21, fontWeight: '900' },
  sectionSubtitle: { color: '#718096', fontSize: 13, lineHeight: 18, marginTop: 2, marginBottom: 10 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d5dfec', borderRadius: 22, padding: 16, marginBottom: 11 },
  riskCard: { borderColor: '#e9bec4', backgroundColor: '#fffafb' },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  company: { color: '#16345f', fontSize: 19, lineHeight: 24, fontWeight: '900' },
  symbol: { color: '#718096', fontSize: 12, marginTop: 2 },
  badge: { maxWidth: 120, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: '#edf2f8' },
  badgeReview: { backgroundColor: '#fff3d8' },
  badgePublished: { backgroundColor: '#e4f7ed' },
  badgeText: { color: '#65758a', fontSize: 10, lineHeight: 13, fontWeight: '900', textAlign: 'center' },
  badgeReviewText: { color: '#976500' },
  badgePublishedText: { color: '#087846' },
  category: { color: '#0B66FF', fontWeight: '900', marginTop: 12 },
  riskText: { color: '#b42336' },
  actionRow: { flexDirection: 'row', gap: 9, marginTop: 12 },
  actionBox: { flex: 1, backgroundColor: '#f5f8fc', borderRadius: 15, padding: 11 },
  muted: { color: '#718096', fontSize: 12, lineHeight: 17 },
  action: { color: '#16345f', fontSize: 15, lineHeight: 20, fontWeight: '900', marginTop: 2 }, ageText: { color: '#7b889d', fontSize: 9, lineHeight: 13, marginTop: 3 }, marketQuoteContract: { backgroundColor: '#f3f7fc', borderRadius: 12, padding: 9, marginTop: 9 }, marketQuoteContractText: { color: '#40536f', fontSize: 10, lineHeight: 15, fontWeight: '700' }, timeContext: { backgroundColor: '#f3f7fc', borderRadius: 14, padding: 11, marginBottom: 12 }, timeTitle: { color: '#16345f', fontSize: 12, fontWeight: '900' }, timeText: { color: '#6b7b90', fontSize: 11, lineHeight: 16, marginTop: 3 }, metricNote: { backgroundColor: '#fff7e5', borderRadius: 14, padding: 11, marginBottom: 10 }, metricNoteTitle: { color: '#976500', fontSize: 11, fontWeight: '900', marginBottom: 3 },
  thesis: { color: '#40536f', fontSize: 14, lineHeight: 21, marginTop: 13 },
  warning: { color: '#976500', backgroundColor: '#fff8e7', borderRadius: 13, padding: 11, lineHeight: 19, marginTop: 12 },
  nextBox: { backgroundColor: '#edf4ff', borderRadius: 15, padding: 12, marginTop: 13 },
  nextLabel: { color: '#0B66FF', fontSize: 11, fontWeight: '900' },
  nextText: { color: '#16345f', lineHeight: 20, fontWeight: '800', marginTop: 3 },
  expand: { color: '#0B66FF', textAlign: 'center', fontWeight: '900', marginTop: 14 },
  details: { borderTopWidth: 1, borderTopColor: '#e4eaf2', marginTop: 15, paddingTop: 15 },
  detailTitle: { color: '#16345f', fontSize: 15, fontWeight: '900', marginTop: 11, marginBottom: 4 },
  detailText: { color: '#52647d', fontSize: 14, lineHeight: 21 },
  bullet: { color: '#52647d', fontSize: 14, lineHeight: 21, marginBottom: 4 },
  invalidation: { backgroundColor: '#fff3f4', borderRadius: 15, padding: 12, marginTop: 12 },
  invalidationTitle: { color: '#b42336', fontWeight: '900', marginBottom: 4 },
  blockers: { backgroundColor: '#fff8e7', borderRadius: 15, padding: 12, marginTop: 13 },
  blockerTitle: { color: '#8a5d00', fontWeight: '900', marginBottom: 5 },
  blockerText: { color: '#765716', lineHeight: 20 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#edf1f6', paddingVertical: 10 },
  sourceName: { color: '#16345f', fontWeight: '900' },
  sourceTitle: { color: '#718096', fontSize: 12, lineHeight: 17, marginTop: 2 },
  sourceState: { color: '#0B66FF', fontSize: 10, fontWeight: '900' },
  reviewDate: { color: '#718096', fontSize: 12, marginTop: 13 },
  disclosure: { color: '#718096', fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 14 },
  secondary: { minHeight: 54, borderRadius: 18, borderWidth: 1, borderColor: '#cbd7e6', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  secondaryText: { color: '#16345f', fontWeight: '900' },
  clearButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 6, marginBottom: 16 },
  clearText: { color: '#b42336', fontWeight: '800' },
});
