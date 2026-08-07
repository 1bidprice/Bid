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
  let source = read('src/FinalDecisionCard.js');

  source = replaceRequired(
    source,
    `  const finalAction = item?.finalAction || null;
  const personalized = useMemo(() => {
    if (!finalAction || finalAction.status !== 'FINAL') return null;
    const code = hasPosition ? finalAction.holderAction : finalAction.nonHolderAction;
    return { code, label: actionLabel(code, finalAction), tone: tone(code) };
  }, [finalAction, hasPosition]);`,
    `  const finalAction = item?.finalAction || null;
  const controlledPlan = finalAction?.controlledPlan?.status === 'AVAILABLE' ? finalAction.controlledPlan : null;
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
  }, [finalAction, controlledPlan, hasPosition]);`,
    'controlled-plan personalization',
  );

  source = replaceRequired(
    source,
    `<Text style={styles.eyebrow}>ΤΕΛΙΚΟ ΣΥΜΠΕΡΑΣΜΑ ΓΙΑ ΕΣΕΝΑ</Text>`,
    `<Text style={styles.eyebrow}>{personalized.interim ? 'ΠΛΑΝΟ ΤΩΡΑ — ΠΕΡΙΟΡΙΣΜΕΝΑ ΔΕΔΟΜΕΝΑ' : 'ΤΕΛΙΚΟ ΣΥΜΠΕΡΑΣΜΑ ΓΙΑ ΕΣΕΝΑ'}</Text>`,
    'interim plan eyebrow',
  );

  source = replaceRequired(
    source,
    `<Text style={styles.urgency}>{finalAction.urgencyLabel}</Text>`,
    `<Text style={styles.urgency}>{personalized.interim ? 'ΕΝΔΙΑΜΕΣΟ' : finalAction.urgencyLabel}</Text>`,
    'interim urgency label',
  );

  source = replaceRequired(
    source,
    `<View style={styles.metrics}>
        <View style={styles.metric}><Text style={styles.metricLabel}>Εμπιστοσύνη</Text><Text style={styles.metricValue}>{Math.round(Number(finalAction.confidenceScore || 0))}/100</Text></View>
        <View style={styles.metric}><Text style={styles.metricLabel}>Ποιότητα δεδομένων</Text><Text style={styles.metricValue}>{Math.round(Number(finalAction.dataQualityScore || 0))}/100</Text></View>
      </View>
      <Text style={styles.validity}>Ισχύει μέχρι: {when(finalAction.validUntil)} · Πολιτική {finalAction.policyVersion}</Text>
      <Text style={styles.execution}>Δεν εκτελείται εντολή σε χρηματιστηριακή. Η τελική πράξη παραμένει αποκλειστικά δική σου.</Text>`,
    `<View style={styles.metrics}>
        <View style={styles.metric}><Text style={styles.metricLabel}>Εμπιστοσύνη</Text><Text style={styles.metricValue}>{Math.round(Number(personalized.source?.confidenceScore || 0))}/100</Text></View>
        <View style={styles.metric}><Text style={styles.metricLabel}>Ποιότητα δεδομένων</Text><Text style={styles.metricValue}>{Math.round(Number(personalized.source?.dataQualityScore || 0))}/100</Text></View>
      </View>
      {personalized.interim ? <Text style={styles.planRationale}>{personalized.source?.rationale || 'Δεν έχουν ολοκληρωθεί όλοι οι έλεγχοι για τελική ενέργεια.'}</Text> : null}
      <Text style={styles.validity}>Ισχύει μέχρι: {when(personalized.source?.validUntil)}{personalized.interim ? ' · Δεν αποτελεί τελικό BUY/SELL σήμα' : ' · Πολιτική ' + finalAction.policyVersion}</Text>
      <Text style={styles.execution}>{personalized.interim ? 'Το πλάνο είναι συντηρητικός έλεγχος κινδύνου μέχρι να ολοκληρωθεί η τεκμηρίωση. Δεν εκτελείται καμία εντολή.' : 'Δεν εκτελείται εντολή σε χρηματιστηριακή. Η τελική πράξη παραμένει αποκλειστικά δική σου.'}</Text>`,
    'controlled-plan metrics and disclaimer',
  );

  source = replaceRequired(
    source,
    `  validity: { color: '#5f6f84', fontSize: 10, lineHeight: 15, marginTop: 11 },`,
    `  planRationale: { color: '#425873', fontSize: 11, lineHeight: 17, fontWeight: '700', marginTop: 11 },
  validity: { color: '#5f6f84', fontSize: 10, lineHeight: 15, marginTop: 11 },`,
    'controlled-plan rationale style',
  );

  write('src/FinalDecisionCard.js', source);
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
