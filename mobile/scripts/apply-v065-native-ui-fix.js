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
  if (!content.includes(from)) {
    throw new Error(`v0.6.5 patch failed: missing ${label}`);
  }
  return content.replace(from, to);
}

function patchDecisionOverlay() {
  let source = read('DecisionOverlay.js');

  // SafeAreaView must come only from react-native-safe-area-context. The old
  // core React Native import does not apply Android insets reliably.
  source = source.replace(/^  SafeAreaView,\r?\n/gm, '');

  source = replaceRequired(
    source,
    "import AsyncStorage from '@react-native-async-storage/async-storage';\n",
    "import AsyncStorage from '@react-native-async-storage/async-storage';\nimport { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';\n",
    'safe-area-context import',
  );

  source = replaceRequired(source, "const VERSION = '0.6.4';", "const VERSION = '0.6.5';", 'DecisionOverlay version');

  source = replaceRequired(
    source,
    'export default function DecisionOverlay() {\n  const [visible, setVisible] = useState(false);',
    'export default function DecisionOverlay() {\n  const insets = useSafeAreaInsets();\n  const [visible, setVisible] = useState(false);',
    'DecisionOverlay inset hook',
  );

  source = replaceRequired(
    source,
    '<Pressable style={styles.fab} onPress={open}',
    '<Pressable style={[styles.fab, { right: 14 + insets.right, bottom: 92 + insets.bottom }]} onPress={open}',
    'Decision Gate floating button position',
  );

  source = replaceRequired(
    source,
    '<SafeAreaView style={styles.safe}>',
    "<SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>",
    'Decision Gate modal safe-area edges',
  );

  source = replaceRequired(source, 'right: 14, bottom: 90,', 'right: 14, bottom: 92,', 'Decision Gate fallback bottom offset');

  if (/^  SafeAreaView,\r?$/m.test(source)) {
    throw new Error('v0.6.5 patch failed: core SafeAreaView import remains');
  }
  if (!source.includes("import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';")) {
    throw new Error('v0.6.5 patch failed: safe-area-context import missing');
  }

  write('DecisionOverlay.js', source);
}

function patchAppProvider() {
  let source = read('App.js');

  source = replaceRequired(
    source,
    "import { StyleSheet, View } from 'react-native';\n",
    "import { StyleSheet, View } from 'react-native';\nimport { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';\n",
    'root SafeAreaProvider import',
  );

  source = replaceRequired(
    source,
    "  return (\n    <View style={styles.root}>\n      <PortfolioApp />\n      <DecisionOverlay />\n    </View>\n  );",
    "  return (\n    <SafeAreaProvider initialMetrics={initialWindowMetrics}>\n      <View style={styles.root}>\n        <PortfolioApp />\n        <DecisionOverlay />\n      </View>\n    </SafeAreaProvider>\n  );",
    'root SafeAreaProvider wrapper',
  );

  write('App.js', source);
}

function patchPortfolioVersion() {
  let source = read('PortfolioApp.js');
  source = replaceRequired(source, "const VERSION = '0.6.4';", "const VERSION = '0.6.5';", 'PortfolioApp version');
  write('PortfolioApp.js', source);
}

function patchJsonFiles() {
  const appJsonPath = path.join(root, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  appJson.expo.version = '0.6.5';
  appJson.expo.android.versionCode = 13;
  appJson.expo.ios.buildNumber = '13';
  fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  packageJson.version = '0.6.5';
  packageJson.scripts = packageJson.scripts || {};
  packageJson.scripts.postinstall = 'node scripts/apply-v065-native-ui-fix.js';
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

patchDecisionOverlay();
patchAppProvider();
patchPortfolioVersion();
patchJsonFiles();

console.log('Investor Control v0.6.5 native safe-area patch applied.');
