const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.2.4 correction patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchDecisionEngine() {
  let source = read('src/decision-engine.js');
  if (!source.includes('export function samePositionSymbol')) {
    source = replaceRequired(
      source,
      "const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));",
      `const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function canonicalPositionSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\\.(GR|US)$/, '');
}

export function samePositionSymbol(left, right) {
  const a = canonicalPositionSymbol(left);
  const b = canonicalPositionSymbol(right);
  return Boolean(a && b && a === b);
}`,
      'canonical position-symbol helper',
    );
  }
  write('src/decision-engine.js', source);
}

function patchFinalDecisionCard() {
  let source = read('src/FinalDecisionCard.js');
  source = replaceRequired(
    source,
    "import { portfolioSnapshot } from './decision-engine';",
    "import { portfolioSnapshot, samePositionSymbol } from './decision-engine';",
    'samePositionSymbol import',
  );
  source = replaceRequired(
    source,
    "setHasPosition(snapshot.positions.some((position) => position.symbol === item?.symbol && Number(position.quantity) > 0));",
    "setHasPosition(snapshot.positions.some((position) => samePositionSymbol(position.symbol, item?.symbol) && Number(position.quantity) > 0));",
    'portfolio/research symbol matching',
  );
  source = replaceRequired(
    source,
    `  useEffect(() => {
    loadPosition();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') loadPosition();
    });
    return () => subscription.remove();
  }, [loadPosition]);`,
    `  useEffect(() => {
    loadPosition();
    const interval = setInterval(loadPosition, 15000);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') loadPosition();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [loadPosition]);`,
    'local-position refresh loop',
  );
  source = replaceRequired(
    source,
    "{personalized.interim ? <Text style={styles.planRationale}>{personalized.source?.rationale || 'Δεν έχουν ολοκληρωθεί όλοι οι έλεγχοι για τελική ενέργεια.'}</Text> : null}",
    "{personalized.interim ? <Text style={styles.planRationale}>{hasPosition ? 'Υπάρχει ήδη θέση στο χαρτοφυλάκιο. Μέχρι να ολοκληρωθούν οι υποχρεωτικοί έλεγχοι, το πλάνο αφορά διατήρηση και επανεξέταση της υπάρχουσας θέσης χωρίς νέα ενίσχυση — όχι αυτόματη πώληση.' : 'Δεν υπάρχει θέση στο χαρτοφυλάκιο. Μέχρι να ολοκληρωθούν οι υποχρεωτικοί έλεγχοι, δεν εγκρίνεται νέα είσοδος.'}</Text> : null}",
    'position-aware interim rationale',
  );
  write('src/FinalDecisionCard.js', source);
}

function patchPortfolioFxClarity() {
  let source = read('PortfolioApp.js');
  source = replaceRequired(source, "const VERSION = '1.2.3';", "const VERSION = '1.2.4';", 'Portfolio version');
  source = replaceRequired(
    source,
    "  const positions = useMemo(() => positionsFrom(state), [state]);\n  const valuedPositions = positions.filter((position) => position.eurValue !== null && valid(position.eurCost));",
    "  const positions = useMemo(() => positionsFrom(state), [state]);\n  const hasForeignCurrency = positions.some((position) => position.currency !== 'EUR');\n  const valuedPositions = positions.filter((position) => position.eurValue !== null && valid(position.eurCost));",
    'foreign-currency summary state',
  );
  source = replaceRequired(
    source,
    "label={costsReady ? 'Καθαρό κόστος' : 'Επιβεβ. κόστος'}",
    "label={hasForeignCurrency ? 'Κόστος € · τρέχ. FX' : (costsReady ? 'Καθαρό κόστος' : 'Επιβεβ. κόστος')}",
    'EUR cost label',
  );
  source = replaceRequired(
    source,
    "label={valuesReady ? 'Κέρδος / Ζημία' : 'Επιβεβ. αποτέλεσμα'}",
    "label={hasForeignCurrency ? 'Αποτέλεσμα · χωρίς FX' : (valuesReady ? 'Κέρδος / Ζημία' : 'Επιβεβ. αποτέλεσμα')}",
    'EUR PnL label',
  );
  source = replaceRequired(
    source,
    "          {!valuesReady ? <Text style={styles.warning}>Μερική αποτίμηση {valuationCoverage}. Εξαιρούνται από την αξία και το αποτέλεσμα μόνο οι θέσεις χωρίς χρησιμοποιήσιμη τιμή ή ισοτιμία: {missingValuationSymbols.join(', ') || '—'}.</Text> : null}",
    "          {hasForeignCurrency ? <Text style={styles.quoteTransparencyText}>Σημείωση FX: για θέσεις σε USD, το ιστορικό κόστος μετατρέπεται σε € με την τρέχουσα ισοτιμία μόνο για συγκεντρωτική απεικόνιση. Το αποτέλεσμα σε € αφορά την απόδοση της μετοχής και δεν περιλαμβάνει πραγματικό συναλλαγματικό κέρδος/ζημία. Το native κόστος και P/L της θέσης παραμένουν τα λογιστικά ακριβή στοιχεία.</Text> : null}\n          {!valuesReady ? <Text style={styles.warning}>Μερική αποτίμηση {valuationCoverage}. Εξαιρούνται από την αξία και το αποτέλεσμα μόνο οι θέσεις χωρίς χρησιμοποιήσιμη τιμή ή ισοτιμία: {missingValuationSymbols.join(', ') || '—'}.</Text> : null}",
    'FX disclosure',
  );
  source = replaceRequired(
    source,
    "<Text style={styles.note}>Σε ευρώ: αξία ≈ {cash(item.eurValue)} · αποτέλεσμα ≈ {cash(item.eurPnl)}</Text>",
    "<Text style={styles.note}>Σε ευρώ με τρέχουσα FX: αξία ≈ {cash(item.eurValue)} · αποτέλεσμα μετοχής ≈ {cash(item.eurPnl)} (χωρίς συναλλαγματικό P/L)</Text>",
    'USD expanded-card FX disclosure',
  );
  write('PortfolioApp.js', source);
}

function patchDecisionGateLabels() {
  let source = read('DecisionOverlay.js');
  source = replaceRequired(source, "const VERSION = '1.2.3';", "const VERSION = '1.2.4';", 'DecisionOverlay version');
  source = replaceRequired(
    source,
    "newBuyLabel: blocked ? 'ΝΕΑ ΑΓΟΡΑ: ΟΧΙ' : caution ? 'ΝΕΑ ΑΓΟΡΑ: ΠΡΟΣΟΧΗ' : 'ΝΕΑ ΑΓΟΡΑ: ΝΑΙ',",
    "newBuyLabel: blocked ? 'ΕΝΙΣΧΥΣΗ: ΟΧΙ' : caution ? 'ΕΝΙΣΧΥΣΗ: ΠΡΟΣΟΧΗ' : 'ΕΝΙΣΧΥΣΗ: ΕΝΤΟΣ ΟΡΙΩΝ',",
    'existing-position decision badge',
  );
  source = source.replace('label="Νέες αγορές μπλοκαρισμένες"', 'label="Ενισχύσεις μπλοκαρισμένες"');
  write('DecisionOverlay.js', source);
}

function patchVersionFiles() {
  const appPath = path.join(root, 'app.json');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.expo.version = '1.2.4';
  app.expo.android.versionCode = 27;
  app.expo.ios.buildNumber = '27';
  fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = '1.2.4';
  pkg.scripts = pkg.scripts || {};
  const postinstall = String(pkg.scripts.postinstall || '').trim();
  if (!postinstall.includes('apply-v124-user-test-corrections.js')) {
    pkg.scripts.postinstall = `${postinstall}${postinstall ? ' && ' : ''}node scripts/apply-v124-user-test-corrections.js`;
  }
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchDecisionEngine();
patchFinalDecisionCard();
patchPortfolioFxClarity();
patchDecisionGateLabels();
patchVersionFiles();

const engine = read('src/decision-engine.js');
const finalCard = read('src/FinalDecisionCard.js');
const portfolio = read('PortfolioApp.js');
const decision = read('DecisionOverlay.js');
const app = JSON.parse(read('app.json'));
const pkg = JSON.parse(read('package.json'));

for (const invariant of ['canonicalPositionSymbol', 'samePositionSymbol']) {
  if (!engine.includes(invariant)) throw new Error(`v1.2.4 symbol verification failed: ${invariant}`);
}
for (const invariant of ['samePositionSymbol(position.symbol, item?.symbol)', 'clearInterval(interval)', 'Υπάρχει ήδη θέση στο χαρτοφυλάκιο']) {
  if (!finalCard.includes(invariant)) throw new Error(`v1.2.4 research-position verification failed: ${invariant}`);
}
for (const invariant of ["const VERSION = '1.2.4';", 'Κόστος € · τρέχ. FX', 'Αποτέλεσμα · χωρίς FX', 'Σημείωση FX:']) {
  if (!portfolio.includes(invariant)) throw new Error(`v1.2.4 FX verification failed: ${invariant}`);
}
for (const invariant of ["const VERSION = '1.2.4';", 'ΕΝΙΣΧΥΣΗ: ΟΧΙ', 'ΕΝΙΣΧΥΣΗ: ΕΝΤΟΣ ΟΡΙΩΝ']) {
  if (!decision.includes(invariant)) throw new Error(`v1.2.4 Decision Gate verification failed: ${invariant}`);
}
if (app.expo.version !== '1.2.4' || app.expo.android.versionCode !== 27 || app.expo.ios.buildNumber !== '27') throw new Error('v1.2.4 release identity mismatch');
if (pkg.version !== '1.2.4' || !String(pkg.scripts?.postinstall || '').includes('apply-v124-user-test-corrections.js')) throw new Error('v1.2.4 package identity mismatch');

const canonical = (value) => String(value || '').trim().toUpperCase().replace(/\.(GR|US)$/, '');
for (const [left, right] of [['SPCE.US', 'SPCE'], ['CREDIA.GR', 'CREDIA'], ['ALWN.GR', 'ALWN']]) {
  if (canonical(left) !== canonical(right)) throw new Error(`v1.2.4 symbol alias test failed: ${left} vs ${right}`);
}

console.log('Investor Control v1.2.4 user-test corrections applied: position identity, Decision Gate semantics and FX clarity.');
