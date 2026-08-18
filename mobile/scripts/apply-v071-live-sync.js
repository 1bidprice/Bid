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
  if (!content.includes(from)) throw new Error(`v0.7.1 patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchAppController() {
  let source = read('App.js');
  source = replaceRequired(source, "import React from 'react';", "import React, { useState } from 'react';", 'App useState import');
  source = replaceRequired(
    source,
    'export default function App() {\n  return (',
    "export default function App() {\n  const [decisionVisible, setDecisionVisible] = useState(false);\n  return (",
    'Decision Gate visibility state',
  );
  source = replaceRequired(
    source,
    '        <PortfolioApp />\n        <DecisionOverlay />',
    '        <PortfolioApp onOpenDecisionGate={() => setDecisionVisible(true)} />\n        <DecisionOverlay visible={decisionVisible} onRequestClose={() => setDecisionVisible(false)} />',
    'controlled Decision Gate wiring',
  );
  write('App.js', source);
}

function patchPortfolio() {
  let source = read('PortfolioApp.js');
  source = replaceRequired(source, "const VERSION = '0.7.0';", "const VERSION = '0.7.1';", 'Portfolio version');
  source = replaceRequired(source, 'function MainApp() {', 'function MainApp({ onOpenDecisionGate }) {', 'MainApp Decision Gate prop');
  source = replaceRequired(
    source,
    "          {!valuesReady ? <Text style={styles.warning}>Η συνολική αποτίμηση μένει κενή όταν κάποια τιμή είναι παρωχημένη ή μη διαθέσιμη.</Text> : null}\n          <View style={styles.quickActions}>",
    "          {!valuesReady ? <Text style={styles.warning}>Η συνολική αποτίμηση μένει κενή όταν κάποια τιμή είναι παρωχημένη ή μη διαθέσιμη.</Text> : null}\n          <Pressable style={styles.decisionEntry} onPress={onOpenDecisionGate} accessibilityLabel=\"Άνοιγμα Decision Gate\">\n            <View style={styles.decisionEntryIcon}><Text style={styles.decisionEntryCheck}>✓</Text></View>\n            <View style={styles.grow}><Text style={styles.decisionEntryTitle}>Decision Gate</Text><Text style={styles.decisionEntryText}>Έλεγχος πειθαρχίας πριν από αγορά ή ενίσχυση θέσης</Text></View>\n            <Text style={styles.decisionEntryArrow}>›</Text>\n          </Pressable>\n          <View style={styles.quickActions}>",
    'Decision Gate summary entry',
  );
  source = replaceRequired(
    source,
    'export default function PortfolioApp() {\n  return <SafeAreaProvider initialMetrics={initialWindowMetrics}><MainApp /></SafeAreaProvider>;\n}',
    'export default function PortfolioApp({ onOpenDecisionGate }) {\n  return <SafeAreaProvider initialMetrics={initialWindowMetrics}><MainApp onOpenDecisionGate={onOpenDecisionGate} /></SafeAreaProvider>;\n}',
    'PortfolioApp Decision Gate prop forwarding',
  );
  source = replaceRequired(
    source,
    "  warning: { color: '#a66700', backgroundColor: '#fff6df', borderRadius: 14, padding: 12, marginTop: 12, lineHeight: 21, fontWeight: '700' }, quickActions:",
    "  warning: { color: '#a66700', backgroundColor: '#fff6df', borderRadius: 14, padding: 12, marginTop: 12, lineHeight: 21, fontWeight: '700' }, decisionEntry: { minHeight: 76, borderRadius: 21, backgroundColor: '#07163E', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 12, marginTop: 16 }, decisionEntryIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: '#0B66FF', alignItems: 'center', justifyContent: 'center' }, decisionEntryCheck: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '900' }, decisionEntryTitle: { color: '#fff', fontSize: 17, fontWeight: '900' }, decisionEntryText: { color: '#b8c9e8', fontSize: 12, lineHeight: 17, marginTop: 2 }, decisionEntryArrow: { color: '#8eb8ff', fontSize: 34, lineHeight: 36, fontWeight: '500' }, quickActions:",
    'Decision Gate entry styles',
  );
  write('PortfolioApp.js', source);
}

function patchDecisionOverlay() {
  let source = read('DecisionOverlay.js');
  source = replaceRequired(
    source,
    "import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';",
    "import { SafeAreaView } from 'react-native-safe-area-context';",
    'DecisionOverlay safe-area import',
  );
  source = replaceRequired(source, "const VERSION = '0.7.0';", "const VERSION = '0.7.1';", 'DecisionOverlay version');
  source = replaceRequired(
    source,
    'export default function DecisionOverlay() {\n  const insets = useSafeAreaInsets();\n  const [visible, setVisible] = useState(false);',
    'export default function DecisionOverlay({ visible = false, onRequestClose }) {',
    'controlled DecisionOverlay signature',
  );
  source = replaceRequired(
    source,
    "  const open = async () => {\n    await load();\n    setScreen('list');\n    setSelectedSymbol(null);\n    setVisible(true);\n  };\n\n  const close = () => {\n    setVisible(false);\n    setScreen('list');\n    setSelectedSymbol(null);\n  };",
    "  useEffect(() => {\n    if (!visible) return;\n    load();\n    setScreen('list');\n    setSelectedSymbol(null);\n  }, [visible, load]);\n\n  const close = () => {\n    onRequestClose?.();\n    setScreen('list');\n    setSelectedSymbol(null);\n  };",
    'controlled DecisionOverlay lifecycle',
  );
  source = replaceRequired(
    source,
    "    <>\n      <Pressable style={[styles.fab, { right: 14 + insets.right, bottom: 92 + insets.bottom }]} onPress={open} accessibilityLabel=\"Άνοιγμα Decision Gate\" accessibilityHint=\"Έλεγχος επενδυτικής απόφασης\">\n        <Text style={styles.fabTop}>✓</Text>\n      </Pressable>\n\n      <Modal",
    "    <>\n      <Modal",
    'floating Decision Gate removal',
  );
  if (source.includes('useSafeAreaInsets') || source.includes('styles.fab, { right:')) {
    throw new Error('v0.7.1 patch failed: floating Decision Gate remains');
  }
  write('DecisionOverlay.js', source);
}

function patchVersions() {
  const appJsonPath = path.join(root, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  appJson.expo.version = '0.7.1';
  appJson.expo.android.versionCode = 15;
  appJson.expo.ios.buildNumber = '15';
  fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  packageJson.version = '0.7.1';
  packageJson.scripts = packageJson.scripts || {};
  packageJson.scripts.postinstall = 'node scripts/apply-v065-native-ui-fix.js && node scripts/apply-v070-opportunities.js && node scripts/apply-v071-live-sync.js';
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

patchAppController();
patchPortfolio();
patchDecisionOverlay();
patchVersions();

const app = read('App.js');
const portfolio = read('PortfolioApp.js');
const decision = read('DecisionOverlay.js');
if (!app.includes('decisionVisible')) throw new Error('v0.7.1 verification failed: App controller missing');
if (!portfolio.includes('styles.decisionEntry')) throw new Error('v0.7.1 verification failed: Decision Gate entry missing');
if (!decision.includes('onRequestClose?.()')) throw new Error('v0.7.1 verification failed: controlled close missing');
if (decision.includes('useSafeAreaInsets')) throw new Error('v0.7.1 verification failed: floating inset hook remains');
console.log('Investor Control v0.7.1 live-sync and Decision Gate patch applied.');
