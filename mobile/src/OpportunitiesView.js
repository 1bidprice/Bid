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
        <FinalDecisionCard item={item} decisionContext={decisionContext} />
        <View style={styles.actionRow}>
          <View style={styles.actionBox}><Text style={styles.muted}>Αξιολόγηση</Text><Text style={[styles.action, risk && styles.riskText]}>{item.actionLabel}</Text></View>
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

function OpportunityPurchaseCard({ item }) {
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
      <View style={styles.nextBox}>
        <Text style={styles.nextLabel}>Επόμενη πύλη</Text>
        <Text style={styles.nextText}>{purchaseNextGateLabel(item.nextGate)}</Text>
      </View>
    </View>
  );
}

function PurchaseSection({ title, subtitle, items }) {
  if (!items.length) return null;
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      {items.map((item, index) => <OpportunityPurchaseCard key={item.instrumentId || item.companyId || `purchase-${index}`} item={item} />)}
    </View>
  );
}

function Section({ title, subtitle, items, decisionContext }) {
  if (!items.length) return null;
  return <View style={styles.sectionBlock}><Text style={styles.sectionTitle}>{title}</Text>{subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}{items.map((item) => <IntelligenceCard key={item.id} item={item} decisionContext={decisionContext} />)}</View>;
}

export default function OpportunitiesView({ portfolioPositions = [] }) {
  const [feed, setFeed] = useState(null);
  const [syncState, setSyncState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncError, setSyncError] = useState(null);

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
  const systemReady = operationalHealth?.status === 'OPERATIONAL'
    && operationalHealth?.marketDataStatus === 'OPERATIONAL'
    && operationalHealth?.fundamentalsStatus === 'OPERATIONAL'
    && operationalHealth?.decisionEngineStatus === 'READY';
  const decisionContext = useMemo(() => ({
    feedFresh: freshness.state === 'fresh',
    systemReady,
  }), [freshness.state, systemReady]);
  const productionReady = decisionContext.feedFresh && decisionContext.systemReady;
  const personalizedCounts = useMemo(
    () => personalizedDecisionCounts(feed, portfolioPositions, decisionContext),
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
          <Text style={styles.title}>Ευκαιρίες</Text>
          <Text style={styles.subtitle}>Αυτόνομα συμπεράσματα με διασταύρωση, φρεσκότητα και έλεγχο κινδύνου</Text>
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
            <Text style={[styles.healthText, freshness.state === 'fresh' && styles.healthGoodText, freshness.state === 'stale' && styles.healthBadText]}>{freshness.state === 'fresh' ? 'LIVE' : freshness.state === 'stale' ? 'ΠΑΛΙΑ' : 'ΕΛΕΓΧΟΣ'}</Text>
          </View>
        </View>
        <Text style={styles.connectionMeta}>Τελευταίος επιτυχής συγχρονισμός: {when(syncState?.lastSuccessAt)}</Text>
        <View style={styles.sourcePolicyBox}><Text style={styles.sourcePolicyTitle}>Ποιος επιλέγει τις πηγές;</Text><Text style={styles.sourcePolicyText}>Έκδοση πολιτικής: {feed?.sourceSelection?.version || '—'}. Οι πηγές επιλέγονται από κλειδωμένη πολιτική κώδικα και επιτρεπόμενη λίστα, όχι αυθαίρετα από το AI.</Text></View>
        <View style={[styles.productionHealth, productionReady ? styles.productionHealthGood : styles.productionHealthLimited]}>
          <View style={styles.productionHealthTop}><View style={styles.grow}><Text style={styles.productionHealthEyebrow}>ΚΑΤΑΣΤΑΣΗ ΠΑΡΑΓΩΓΙΚΟΥ ΣΥΣΤΗΜΑΤΟΣ</Text><Text style={styles.productionHealthTitle}>{productionReady ? 'Πλήρης αυτοματοποιημένη λειτουργία' : 'Περιορισμένη λειτουργία — χωρίς αυθαίρετα σήματα'}</Text></View><View style={[styles.productionHealthBadge, productionReady && styles.productionHealthBadgeGood]}><Text style={[styles.productionHealthBadgeText, productionReady && styles.productionHealthBadgeTextGood]}>{productionReady ? 'OPERATIONAL' : 'DEGRADED'}</Text></View></View>
          <Text style={styles.productionHealthText}>{productionReady ? 'Η ροή είναι πρόσφατη και οι υποχρεωτικοί έλεγχοι αγοράς και θεμελιωδών λειτουργούν.' : 'Το σύστημα συνεχίζει να συλλέγει και να ελέγχει δεδομένα, αλλά δεν εγκρίνει αγορά ή πώληση όταν λείπει πηγή, ιστορικό, benchmark, θεμελιώδη ή διασταύρωση.'}</Text>
          <Text style={styles.healthSplitText}>Υποδομή: {operationalHealth?.infrastructureStatus || '—'} · Αγορά: {operationalHealth?.marketDataStatus || '—'} · Θεμελιώδη: {operationalHealth?.fundamentalsStatus || '—'} · Αποφάσεις: {operationalHealth?.decisionEngineStatus || '—'}</Text>
          <View style={styles.productionMetrics}>
            <View style={styles.productionMetric}><Text style={styles.productionMetricValue}>{sourceHealth?.marketSnapshotCount || 0}</Text><Text style={styles.productionMetricLabel}>Τρέχουσες τιμές</Text></View>
            <View style={styles.productionMetric}><Text style={styles.productionMetricValue}>{sourceHealth?.readyHistoricalMarketMetricsCount || 0}/{sourceHealth?.historicalMarketMetricsCount || 0}</Text><Text style={styles.productionMetricLabel}>Έγκυρα ιστορικά</Text></View>
            <View style={styles.productionMetric}><Text style={styles.productionMetricValue}>{sourceHealth?.fundamentalSnapshotCount || 0}</Text><Text style={styles.productionMetricLabel}>Θεμελιώδη</Text></View>
          </View>
          <Text style={styles.productionHealthMeta}>Τελευταία παραγωγή: {when(operationalHealth?.generatedAt || feed?.generatedAt)} · Διαγνωστικά: {sourceHealth?.diagnosticCount || 0}</Text>
        </View>
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
          <View style={styles.summaryCard}>
            <Text style={styles.summaryHeadline}>{feed.today?.headline || 'Ημερήσια σύνοψη'}</Text>
            <Text style={styles.updated}>Έγκυρη ροή: {when(feed.generatedAt)}</Text>
            <View style={styles.countRow}>
              <View style={styles.countBox}><Text style={styles.countValue}>{personalizedCounts.buyNowCount || 0}</Text><Text style={styles.countLabel}>Αγορά τώρα</Text></View>
              <View style={styles.countBox}><Text style={styles.countValue}>{personalizedCounts.sellNowCount || 0}</Text><Text style={styles.countLabel}>Πώληση τώρα</Text></View>
              <View style={styles.countBox}><Text style={styles.countValue}>{counts.finalActionCount || 0}</Text><Text style={styles.countLabel}>Τελικά σήματα</Text></View>
            </View>
          </View>

          {feed.discoveryRadar?.length ? <View style={styles.sectionBlock}><Text style={styles.sectionTitle}>Ραντάρ νέων μετοχών</Text><Text style={styles.sectionSubtitle}>Το σύστημα σαρώνει αυτόματα επίσημα γεγονότα της αγοράς, κατατάσσει νέες εταιρείες και περνά τις ισχυρότερες σε πλήρη ανάλυση.</Text>{feed.discoveryRadar.map((item) => <DiscoveryRadarCard key={item.discoveryId} item={item} />)}</View> : null}
          <PurchaseSection title="ΑΓΟΡΑ ΕΠΙΒΕΒΑΙΩΘΗΚΕ" subtitle="Μόνο ευκαιρίες που πέρασαν και τη δεύτερη αυστηρή πολιτική BUY_NOW. Καμία αυτόματη συναλλαγή." items={decisionContext.feedFresh && decisionContext.systemReady ? (feed.confirmedBuyOpportunities || []) : []} />
          <PurchaseSection title="Ισχυρές ευκαιρίες — αναμονή εισόδου" subtitle="Υψηλή κατάταξη Opportunity Hunter, αλλά δεν έχουν επιβεβαιωθεί ακόμη όλα τα strict BUY gates." items={feed.waitingEntryOpportunities || []} />
          <PurchaseSection title="Απορρίφθηκαν για αγορά" subtitle="Ο Opportunity Hunter τις εντόπισε, αλλά ο αυστηρός τελικός έλεγχος απέρριψε αγορά με τα τωρινά δεδομένα." items={feed.rejectedOpportunities || []} />
          <PurchaseSection title="Μπλοκαρισμένες ευκαιρίες" subtitle="Χρειάζονται πλήρη ανάλυση ή υποχρεωτικούς ελέγχους πριν μπορούν να αξιολογηθούν για αγορά." items={feed.blockedOpportunities || []} />

          <Section title="Αυξημένη προτεραιότητα" subtitle="Κίνδυνοι ή εξελίξεις που χρειάζονται πρώτα προσοχή" items={feed.urgent || []} decisionContext={decisionContext} decisionContext={decisionContext} />
          <Section title="Δημοσιευμένες ευκαιρίες" subtitle="Φάκελοι που πέρασαν όλους τους ελέγχους και τη διαδικασία δημοσίευσης" items={feed.published || []} decisionContext={decisionContext} decisionContext={decisionContext} />
          <Section title="Έτοιμα για τελικό έλεγχο" subtitle="Πλήρεις φάκελοι που δεν έχουν ακόμη δημοσιευτεί" items={feed.reviewReady || []} decisionContext={decisionContext} decisionContext={decisionContext} />
          <Section title="Έρευνα σε εξέλιξη" subtitle="Το σύστημα δείχνει καθαρά τι λείπει και δεν επιτρέπει πρόωρη κατεύθυνση αγοράς ή πώλησης" items={feed.research || []} decisionContext={decisionContext} decisionContext={decisionContext} />
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
