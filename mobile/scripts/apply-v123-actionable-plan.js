const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.2.3 actionable-plan patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchDecisionCard() {
  const canonical = `import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEY } from './background-alert-task';
import { portfolioSnapshot } from './decision-engine';

function when(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('el-GR');
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

export default function FinalDecisionCard({ item }) {
  const [hasPosition, setHasPosition] = useState(false);

  const loadPosition = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const state = raw ? JSON.parse(raw) : { transactions: [], prices: {} };
      const snapshot = portfolioSnapshot(state);
      setHasPosition(snapshot.positions.some((position) => position.symbol === item?.symbol && Number(position.quantity) > 0));
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
  const controlledPlan = finalAction?.controlledPlan?.status === 'AVAILABLE'
    ? finalAction.controlledPlan
    : null;
  const personalized = useMemo(() => {
    if (finalAction?.status === 'FINAL') {
      const code = hasPosition ? finalAction.holderAction : finalAction.nonHolderAction;
      return { code, label: actionLabel(code, finalAction), tone: tone(code), interim: false, source: finalAction };
    }
    if (controlledPlan) {
      const code = hasPosition ? controlledPlan.holderAction : controlledPlan.nonHolderAction;
      return { code, label: actionLabel(code, controlledPlan), tone: tone(code), interim: true, source: controlledPlan };
    }
    return null;
  }, [finalAction, controlledPlan, hasPosition]);

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
          <Text style={styles.positionState}>{hasPosition ? 'Υπάρχει θέση στο χαρτοφυλάκιο' : 'Δεν υπάρχει θέση στο χαρτοφυλάκιο'}</Text>
        </View>
        <Text style={styles.urgency}>{personalized.interim ? 'ΕΝΔΙΑΜΕΣΟ' : finalAction.urgencyLabel}</Text>
      </View>
      <Text style={styles.action}>{personalized.label}</Text>
      <View style={styles.metrics}>
        <View style={styles.metric}><Text style={styles.metricLabel}>Εμπιστοσύνη</Text><Text style={styles.metricValue}>{Math.round(Number(personalized.source?.confidenceScore || 0))}/100</Text></View>
        <View style={styles.metric}><Text style={styles.metricLabel}>Ποιότητα δεδομένων</Text><Text style={styles.metricValue}>{Math.round(Number(personalized.source?.dataQualityScore || 0))}/100</Text></View>
      </View>
      {personalized.interim ? <Text style={styles.planRationale}>{personalized.source?.rationale || 'Δεν έχουν ολοκληρωθεί όλοι οι έλεγχοι για τελική ενέργεια.'}</Text> : null}
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
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  eyebrow: { color: '#16345f', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  positionState: { color: '#617187', fontSize: 11, marginTop: 3 },
  urgency: { color: '#16345f', fontSize: 10, fontWeight: '900', textAlign: 'right', maxWidth: 105 },
  action: { color: '#07163E', fontSize: 24, lineHeight: 29, fontWeight: '900', marginTop: 12 },
  metrics: { flexDirection: 'row', gap: 9, marginTop: 12 },
  metric: { flex: 1, backgroundColor: 'rgba(255,255,255,0.62)', borderRadius: 13, padding: 10 },
  metricLabel: { color: '#6e7d91', fontSize: 10, lineHeight: 14 },
  metricValue: { color: '#16345f', fontSize: 16, fontWeight: '900', marginTop: 2 },
  planRationale: { color: '#425873', fontSize: 11, lineHeight: 17, fontWeight: '700', marginTop: 11 },
  validity: { color: '#5f6f84', fontSize: 10, lineHeight: 15, marginTop: 11 },
  execution: { color: '#5f6f84', fontSize: 10, lineHeight: 15, marginTop: 5 },
});
`;
  write('src/FinalDecisionCard.js', canonical);
}

function patchPortfolioLayoutAndVersion() {
  let source = read('PortfolioApp.js');
  source = replaceRequired(source, "const VERSION = '1.2.2';", "const VERSION = '1.2.3';", 'Portfolio version');

  source = replaceRequired(
    source,
    `<View style={styles.rowTop}>
          <View style={styles.grow}>
            <Text style={styles.cardTitle}>{item.company}</Text>
            <Text style={styles.muted}>{item.symbol} · {item.quantity.toLocaleString('el-GR')} μετοχές</Text>
          </View>
          <QuoteBadge quote={item.quote} />
        </View>`,
    `<View style={styles.positionHeader}>
          <View style={styles.positionTitleBlock}>
            <Text style={styles.cardTitle}>{item.company}</Text>
            <Text style={styles.muted}>{item.symbol} · {item.quantity.toLocaleString('el-GR')} μετοχές</Text>
          </View>
          <QuoteBadge quote={item.quote} />
        </View>`,
    'position header layout',
  );

  source = replaceRequired(
    source,
    `title: { color: '#16345f', fontSize: 36, lineHeight: 41, fontWeight: '900' }, titleCompact: { fontSize: 31 }, versionLine: { color: '#718096', marginTop: 4, fontWeight: '700' }, rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }, grow: { flex: 1, minWidth: 0 },`,
    `title: { color: '#16345f', fontSize: 36, lineHeight: 41, fontWeight: '900' }, titleCompact: { fontSize: 31 }, versionLine: { color: '#718096', marginTop: 4, fontWeight: '700' }, rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }, positionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }, positionTitleBlock: { flexGrow: 1, flexShrink: 1, minWidth: 180 }, grow: { flex: 1, minWidth: 0 },`,
    'position header styles',
  );

  source = replaceRequired(
    source,
    `badge: { backgroundColor: '#edf4ff', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18 }, badgeText: { color: '#0B66FF', fontWeight: '900', fontSize: 13 },`,
    `badge: { backgroundColor: '#edf4ff', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18, maxWidth: '100%', flexShrink: 1 }, badgeText: { color: '#0B66FF', fontWeight: '900', fontSize: 13, textAlign: 'center' },`,
    'responsive quote badge',
  );

  source = replaceRequired(
    source,
    `reviewLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16, borderBottomWidth: 1, borderBottomColor: '#e6ecf3', paddingVertical: 12 }, statusStrong: { color: '#16345f', fontWeight: '900', textAlign: 'right' },`,
    `reviewLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderBottomWidth: 1, borderBottomColor: '#e6ecf3', paddingVertical: 12 }, statusStrong: { color: '#16345f', fontWeight: '900', textAlign: 'right', flexShrink: 1, maxWidth: '65%' },`,
    'responsive settings rows',
  );

  write('PortfolioApp.js', source);

  let decision = read('DecisionOverlay.js');
  decision = replaceRequired(decision, "const VERSION = '1.2.2';", "const VERSION = '1.2.3';", 'Decision version');
  write('DecisionOverlay.js', decision);
}

function patchVersionFiles() {
  const appPath = path.join(root, 'app.json');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.expo.version = '1.2.3';
  app.expo.android.versionCode = 26;
  app.expo.ios.buildNumber = '26';
  fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = '1.2.3';
  pkg.scripts = pkg.scripts || {};
  if (!String(pkg.scripts.postinstall || '').includes('apply-v123-actionable-plan.js')) {
    pkg.scripts.postinstall = `${String(pkg.scripts.postinstall || '').trim()} && node scripts/apply-v123-actionable-plan.js`.replace(/^\s*&&\s*/, '');
  }
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchDecisionCard();
patchPortfolioLayoutAndVersion();
patchVersionFiles();

const checks = {
  'src/FinalDecisionCard.js': ['ΠΛΑΝΟ ΤΩΡΑ — ΠΕΡΙΟΡΙΣΜΕΝΑ ΔΕΔΟΜΕΝΑ', 'controlledPlan', 'Δεν αποτελεί τελικό BUY/SELL σήμα'],
  'PortfolioApp.js': ["const VERSION = '1.2.3';", 'positionHeader', "maxWidth: '65%'"],
  'DecisionOverlay.js': ["const VERSION = '1.2.3';"],
};
for (const [file, invariants] of Object.entries(checks)) {
  const source = read(file);
  for (const invariant of invariants) {
    if (!source.includes(invariant)) throw new Error(`v1.2.3 verification failed: ${file} missing ${invariant}`);
  }
}

const app = JSON.parse(read('app.json'));
const pkg = JSON.parse(read('package.json'));
if (app.expo.version !== '1.2.3' || app.expo.android.versionCode !== 26 || app.expo.ios.buildNumber !== '26') throw new Error('v1.2.3 release identity mismatch');
if (pkg.version !== '1.2.3' || !String(pkg.scripts?.postinstall || '').includes('apply-v123-actionable-plan.js')) throw new Error('v1.2.3 package identity mismatch');
console.log('Investor Control v1.2.3 actionable plan and mobile layout hardening applied.');
