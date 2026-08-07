const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function writeDecisionPassportCard() {
  const source = `import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEY } from './background-alert-task';
import {
  DECISION_SETTINGS_KEY,
  normalizeDecisionSettings,
  portfolioSnapshot,
  samePositionSymbol,
} from './decision-engine';

function when(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('el-GR');
}

function numberPct(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('el-GR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—';
}

function actionLabel(code, action) {
  if (code === action?.holderAction) return action.holderActionLabel;
  if (code === action?.nonHolderAction) return action.nonHolderActionLabel;
  if (code === action?.marketAction) return action.marketActionLabel;
  return {
    BUY_NOW: 'ΑΜΕΣΗ ΑΓΟΡΑ',
    SELL_NOW: 'ΑΜΕΣΗ ΠΩΛΗΣΗ / ΜΕΙΩΣΗ',
    HOLD: 'ΚΡΑΤΑ',
    DO_NOT_BUY: 'ΜΗΝ ΑΓΟΡΑΣΕΙΣ',
    AVOID: 'ΑΠΕΦΥΓΕ',
    WATCH: 'ΠΑΡΑΚΟΛΟΥΘΗΣΗ',
  }[code] || code || 'ΠΑΡΑΚΟΛΟΥΘΗΣΗ';
}

function tone(code) {
  if (code === 'BUY_NOW') return 'positive';
  if (code === 'HOLD') return 'hold';
  if (['SELL_NOW', 'AVOID'].includes(code)) return 'danger';
  if (code === 'DO_NOT_BUY') return 'warning';
  return 'neutral';
}

function priceGrade(item, action) {
  const contract = item?.marketQuote?.quoteContract || {};
  if (action?.freshness?.executionFreshnessEligible === true || contract.executionFreshnessEligible === true || contract.decisionEligible === true) {
    return { label: 'ΕΚΤΕΛΕΣΗΣ', detail: 'Η χρονική ακρίβεια της τιμής έχει περάσει το αυστηρό gate για άμεση ενέργεια.' };
  }
  if (contract.analysisReferenceEligible === true || contract.valuationEligible === true) {
    return { label: 'ΑΝΑΛΥΣΗΣ', detail: 'Η τιμή μπορεί να χρησιμοποιηθεί για αποτίμηση/ανάλυση, όχι ως βάση άμεσου BUY/SELL.' };
  }
  return { label: 'ΠΕΡΙΟΡΙΣΜΕΝΗ', detail: 'Η τιμή δεν έχει περάσει ακόμη το απαιτούμενο επίπεδο επαλήθευσης.' };
}

export default function FinalDecisionCard({ item }) {
  const [local, setLocal] = useState({
    hasPosition: false,
    currentWeightPct: null,
    maxAllocationPct: null,
    positionValueEUR: null,
    totalValueEUR: null,
  });

  const loadLocalContext = useCallback(async () => {
    try {
      const [portfolioRaw, settingsRaw] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(DECISION_SETTINGS_KEY),
      ]);
      const state = portfolioRaw ? JSON.parse(portfolioRaw) : { transactions: [], prices: {} };
      let rawSettings = null;
      try { rawSettings = settingsRaw ? JSON.parse(settingsRaw) : null; } catch { rawSettings = null; }
      const settings = normalizeDecisionSettings(rawSettings);
      const snapshot = portfolioSnapshot(state);
      const position = snapshot.positions.find((entry) => samePositionSymbol(entry.symbol, item?.symbol) && Number(entry.quantity) > 0) || null;
      const positionValueEUR = Number(position?.valueEUR);
      const totalValueEUR = Number(snapshot.totalValueEUR);
      const currentWeightPct = position && Number.isFinite(positionValueEUR) && Number.isFinite(totalValueEUR) && totalValueEUR > 0
        ? (positionValueEUR / totalValueEUR) * 100
        : null;
      setLocal({
        hasPosition: Boolean(position),
        currentWeightPct: Number.isFinite(currentWeightPct) ? currentWeightPct : null,
        maxAllocationPct: Number(settings.maxAllocationPct),
        positionValueEUR: Number.isFinite(positionValueEUR) ? positionValueEUR : null,
        totalValueEUR: Number.isFinite(totalValueEUR) ? totalValueEUR : null,
      });
    } catch {
      setLocal({ hasPosition: false, currentWeightPct: null, maxAllocationPct: null, positionValueEUR: null, totalValueEUR: null });
    }
  }, [item?.symbol]);

  useEffect(() => {
    loadLocalContext();
    const interval = setInterval(loadLocalContext, 15000);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') loadLocalContext();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [loadLocalContext]);

  const finalAction = item?.finalAction || null;
  const controlledPlan = finalAction?.controlledPlan?.status === 'AVAILABLE'
    ? finalAction.controlledPlan
    : null;
  const personalized = useMemo(() => {
    if (finalAction?.status === 'FINAL') {
      const code = local.hasPosition ? finalAction.holderAction : finalAction.nonHolderAction;
      return { code, label: actionLabel(code, finalAction), tone: tone(code), interim: false, source: finalAction };
    }
    if (controlledPlan) {
      const code = local.hasPosition ? controlledPlan.holderAction : controlledPlan.nonHolderAction;
      return { code, label: actionLabel(code, controlledPlan), tone: tone(code), interim: true, source: controlledPlan };
    }
    return null;
  }, [finalAction, controlledPlan, local.hasPosition]);

  const concentrationKnown = Number.isFinite(local.currentWeightPct) && Number.isFinite(local.maxAllocationPct);
  const concentrationExceeded = concentrationKnown && local.currentWeightPct > local.maxAllocationPct;
  const quoteGrade = priceGrade(item, finalAction);
  const evidenceScore = Math.round(Number(personalized?.source?.dataQualityScore ?? finalAction?.dataQualityScore ?? 0));

  if (!personalized) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedEyebrow}>ΤΕΛΙΚΟ ΣΥΜΠΕΡΑΣΜΑ</Text>
        <Text style={styles.blockedTitle}>Δεν έχει εγκριθεί τελική ενέργεια</Text>
        <Text style={styles.blockedText}>Το σύστημα παραμένει σε παρακολούθηση μέχρι να περάσουν όλοι οι έλεγχοι πηγών, τιμών, θεμελιωδών, ρευστότητας και αντιφάσεων.</Text>
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
          <Text style={styles.eyebrow}>{personalized.interim ? 'ΠΛΑΝΟ ΤΩΡΑ — ΠΕΡΙΟΡΙΣΜΕΝΑ ΔΕΔΟΜΕΝΑ' : 'ΤΕΛΙΚΟ ΣΥΜΠΕΡΑΣΜΑ ΓΙΑ ΕΣΕΝΑ'}</Text>
          <Text style={styles.positionState}>{local.hasPosition ? 'Υπάρχει θέση στο χαρτοφυλάκιο' : 'Δεν υπάρχει θέση στο χαρτοφυλάκιο'}</Text>
        </View>
        <Text style={styles.urgency}>{personalized.interim ? 'ΕΝΔΙΑΜΕΣΟ' : finalAction.urgencyLabel}</Text>
      </View>
      <Text style={styles.action}>{personalized.label}</Text>
      <View style={styles.metrics}>
        <View style={styles.metric}><Text style={styles.metricLabel}>Εμπιστοσύνη</Text><Text style={styles.metricValue}>{Math.round(Number(personalized.source?.confidenceScore || 0))}/100</Text></View>
        <View style={styles.metric}><Text style={styles.metricLabel}>Ποιότητα δεδομένων</Text><Text style={styles.metricValue}>{evidenceScore}/100</Text></View>
      </View>

      <View style={styles.passport}>
        <Text style={styles.passportEyebrow}>DECISION PASSPORT · ΓΙΑ ΤΟ ΔΙΚΟ ΣΟΥ ΧΑΡΤΟΦΥΛΑΚΙΟ</Text>
        <View style={styles.passportGrid}>
          <View style={styles.passportCell}>
            <Text style={styles.passportLabel}>Τιμή</Text>
            <Text style={styles.passportValue}>{quoteGrade.label}</Text>
          </View>
          <View style={styles.passportCell}>
            <Text style={styles.passportLabel}>Τεκμηρίωση</Text>
            <Text style={styles.passportValue}>{evidenceScore}/100</Text>
          </View>
          <View style={styles.passportCell}>
            <Text style={styles.passportLabel}>Βάρος θέσης</Text>
            <Text style={[styles.passportValue, concentrationExceeded && styles.passportDanger]}>{local.hasPosition ? numberPct(local.currentWeightPct) : 'ΧΩΡΙΣ ΘΕΣΗ'}</Text>
          </View>
          <View style={styles.passportCell}>
            <Text style={styles.passportLabel}>Όριο</Text>
            <Text style={styles.passportValue}>{numberPct(local.maxAllocationPct)}</Text>
          </View>
        </View>
        <Text style={styles.passportText}>{quoteGrade.detail}</Text>
        {local.hasPosition && concentrationExceeded ? (
          <Text style={styles.concentrationDanger}>Η θέση υπερβαίνει το προσωπικό όριο συγκέντρωσης. Νέα ενίσχυση μπλοκάρεται και από τον κανόνα χαρτοφυλακίου — ανεξάρτητα από την επενδυτική υπόθεση.</Text>
        ) : local.hasPosition && concentrationKnown ? (
          <Text style={styles.passportText}>Η θέση βρίσκεται εντός του ορίου συγκέντρωσης. Αυτό από μόνο του δεν αποτελεί έγκριση ενίσχυσης.</Text>
        ) : local.hasPosition ? (
          <Text style={styles.passportText}>Το βάρος θέσης δεν μπορεί να υπολογιστεί αξιόπιστα μέχρι να υπάρχει πλήρης αποτίμηση του χαρτοφυλακίου.</Text>
        ) : (
          <Text style={styles.passportText}>Δεν υπάρχει υφιστάμενη έκθεση. Ο έλεγχος συγκέντρωσης θα εφαρμοστεί πριν από οποιαδήποτε νέα θέση.</Text>
        )}
      </View>

      {personalized.interim ? <Text style={styles.planRationale}>{local.hasPosition ? 'Υπάρχει ήδη θέση στο χαρτοφυλάκιο. Μέχρι να ολοκληρωθούν οι υποχρεωτικοί έλεγχοι, το πλάνο αφορά διατήρηση και επανεξέταση της υπάρχουσας θέσης χωρίς νέα ενίσχυση — όχι αυτόματη πώληση.' : 'Δεν υπάρχει θέση στο χαρτοφυλάκιο. Μέχρι να ολοκληρωθούν οι υποχρεωτικοί έλεγχοι, δεν εγκρίνεται νέα είσοδος.'}</Text> : null}
      <Text style={styles.validity}>Ισχύει μέχρι: {when(personalized.source?.validUntil)}{personalized.interim ? ' · Δεν αποτελεί τελικό BUY/SELL σήμα' : ' · Πολιτική ' + finalAction.policyVersion}</Text>
      <Text style={styles.execution}>{personalized.interim ? 'Το πλάνο είναι συντηρητικός έλεγχος κινδύνου μέχρι να ολοκληρωθεί η τεκμηρίωση. Δεν εκτελείται καμία εντολή.' : 'Δεν εκτελείται εντολή σε χρηματιστηριακή. Η τελική πράξη παραμένει αποκλειστικά δική σου.'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  blocked: { backgroundColor: '#f5f8fc', borderWidth: 1, borderColor: '#d7e0ec', borderRadius: 17, padding: 13, marginTop: 13 },
  blockedEyebrow: { color: '#718096', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  blockedTitle: { color: '#16345f', fontSize: 16, fontWeight: '900', marginTop: 4 },
  blockedText: { color: '#62738a', fontSize: 12, lineHeight: 18, marginTop: 5 },
  card: { backgroundColor: '#eef3f8', borderWidth: 1, borderColor: '#cfd9e6', borderRadius: 18, padding: 14, marginTop: 13 },
  positive: { backgroundColor: '#e9f8ef', borderColor: '#9fd8b7' },
  hold: { backgroundColor: '#edf4ff', borderColor: '#b4cdf5' },
  warning: { backgroundColor: '#fff8e7', borderColor: '#ecd08f' },
  danger: { backgroundColor: '#fff0f2', borderColor: '#efb7c0' },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' },
  eyebrow: { color: '#16345f', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  positionState: { color: '#617187', fontSize: 11, marginTop: 3 },
  urgency: { color: '#16345f', fontSize: 10, fontWeight: '900', textAlign: 'right', maxWidth: 105 },
  action: { color: '#07163E', fontSize: 24, lineHeight: 29, fontWeight: '900', marginTop: 12 },
  metrics: { flexDirection: 'row', gap: 9, marginTop: 12 },
  metric: { flex: 1, backgroundColor: 'rgba(255,255,255,0.62)', borderRadius: 13, padding: 10 },
  metricLabel: { color: '#6e7d91', fontSize: 10, lineHeight: 14 },
  metricValue: { color: '#16345f', fontSize: 16, fontWeight: '900', marginTop: 2 },
  passport: { backgroundColor: 'rgba(7,22,62,0.055)', borderWidth: 1, borderColor: '#c8d8ee', borderRadius: 15, padding: 12, marginTop: 12 },
  passportEyebrow: { color: '#0B66FF', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  passportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 },
  passportCell: { flexGrow: 1, flexBasis: '46%', minWidth: 110, backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: 11, padding: 9 },
  passportLabel: { color: '#6e7d91', fontSize: 9, fontWeight: '700' },
  passportValue: { color: '#16345f', fontSize: 13, fontWeight: '900', marginTop: 2 },
  passportDanger: { color: '#c73549' },
  passportText: { color: '#536981', fontSize: 10, lineHeight: 15, marginTop: 9 },
  concentrationDanger: { color: '#9f2638', fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 9 },
  planRationale: { color: '#425873', fontSize: 11, lineHeight: 17, fontWeight: '700', marginTop: 11 },
  validity: { color: '#5f6f84', fontSize: 10, lineHeight: 15, marginTop: 11 },
  execution: { color: '#5f6f84', fontSize: 10, lineHeight: 15, marginTop: 5 },
});
`;
  write('src/FinalDecisionCard.js', source);
}

function patchVersions() {
  for (const file of ['PortfolioApp.js', 'DecisionOverlay.js']) {
    let source = read(file);
    if (source.includes("const VERSION = '1.2.4';")) source = source.replace("const VERSION = '1.2.4';", "const VERSION = '1.2.5';");
    else if (!source.includes("const VERSION = '1.2.5';")) throw new Error(`v1.2.5 missing runtime version in ${file}`);
    write(file, source);
  }

  const app = JSON.parse(read('app.json'));
  app.expo.version = '1.2.5';
  app.expo.android.versionCode = 28;
  app.expo.ios.buildNumber = '28';
  write('app.json', `${JSON.stringify(app, null, 2)}\n`);

  const pkg = JSON.parse(read('package.json'));
  pkg.version = '1.2.5';
  const postinstall = String(pkg.scripts?.postinstall || '');
  if (!postinstall.includes('apply-v125-personal-decision-passport.js')) {
    pkg.scripts.postinstall = `${postinstall}${postinstall ? ' && ' : ''}node scripts/apply-v125-personal-decision-passport.js`;
  }
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
}

writeDecisionPassportCard();
patchVersions();

const card = read('src/FinalDecisionCard.js');
const portfolio = read('PortfolioApp.js');
const decision = read('DecisionOverlay.js');
const app = JSON.parse(read('app.json'));
const pkg = JSON.parse(read('package.json'));
for (const invariant of ['DECISION PASSPORT', 'DECISION_SETTINGS_KEY', 'samePositionSymbol', 'executionFreshnessEligible', 'Η θέση υπερβαίνει το προσωπικό όριο συγκέντρωσης']) {
  if (!card.includes(invariant)) throw new Error(`v1.2.5 Decision Passport verification failed: ${invariant}`);
}
if (!portfolio.includes("const VERSION = '1.2.5';") || !decision.includes("const VERSION = '1.2.5';")) throw new Error('v1.2.5 runtime identity mismatch');
if (app.expo.version !== '1.2.5' || app.expo.android.versionCode !== 28 || app.expo.ios.buildNumber !== '28') throw new Error('v1.2.5 release identity mismatch');
if (pkg.version !== '1.2.5' || !String(pkg.scripts?.postinstall || '').includes('apply-v125-personal-decision-passport.js')) throw new Error('v1.2.5 package identity mismatch');

console.log('Investor Control v1.2.5 Personal Decision Passport applied: evidence grade, quote grade and live portfolio concentration.');
