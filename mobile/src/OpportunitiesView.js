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

function money(referencePrice) {
  const value = Number(referencePrice?.value);
  if (!Number.isFinite(value) || value <= 0) return '—';
  try {
    return new Intl.NumberFormat('el-GR', {
      style: 'currency',
      currency: referencePrice.currency || 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(value);
  } catch {
    return `${value.toLocaleString('el-GR')} ${referencePrice.currency || ''}`.trim();
  }
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

function IntelligenceCard({ item }) {
  const [expanded, setExpanded] = useState(false);
  const risk = ['EVENT_RISK', 'DETERIORATION'].includes(item.category);
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
        <View style={styles.actionRow}>
          <View style={styles.actionBox}>
            <Text style={styles.muted}>Αξιολόγηση</Text>
            <Text style={[styles.action, risk && styles.riskText]}>{item.actionLabel}</Text>
          </View>
          <View style={styles.actionBox}>
            <Text style={styles.muted}>Τιμή αναφοράς</Text>
            <Text style={styles.action}>{money(item.referencePrice)}</Text>
          </View>
        </View>
        {item.thesis ? <Text style={styles.thesis} numberOfLines={expanded ? undefined : 4}>{item.thesis}</Text> : <Text style={styles.warning}>Δεν έχει ολοκληρωθεί ακόμη τεκμηριωμένη επενδυτική θέση.</Text>}
        <View style={styles.nextBox}>
          <Text style={styles.nextLabel}>Επόμενο βήμα</Text>
          <Text style={styles.nextText}>{item.nextStep}</Text>
        </View>
        <Text style={styles.expand}>{expanded ? 'Απόκρυψη λεπτομερειών' : 'Προβολή πλήρους φακέλου'}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.details}>
          {item.causalMechanism ? <><Text style={styles.detailTitle}>Γιατί μπορεί να επηρεάσει τη μετοχή</Text><Text style={styles.detailText}>{item.causalMechanism}</Text></> : null}
          {item.bullCase ? <><Text style={styles.detailTitle}>Θετικό σενάριο</Text><Text style={styles.detailText}>{item.bullCase}</Text></> : null}
          {item.bearCase ? <><Text style={styles.detailTitle}>Αρνητικό σενάριο</Text><Text style={styles.detailText}>{item.bearCase}</Text></> : null}
          {item.invalidationCondition ? <View style={styles.invalidation}><Text style={styles.invalidationTitle}>Τι ακυρώνει την υπόθεση</Text><Text style={styles.detailText}>{item.invalidationCondition}</Text></View> : null}
          {item.catalysts?.length ? <><Text style={styles.detailTitle}>Καταλύτες</Text>{item.catalysts.map((entry, index) => <Text key={`c-${index}`} style={styles.bullet}>• {claimText(entry)}</Text>)}</> : null}
          {item.risks?.length ? <><Text style={styles.detailTitle}>Κίνδυνοι</Text>{item.risks.map((entry, index) => <Text key={`r-${index}`} style={styles.bullet}>• {claimText(entry)}</Text>)}</> : null}
          {item.blockerLabels?.length ? <View style={styles.blockers}><Text style={styles.blockerTitle}>Γιατί δεν είναι ακόμη τελική πρόταση</Text>{item.blockerLabels.map((label, index) => <Text key={`b-${index}`} style={styles.blockerText}>• {label}</Text>)}</View> : null}
          <Text style={styles.detailTitle}>Πηγές</Text>
          {item.sources?.length ? item.sources.map((source, index) => (
            <Pressable key={`${source.sourceUrl}-${index}`} style={styles.sourceRow} onPress={() => Linking.openURL(source.sourceUrl).catch(() => Alert.alert('Πηγή', 'Δεν ήταν δυνατό να ανοίξει ο σύνδεσμος.'))}>
              <View style={styles.grow}>
                <Text style={styles.sourceName}>{source.sourceName}</Text>
                <Text style={styles.sourceTitle}>{source.title}</Text>
              </View>
              <Text style={styles.sourceState}>{source.reviewed ? 'Ελεγμένη' : 'Εντοπίστηκε'}</Text>
            </Pressable>
          )) : <Text style={styles.muted}>Δεν υπάρχουν διαθέσιμες πηγές στην τρέχουσα ροή.</Text>}
          <Text style={styles.reviewDate}>Επανεξέταση: {item.reviewDate || '—'}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Section({ title, subtitle, items }) {
  if (!items.length) return null;
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      {items.map((item) => <IntelligenceCard key={item.id} item={item} />)}
    </View>
  );
}

export default function OpportunitiesView() {
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

  const counts = useMemo(() => feed?.summary || {
    publishedCount: 0,
    reviewReadyCount: 0,
    researchCount: 0,
    urgentCount: 0,
  }, [feed]);
  const freshness = useMemo(() => intelligenceFeedFreshness(feed), [feed]);

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
          <Text style={styles.subtitle}>Τεκμηριωμένη έρευνα, κίνδυνοι και επόμενες ενέργειες</Text>
        </View>
        <Pressable style={[styles.syncSmall, syncing && styles.disabled]} onPress={() => sync({ manual: true })} disabled={syncing}>
          {syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.syncSmallText}>Ανανέωση</Text>}
        </Pressable>
      </View>

      <View style={[styles.connectionCard, freshness.state === 'stale' && styles.connectionBad]}>
        <View style={styles.connectionTop}>
          <View style={styles.grow}>
            <Text style={styles.connectionTitle}>Αυτόματη ασφαλής ενημέρωση</Text>
            <Text style={styles.connectionText}>{feed ? `${freshness.label} · δημιουργία ${when(feed.generatedAt)}` : 'Δεν έχει ληφθεί ακόμη έγκυρη ροή.'}</Text>
          </View>
          <View style={[styles.healthBadge, freshness.state === 'fresh' && styles.healthGood, freshness.state === 'stale' && styles.healthBad]}>
            <Text style={[styles.healthText, freshness.state === 'fresh' && styles.healthGoodText, freshness.state === 'stale' && styles.healthBadText]}>{freshness.state === 'fresh' ? 'LIVE' : freshness.state === 'stale' ? 'ΠΑΛΙΑ' : 'ΕΛΕΓΧΟΣ'}</Text>
          </View>
        </View>
        <Text style={styles.connectionMeta}>Τελευταίος επιτυχής συγχρονισμός: {when(syncState?.lastSuccessAt)}</Text>
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
              <View style={styles.countBox}><Text style={styles.countValue}>{counts.publishedCount}</Text><Text style={styles.countLabel}>Δημοσιευμένες</Text></View>
              <View style={styles.countBox}><Text style={styles.countValue}>{counts.reviewReadyCount}</Text><Text style={styles.countLabel}>Για έλεγχο</Text></View>
              <View style={styles.countBox}><Text style={styles.countValue}>{counts.researchCount}</Text><Text style={styles.countLabel}>Σε έρευνα</Text></View>
            </View>
          </View>

          <Section title="Αυξημένη προτεραιότητα" subtitle="Κίνδυνοι ή εξελίξεις που χρειάζονται πρώτα προσοχή" items={feed.urgent || []} />
          <Section title="Δημοσιευμένες ευκαιρίες" subtitle="Φάκελοι που πέρασαν όλους τους ελέγχους και τη διαδικασία δημοσίευσης" items={feed.published || []} />
          <Section title="Έτοιμα για τελικό έλεγχο" subtitle="Πλήρεις φάκελοι που δεν έχουν ακόμη δημοσιευτεί" items={feed.reviewReady || []} />
          <Section title="Έρευνα σε εξέλιξη" subtitle="Το σύστημα δείχνει καθαρά τι λείπει και δεν επιτρέπει πρόωρη κατεύθυνση αγοράς ή πώλησης" items={feed.research || []} />
          {!feed.published?.length && !feed.reviewReady?.length && !feed.research?.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>Η σύνδεση λειτουργεί, αλλά η τρέχουσα ροή δεν περιέχει ακόμη εταιρικούς φακέλους.</Text><Text style={styles.emptyText}>Αυτό είναι ασφαλέστερο από το να εμφανιστεί μη τεκμηριωμένη πρόταση. Η επόμενη επιτυχής ημερήσια εκτέλεση θα ενημερώσει αυτόματα την οθόνη.</Text></View> : null}
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
  connectionMeta: { color: '#718096', fontSize: 11, marginTop: 9 },
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
  sectionBlock: { marginBottom: 18 },
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
  action: { color: '#16345f', fontSize: 15, lineHeight: 20, fontWeight: '900', marginTop: 2 },
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
