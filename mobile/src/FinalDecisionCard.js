import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEY } from './background-alert-task';
import { portfolioSnapshot } from './decision-engine';
import { finalActionValidity } from './decision-validity';

function when(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('el-GR');
}

function canonicalPositionSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/\.(US|GR)$/, '');
}

function actionLabel(code, finalAction) {
  if (code === finalAction?.holderAction) return finalAction.holderActionLabel;
  if (code === finalAction?.nonHolderAction) return finalAction.nonHolderActionLabel;
  if (code === finalAction?.marketAction) return finalAction.marketActionLabel;
  return {
    BUY_NOW: 'ΑΜΕΣΗ ΑΓΟΡΑ',
    SELL_NOW: 'ΑΜΕΣΗ ΠΩΛΗΣΗ / ΜΕΙΩΣΗ',
    HOLD: 'ΚΡΑΤΑ',
    DO_NOT_BUY: 'ΜΗΝ ΑΓΟΡΑΣΕΙΣ',
    AVOID: 'ΑΠΕΦΥΓΕ',
    WATCH: 'ΠΑΡΑΚΟΛΟΥΘΗΣΗ',
  }[code] || code || 'ΠΑΡΑΚΟΛΟΥΘΗΣΗ';
}

function blockerLabel(code) {
  return {
    DOSSIER_NOT_PUBLISHABLE: 'Ο φάκελος δεν έχει ολοκληρώσει όλους τους ελέγχους',
    DOSSIER_NOT_READY: 'Η ανάλυση δεν είναι έτοιμη για τελική ενέργεια',
    CROSS_CHECK_NOT_READY: 'Λείπει ανεξάρτητη διασταύρωση του ίδιου γεγονότος',
    FUNDAMENTALS_NOT_READY: 'Λείπουν επαρκή και επαληθευμένα θεμελιώδη στοιχεία',
    MARKET_METRICS_NOT_READY: 'Δεν έχουν ολοκληρωθεί οι έλεγχοι ιστορικού, όγκου και σχετικής ισχύος',
    MARKET_HISTORY_SOURCE_NOT_READY: 'Η πηγή ιστορικών δεδομένων δεν έχει εγκριθεί',
    MARKET_HISTORY_NOT_CROSSCHECKED: 'Το ιστορικό τιμών δεν έχει διασταυρωθεί με ανεξάρτητη τρέχουσα τιμή',
    MARKET_BENCHMARK_NOT_READY: 'Λείπει έγκυρο benchmark αγοράς',
    REFERENCE_PRICE_REQUIRED: 'Λείπει έγκυρη τιμή αναφοράς',
    REFERENCE_PRICE_STALE: 'Η τιμή αναφοράς είναι παρωχημένη',
    MARKET_HISTORY_STALE: 'Τα ιστορικά δεδομένα δεν είναι αρκετά πρόσφατα',
    UNRESOLVED_CONTRADICTION: 'Υπάρχει ανεπίλυτη αντίφαση στις πηγές',
  }[code] || code;
}

function tone(code) {
  if (code === 'BUY_NOW') return 'positive';
  if (code === 'HOLD') return 'hold';
  if (['SELL_NOW', 'AVOID'].includes(code)) return 'danger';
  if (code === 'DO_NOT_BUY') return 'warning';
  return 'neutral';
}

export default function FinalDecisionCard({ item, decisionContext = {} }) {
  const [hasPosition, setHasPosition] = useState(false);

  const loadPosition = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const state = raw ? JSON.parse(raw) : { transactions: [], prices: {} };
      const snapshot = portfolioSnapshot(state);
      setHasPosition(snapshot.positions.some((position) => canonicalPositionSymbol(position.symbol) === canonicalPositionSymbol(item?.symbol) && Number(position.quantity) > 0));
    } catch {
      setHasPosition(false);
    }
  }, [item?.symbol]);

  useEffect(() => {
    loadPosition();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') loadPosition();
    });
    return () => subscription.remove();
  }, [loadPosition]);

  const finalAction = item?.finalAction || null;
  const blockers = Array.isArray(finalAction?.blockers) ? finalAction.blockers : [];
  const decisionValidity = useMemo(
    () => finalActionValidity(finalAction, decisionContext),
    [finalAction, decisionContext?.feedFresh, decisionContext?.systemReady],
  );
  const personalized = useMemo(() => {
    if (!decisionValidity.eligible) return null;
    const code = hasPosition ? finalAction.holderAction : finalAction.nonHolderAction;
    return { code, label: actionLabel(code, finalAction), tone: tone(code) };
  }, [decisionValidity.eligible, finalAction, hasPosition]);

  if (!personalized) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedEyebrow}>ΤΕΛΙΚΟ ΣΥΜΠΕΡΑΣΜΑ</Text>
        <Text style={styles.blockedTitle}>{decisionValidity.reason === 'DECISION_EXPIRED' ? 'Η προηγούμενη τελική ενέργεια έχει λήξει' : decisionValidity.reason === 'FEED_NOT_FRESH' ? 'Απαιτείται νέα ενημέρωση της έρευνας' : decisionValidity.reason === 'SYSTEM_NOT_READY' ? 'Η τελική ενέργεια έχει παγώσει' : 'Δεν έχει εγκριθεί τελική ενέργεια'}</Text>
        <Text style={styles.blockedText}>{decisionValidity.reason === 'DECISION_EXPIRED' ? 'Το παλιό BUY/SELL δεν θεωρείται ενεργό. Απαιτείται νέα τεκμηριωμένη αξιολόγηση.' : decisionValidity.reason === 'FEED_NOT_FRESH' ? 'Η αγορά μπορεί να έχει νεότερη τιμή, αλλά παλιά ερευνητική ροή δεν επιτρέπεται να εμφανίσει ενεργό BUY/SELL.' : decisionValidity.reason === 'SYSTEM_NOT_READY' ? 'Η τελική κατεύθυνση παραμένει ανενεργή μέχρι να είναι ξανά έτοιμοι όλοι οι υποχρεωτικοί έλεγχοι.' : 'Δεν παράγεται αγορά ή πώληση μέχρι να περάσουν όλοι οι υποχρεωτικοί έλεγχοι.'}</Text>
        {blockers.slice(0, 4).map((code) => <Text key={code} style={styles.blockedReason}>• {blockerLabel(code)}</Text>)}
      </View>
    );
  }

  return (
    <View style={[
      styles.card,
      personalized.tone === 'positive' && styles.positive,
      personalized.tone === 'hold' && styles.hold,
      personalized.tone === 'warning' && styles.warning,
      personalized.tone === 'danger' && styles.danger,
    ]}>
      <View style={styles.topRow}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>ΤΕΛΙΚΟ ΣΥΜΠΕΡΑΣΜΑ ΓΙΑ ΕΣΕΝΑ</Text>
          <Text style={styles.positionState}>{hasPosition ? 'Υπάρχει θέση στο χαρτοφυλάκιο' : 'Δεν υπάρχει θέση στο χαρτοφυλάκιο'}</Text>
        </View>
        <Text style={styles.urgency}>{finalAction.urgencyLabel}</Text>
      </View>
      <Text style={styles.action}>{personalized.label}</Text>
      <View style={styles.metrics}>
        <View style={styles.metric}><Text style={styles.metricLabel}>Εμπιστοσύνη</Text><Text style={styles.metricValue}>{Math.round(Number(finalAction.confidenceScore || 0))}/100</Text></View>
        <View style={styles.metric}><Text style={styles.metricLabel}>Ποιότητα δεδομένων</Text><Text style={styles.metricValue}>{Math.round(Number(finalAction.dataQualityScore || 0))}/100</Text></View>
      </View>
      <Text style={styles.validity}>Ισχύει μέχρι: {when(finalAction.validUntil)} · Πολιτική {finalAction.policyVersion}</Text>
      <Text style={styles.execution}>Δεν εκτελείται εντολή σε χρηματιστηριακή. Η τελική πράξη παραμένει αποκλειστικά δική σου.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  blocked: { backgroundColor: '#f5f8fc', borderWidth: 1, borderColor: '#d7e0ec', borderRadius: 17, padding: 13, marginTop: 13 },
  blockedEyebrow: { color: '#718096', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  blockedTitle: { color: '#16345f', fontSize: 16, fontWeight: '900', marginTop: 4 },
  blockedText: { color: '#62738a', fontSize: 12, lineHeight: 18, marginTop: 5 }, blockedReason: { color: '#735f31', fontSize: 10, lineHeight: 15, marginTop: 4 },
  card: { backgroundColor: '#eef3f8', borderWidth: 1, borderColor: '#cfd9e6', borderRadius: 18, padding: 14, marginTop: 13 },
  positive: { backgroundColor: '#e9f8ef', borderColor: '#9fd8b7' },
  hold: { backgroundColor: '#edf4ff', borderColor: '#b4cdf5' },
  warning: { backgroundColor: '#fff8e7', borderColor: '#ecd08f' },
  danger: { backgroundColor: '#fff0f2', borderColor: '#efb7c0' },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  eyebrow: { color: '#16345f', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  positionState: { color: '#617187', fontSize: 11, marginTop: 3 },
  urgency: { color: '#16345f', fontSize: 10, fontWeight: '900', textAlign: 'right', maxWidth: 105 },
  action: { color: '#07163E', fontSize: 24, lineHeight: 29, fontWeight: '900', marginTop: 12 },
  metrics: { flexDirection: 'row', gap: 9, marginTop: 12 },
  metric: { flex: 1, backgroundColor: 'rgba(255,255,255,0.62)', borderRadius: 13, padding: 10 },
  metricLabel: { color: '#6e7d91', fontSize: 10, lineHeight: 14 },
  metricValue: { color: '#16345f', fontSize: 16, fontWeight: '900', marginTop: 2 },
  validity: { color: '#5f6f84', fontSize: 10, lineHeight: 15, marginTop: 11 },
  execution: { color: '#5f6f84', fontSize: 10, lineHeight: 15, marginTop: 5 },
});
