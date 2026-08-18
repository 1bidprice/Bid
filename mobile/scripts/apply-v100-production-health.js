const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.0.0 Android production patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchFeedStore() {
  let source = read('src/intelligence-feed-store.js');
  source = replaceRequired(
    source,
    "    sourceSelection: payload.sourceSelection && typeof payload.sourceSelection === 'object' ? payload.sourceSelection : null,",
    "    sourceSelection: payload.sourceSelection && typeof payload.sourceSelection === 'object' ? payload.sourceSelection : null,\n    operationalHealth: payload.operationalHealth && typeof payload.operationalHealth === 'object' ? payload.operationalHealth : null,\n    sourceHealth: payload.sourceHealth && typeof payload.sourceHealth === 'object' ? payload.sourceHealth : null,",
    'operational health normalization',
  );
  write('src/intelligence-feed-store.js', source);
}

function patchOpportunities() {
  let source = read('src/OpportunitiesView.js');
  source = replaceRequired(
    source,
    '  const freshness = useMemo(() => intelligenceFeedFreshness(feed), [feed]);',
    "  const freshness = useMemo(() => intelligenceFeedFreshness(feed), [feed]);\n  const operationalHealth = feed?.operationalHealth || null;\n  const sourceHealth = feed?.sourceHealth || null;\n  const productionReady = operationalHealth?.status === 'OPERATIONAL' && freshness.state === 'fresh';",
    'production health state',
  );
  source = replaceRequired(
    source,
    "        <View style={styles.sourcePolicyBox}><Text style={styles.sourcePolicyTitle}>Ποιος επιλέγει τις πηγές;</Text><Text style={styles.sourcePolicyText}>Έκδοση πολιτικής: {feed?.sourceSelection?.version || '—'}. Οι πηγές επιλέγονται από κλειδωμένη πολιτική κώδικα και επιτρεπόμενη λίστα, όχι αυθαίρετα από το AI.</Text></View>",
    "        <View style={styles.sourcePolicyBox}><Text style={styles.sourcePolicyTitle}>Ποιος επιλέγει τις πηγές;</Text><Text style={styles.sourcePolicyText}>Έκδοση πολιτικής: {feed?.sourceSelection?.version || '—'}. Οι πηγές επιλέγονται από κλειδωμένη πολιτική κώδικα και επιτρεπόμενη λίστα, όχι αυθαίρετα από το AI.</Text></View>\n        <View style={[styles.productionHealth, productionReady ? styles.productionHealthGood : styles.productionHealthLimited]}>\n          <View style={styles.productionHealthTop}><View style={styles.grow}><Text style={styles.productionHealthEyebrow}>ΚΑΤΑΣΤΑΣΗ ΠΑΡΑΓΩΓΙΚΟΥ ΣΥΣΤΗΜΑΤΟΣ</Text><Text style={styles.productionHealthTitle}>{productionReady ? 'Πλήρης αυτοματοποιημένη λειτουργία' : 'Περιορισμένη λειτουργία — χωρίς αυθαίρετα σήματα'}</Text></View><View style={[styles.productionHealthBadge, productionReady && styles.productionHealthBadgeGood]}><Text style={[styles.productionHealthBadgeText, productionReady && styles.productionHealthBadgeTextGood]}>{productionReady ? 'OPERATIONAL' : 'DEGRADED'}</Text></View></View>\n          <Text style={styles.productionHealthText}>{productionReady ? 'Η ροή είναι πρόσφατη και οι βασικοί έλεγχοι δεδομένων λειτουργούν.' : 'Το σύστημα συνεχίζει να συλλέγει και να ελέγχει δεδομένα, αλλά δεν εγκρίνει αγορά ή πώληση όταν λείπει πηγή, ιστορικό, benchmark, θεμελιώδη ή διασταύρωση.'}</Text>\n          <View style={styles.productionMetrics}>\n            <View style={styles.productionMetric}><Text style={styles.productionMetricValue}>{sourceHealth?.marketSnapshotCount || 0}</Text><Text style={styles.productionMetricLabel}>Τρέχουσες τιμές</Text></View>\n            <View style={styles.productionMetric}><Text style={styles.productionMetricValue}>{sourceHealth?.readyHistoricalMarketMetricsCount || 0}/{sourceHealth?.historicalMarketMetricsCount || 0}</Text><Text style={styles.productionMetricLabel}>Έγκυρα ιστορικά</Text></View>\n            <View style={styles.productionMetric}><Text style={styles.productionMetricValue}>{sourceHealth?.fundamentalSnapshotCount || 0}</Text><Text style={styles.productionMetricLabel}>Θεμελιώδη</Text></View>\n          </View>\n          <Text style={styles.productionHealthMeta}>Τελευταία παραγωγή: {when(operationalHealth?.generatedAt || feed?.generatedAt)} · Διαγνωστικά: {sourceHealth?.diagnosticCount || 0}</Text>\n        </View>",
    'production health card',
  );
  source = source.replace(
    "sourcePolicyText: { color: '#62738a', fontSize: 11, lineHeight: 16, marginTop: 3 },",
    "sourcePolicyText: { color: '#62738a', fontSize: 11, lineHeight: 16, marginTop: 3 }, productionHealth: { borderRadius: 16, borderWidth: 1, padding: 12, marginTop: 11 }, productionHealthGood: { backgroundColor: '#eaf8f0', borderColor: '#9bd7b2' }, productionHealthLimited: { backgroundColor: '#fff7e5', borderColor: '#e8cf91' }, productionHealthTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, productionHealthEyebrow: { color: '#6d7b8f', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 }, productionHealthTitle: { color: '#16345f', fontSize: 14, lineHeight: 18, fontWeight: '900', marginTop: 3 }, productionHealthBadge: { borderRadius: 11, backgroundColor: '#fff0d2', paddingHorizontal: 8, paddingVertical: 5 }, productionHealthBadgeGood: { backgroundColor: '#d6f2e1' }, productionHealthBadgeText: { color: '#996600', fontSize: 8, fontWeight: '900' }, productionHealthBadgeTextGood: { color: '#147a4a' }, productionHealthText: { color: '#617187', fontSize: 11, lineHeight: 17, marginTop: 8 }, productionMetrics: { flexDirection: 'row', gap: 7, marginTop: 10 }, productionMetric: { flex: 1, backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: 11, padding: 8 }, productionMetricValue: { color: '#16345f', fontSize: 15, fontWeight: '900' }, productionMetricLabel: { color: '#718096', fontSize: 8, lineHeight: 11, marginTop: 2 }, productionHealthMeta: { color: '#7b889d', fontSize: 9, lineHeight: 13, marginTop: 8 },",
  );
  write('src/OpportunitiesView.js', source);
}

function patchFinalDecisionCard() {
  let source = read('src/FinalDecisionCard.js');
  if (!source.includes('function blockerLabel(code)')) {
    source = replaceRequired(
      source,
      'function tone(code) {',
      `function blockerLabel(code) {
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

function tone(code) {`,
      'final action blocker labels',
    );
  }
  source = replaceRequired(
    source,
    '  const finalAction = item?.finalAction || null;\n  const personalized = useMemo(() => {',
    "  const finalAction = item?.finalAction || null;\n  const blockers = Array.isArray(finalAction?.blockers) ? finalAction.blockers : [];\n  const personalized = useMemo(() => {",
    'blocked action state',
  );
  source = replaceRequired(
    source,
    "        <Text style={styles.blockedText}>Το σύστημα παραμένει σε παρακολούθηση μέχρι να περάσουν όλοι οι έλεγχοι πηγών, τιμών, θεμελιωδών, ρευστότητας και αντιφάσεων.</Text>",
    "        <Text style={styles.blockedText}>Δεν παράγεται αγορά ή πώληση μέχρι να περάσουν όλοι οι υποχρεωτικοί έλεγχοι.</Text>\n        {blockers.slice(0, 4).map((code) => <Text key={code} style={styles.blockedReason}>• {blockerLabel(code)}</Text>)}",
    'visible final blockers',
  );
  source = source.replace(
    "blockedText: { color: '#62738a', fontSize: 12, lineHeight: 18, marginTop: 5 },",
    "blockedText: { color: '#62738a', fontSize: 12, lineHeight: 18, marginTop: 5 }, blockedReason: { color: '#735f31', fontSize: 10, lineHeight: 15, marginTop: 4 },",
  );
  write('src/FinalDecisionCard.js', source);
}

function patchVersions() {
  let portfolio = read('PortfolioApp.js');
  portfolio = portfolio.replace("const VERSION = '0.9.1';", "const VERSION = '1.0.0';");
  write('PortfolioApp.js', portfolio);

  let decision = read('DecisionOverlay.js');
  decision = decision.replace("const VERSION = '0.9.1';", "const VERSION = '1.0.0';");
  write('DecisionOverlay.js', decision);

  const appPath = path.join(root, 'app.json');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.expo.version = '1.0.0';
  app.expo.android.versionCode = 20;
  app.expo.ios.buildNumber = '20';
  fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = '1.0.0';
  pkg.scripts = pkg.scripts || {};
  if (!String(pkg.scripts.postinstall || '').includes('apply-v100-production-health.js')) {
    pkg.scripts.postinstall = `${String(pkg.scripts.postinstall || '').trim()} && node scripts/apply-v100-production-health.js`.replace(/^\s*&&\s*/, '');
  }
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchFeedStore();
patchOpportunities();
patchFinalDecisionCard();
patchVersions();

const opportunities = read('src/OpportunitiesView.js');
const store = read('src/intelligence-feed-store.js');
const finalCard = read('src/FinalDecisionCard.js');
if (!opportunities.includes('ΚΑΤΑΣΤΑΣΗ ΠΑΡΑΓΩΓΙΚΟΥ ΣΥΣΤΗΜΑΤΟΣ')) throw new Error('v1.0.0 verification failed: production health UI');
if (!store.includes('operationalHealth')) throw new Error('v1.0.0 verification failed: operational health store');
if (!finalCard.includes('MARKET_HISTORY_NOT_CROSSCHECKED')) throw new Error('v1.0.0 verification failed: blocker transparency');
console.log('Investor Control Android v1.0.0 production health and consistency patch applied.');
