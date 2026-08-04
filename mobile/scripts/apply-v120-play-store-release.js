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
  if (!content.includes(from)) throw new Error(`v1.2.0 Play release patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchPortfolio() {
  let source = read('PortfolioApp.js');

  source = replaceRequired(
    source,
    '  KeyboardAvoidingView,\n  Modal,',
    '  KeyboardAvoidingView,\n  Linking,\n  Modal,',
    'Linking import',
  );

  source = replaceRequired(
    source,
    "const VERSION = '1.1.0';",
    "const VERSION = '1.2.0';\nconst PRIVACY_POLICY_URL = 'https://1bidprice.github.io/Bid/privacy-policy.html';\nconst TERMS_URL = 'https://1bidprice.github.io/Bid/terms.html';\nconst SUPPORT_EMAIL = 'xrimapp@gmail.com';\nconst LEGAL_ACCEPTANCE_KEY = 'investor-control.legal-acceptance.v1';",
    'release constants',
  );

  if (!source.includes('function LegalNoticeModal(')) {
    source = replaceRequired(
      source,
      'function MainApp({ onOpenDecisionGate }) {',
      `function LegalNoticeModal({ visible, onAccept }) {
  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={() => {}}>
      <SafeAreaView style={styles.legalScreen} edges={['top', 'bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.legalContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.eyebrow}>INVESTOR CONTROL</Text>
          <Text style={styles.legalTitle}>Σημαντική ενημέρωση πριν τη χρήση</Text>
          <Text style={styles.legalBody}>Η εφαρμογή είναι εργαλείο προσωπικής καταγραφής χαρτοφυλακίου και αυτοματοποιημένης επενδυτικής έρευνας. Δεν είναι χρηματιστηριακή εταιρεία, δεν κρατά χρήματα και δεν στέλνει εντολές αγοράς ή πώλησης σε broker.</Text>
          <Text style={styles.legalBody}>Οι ενδείξεις ΑΓΟΡΑ, ΠΩΛΗΣΗ, ΚΡΑΤΗΣΕ ή ΑΠΟΦΥΓΕ βασίζονται σε αυτοματοποιημένους κανόνες και διαθέσιμα δεδομένα. Μπορεί να είναι ελλιπείς, καθυστερημένες ή λανθασμένες. Δεν αποτελούν εγγύηση απόδοσης ούτε εξατομικευμένη επενδυτική συμβουλή.</Text>
          <Text style={styles.legalBody}>Οι συναλλαγές, ποσότητες, κόστη και σημειώσεις αποθηκεύονται τοπικά στη συσκευή. Για ανάκτηση τιμών μπορεί να αποστέλλεται σε παρόχους μόνο το χρηματιστηριακό σύμβολο. Δεν αποστέλλονται ποσότητες, κόστος κτήσης ή προσωπικές σημειώσεις.</Text>
          <View style={styles.legalLinks}>
            <Pressable style={styles.secondaryActionFull} onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}><Text style={styles.secondaryStrong}>Πολιτική απορρήτου</Text></Pressable>
            <Pressable style={styles.secondaryActionFull} onPress={() => Linking.openURL(TERMS_URL)}><Text style={styles.secondaryStrong}>Όροι χρήσης</Text></Pressable>
          </View>
          <Pressable style={styles.primary} onPress={onAccept}><Text style={styles.whiteStrong}>Κατανόησα και συνεχίζω</Text></Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function MainApp({ onOpenDecisionGate }) {`,
      'legal notice component',
    );
  }

  source = replaceRequired(
    source,
    "  const [backgroundRegistered, setBackgroundRegistered] = useState(false);\n  const tokenRef = useRef('');",
    "  const [backgroundRegistered, setBackgroundRegistered] = useState(false);\n  const [legalAccepted, setLegalAccepted] = useState(null);\n  const tokenRef = useRef('');",
    'legal acceptance state',
  );

  if (!source.includes("AsyncStorage.getItem(LEGAL_ACCEPTANCE_KEY)")) {
    source = replaceRequired(
      source,
      "  const appState = useRef(AppState.currentState);\n\n  const persist = useCallback",
      "  const appState = useRef(AppState.currentState);\n\n  useEffect(() => {\n    AsyncStorage.getItem(LEGAL_ACCEPTANCE_KEY)\n      .then((value) => setLegalAccepted(value === 'accepted'))\n      .catch(() => setLegalAccepted(false));\n  }, []);\n\n  const acceptLegalNotice = useCallback(async () => {\n    await AsyncStorage.setItem(LEGAL_ACCEPTANCE_KEY, 'accepted');\n    setLegalAccepted(true);\n  }, []);\n\n  const persist = useCallback",
      'legal acceptance persistence',
    );
  }

  source = replaceRequired(
    source,
    "  if (loading) return <SafeAreaView style={styles.center}",
    "  if (loading || legalAccepted === null) return <SafeAreaView style={styles.center}",
    'legal loading gate',
  );

  source = replaceRequired(
    source,
    "    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}><StatusBar",
    "    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}><LegalNoticeModal visible={!legalAccepted} onAccept={acceptLegalNotice} /><StatusBar",
    'legal modal mounting',
  );

  const oldSourceCard = '<View style={styles.card}><Text style={styles.cardTitle}>Πηγές τιμών</Text><Text style={styles.note}>Allwyn: επίσημη Euronext Athens με καθυστέρηση. Αμερικανικές μετοχές: Finnhub real-time με προσωπικό token, διαφορετικά εφεδρική πηγή.</Text><Field label="Finnhub API token" value={token} onChangeText={setToken} autoCapitalize="none" placeholder="Επικόλλησε το προσωπικό token" /><Pressable style={styles.primary} onPress={saveToken}><Text style={styles.whiteStrong}>Αποθήκευση token</Text></Pressable></View>';
  const newSourceCard = '<View style={styles.card}><Text style={styles.cardTitle}>Διαχειριζόμενες πηγές δεδομένων</Text><Text style={styles.note}>Οι εγκεκριμένες τιμές και η έρευνα ενημερώνονται από την κεντρική ροή της εφαρμογής. Δεν απαιτείται προσωπικό API token. Εφεδρικές ή μη επαληθευμένες τιμές εμφανίζονται μόνο πληροφοριακά και δεν ενεργοποιούν τελική απόφαση ή ειδοποίηση.</Text><ReviewLine label="Επίσημες ελληνικές πηγές" value="Euronext Athens" /><ReviewLine label="Αμερικανικά δεδομένα" value="Αδειοδοτημένος πάροχος / SEC" /><ReviewLine label="Προσωπικό API token" value="Δεν απαιτείται" /><Text style={styles.privacyNotice}>Για την ανάκτηση τιμής μπορεί να αποστέλλεται στον πάροχο μόνο το σύμβολο της μετοχής. Ποσότητες, κόστος, κέρδος/ζημία και σημειώσεις δεν αποστέλλονται.</Text></View>';
  source = replaceRequired(source, oldSourceCard, newSourceCard, 'managed data source card');

  const oldLocalCard = '<View style={styles.card}><Text style={styles.cardTitle}>Τοπικά δεδομένα</Text><Text style={styles.note}>Η διαγραφή αφορά μόνο αυτή τη συσκευή και δεν αναιρείται.</Text><Pressable style={styles.dangerActionFull} onPress={resetLocalData}><Text style={styles.dangerStrong}>Διαγραφή όλων των τοπικών δεδομένων</Text></Pressable></View>';
  const newLocalCard = '<View style={styles.card}><Text style={styles.cardTitle}>Νομικά και υποστήριξη</Text><Text style={styles.note}>Η εφαρμογή δεν εκτελεί συναλλαγές και δεν εγγυάται απόδοση. Κάθε επενδυτική απόφαση και η εκτέλεσή της παραμένει αποκλειστικά στον χρήστη.</Text><Pressable style={styles.secondaryActionFull} onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}><Text style={styles.secondaryStrong}>Πολιτική απορρήτου</Text></Pressable><Pressable style={styles.secondaryActionFull} onPress={() => Linking.openURL(TERMS_URL)}><Text style={styles.secondaryStrong}>Όροι χρήσης</Text></Pressable><Pressable style={styles.secondaryActionFull} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Investor%20Control%20Support`)}><Text style={styles.secondaryStrong}>Επικοινωνία υποστήριξης</Text></Pressable></View><View style={styles.card}><Text style={styles.cardTitle}>Τοπικά δεδομένα</Text><Text style={styles.note}>Η διαγραφή αφορά μόνο αυτή τη συσκευή και δεν αναιρείται. Η αποδοχή της νομικής ενημέρωσης διατηρείται χωριστά για λόγους διαφάνειας.</Text><Pressable style={styles.dangerActionFull} onPress={resetLocalData}><Text style={styles.dangerStrong}>Διαγραφή όλων των τοπικών δεδομένων</Text></Pressable></View>';
  source = replaceRequired(source, oldLocalCard, newLocalCard, 'legal and support settings');

  source = replaceRequired(
    source,
    "  safe: { flex: 1, backgroundColor: '#eef5ff' }, app:",
    "  legalScreen: { flex: 1, backgroundColor: '#eef5ff' }, legalContent: { paddingHorizontal: 22, paddingTop: 28, paddingBottom: 48 }, legalTitle: { color: '#16345f', fontSize: 31, lineHeight: 38, fontWeight: '900', marginBottom: 18 }, legalBody: { color: '#40536f', fontSize: 16, lineHeight: 25, marginBottom: 14 }, legalLinks: { marginTop: 4 }, privacyNotice: { color: '#40536f', fontSize: 13, lineHeight: 20, fontWeight: '700', marginTop: 14 },\n  safe: { flex: 1, backgroundColor: '#eef5ff' }, app:",
    'legal styles',
  );

  write('PortfolioApp.js', source);

  let decision = read('DecisionOverlay.js');
  decision = decision.replace("const VERSION = '1.1.0';", "const VERSION = '1.2.0';");
  write('DecisionOverlay.js', decision);
}

function patchAppConfig() {
  const appPath = path.join(root, 'app.json');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.expo.version = '1.2.0';
  app.expo.description = 'Προσωπικό χαρτοφυλάκιο και ελεγχόμενη αυτοματοποιημένη επενδυτική έρευνα, χωρίς εκτέλεση χρηματιστηριακών εντολών.';
  app.expo.primaryColor = '#0B66FF';
  app.expo.plugins = Array.isArray(app.expo.plugins) ? app.expo.plugins : [];
  const existingPlugin = app.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
  const androidBuildProperties = {
    ...(existingPlugin?.[1]?.android || {}),
    compileSdkVersion: 36,
    targetSdkVersion: 36,
    buildToolsVersion: '36.0.0',
    usesCleartextTraffic: false,
  };
  if (existingPlugin) {
    existingPlugin[1] = { ...(existingPlugin[1] || {}), android: androidBuildProperties };
  } else {
    app.expo.plugins.push(['expo-build-properties', { android: androidBuildProperties }]);
  }
  app.expo.android = app.expo.android || {};
  app.expo.android.package = 'gr.investorcontrol.app';
  app.expo.android.versionCode = 23;
  app.expo.android.allowBackup = false;
  delete app.expo.android.usesCleartextTraffic;
  app.expo.android.blockedPermissions = [
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.READ_CONTACTS',
    'android.permission.WRITE_CONTACTS',
    'android.permission.READ_PHONE_STATE',
    'android.permission.CALL_PHONE',
    'android.permission.READ_SMS',
    'android.permission.SEND_SMS',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
  ];
  app.expo.ios = app.expo.ios || {};
  app.expo.ios.buildNumber = '23';
  fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);
}

function patchPackage() {
  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = '1.2.0';
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies['expo-build-properties'] = '~55.0.16';
  pkg.scripts = pkg.scripts || {};
  if (!String(pkg.scripts.postinstall || '').includes('apply-v120-play-store-release.js')) {
    pkg.scripts.postinstall = `${String(pkg.scripts.postinstall || '').trim()} && node scripts/apply-v120-play-store-release.js`.replace(/^\s*&&\s*/, '');
  }
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchPortfolio();
patchAppConfig();
patchPackage();

const portfolio = read('PortfolioApp.js');
const app = JSON.parse(read('app.json'));
const pkg = JSON.parse(read('package.json'));
const buildPlugin = app.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
if (!portfolio.includes('Σημαντική ενημέρωση πριν τη χρήση')) throw new Error('legal notice missing');
if (!portfolio.includes('Δεν απαιτείται προσωπικό API token')) throw new Error('managed source disclosure missing');
if (!portfolio.includes('https://1bidprice.github.io/Bid/privacy-policy.html')) throw new Error('privacy policy URL missing');
if (app.expo.version !== '1.2.0' || app.expo.android.versionCode !== 23) throw new Error('release version mismatch');
if (app.expo.android.usesCleartextTraffic !== undefined) throw new Error('invalid top-level cleartext config remains');
if (buildPlugin?.[1]?.android?.usesCleartextTraffic !== false) throw new Error('cleartext build property missing');
if (!app.expo.android.blockedPermissions.includes('android.permission.CAMERA')) throw new Error('sensitive permission block missing');
if (pkg.version !== '1.2.0' || pkg.dependencies['expo-build-properties'] !== '~55.0.16') throw new Error('package release config mismatch');
console.log('Investor Control v1.2.0 Play Store release hardening applied.');
