const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const VERSION = '1.7.2';
const VERSION_CODE = 30;
const QUOTE_CONTRACT_VERSION = '2026-08-18.1';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`Investor Control v1.7.2 quote-transparency patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchQuoteContract() {
  let source = read('src/quote-contract.js');
  source = replaceRequired(
    source,
    "export const MOBILE_QUOTE_CONTRACT_VERSION = '2026-08-04.2';",
    `export const MOBILE_QUOTE_CONTRACT_VERSION = '${QUOTE_CONTRACT_VERSION}';`,
    'quote contract version',
  );
  source = replaceRequired(
    source,
    "  if (status === 'TIMESTAMP_NOT_VERIFIED') return 'Ο χρόνος της τιμής δεν έχει επιβεβαιωθεί επαρκώς.';",
    "  if (status === 'TIMESTAMP_NOT_VERIFIED') {\n    const delay = Number(quote.advertisedDelayMinutes || 0);\n    return delay > 0\n      ? `Επίσημη τιμή αναφοράς με δηλωμένη καθυστέρηση ${delay}′. Ο ακριβής χρόνος της τιμής δεν έχει επαληθευτεί.`\n      : 'Τιμή αναφοράς από εγκεκριμένη πηγή, αλλά ο ακριβής χρόνος της τιμής δεν έχει επαληθευτεί.';\n  }",
    'timestamp-not-verified public message',
  );
  write('src/quote-contract.js', source);
}

function patchPortfolioPresentation() {
  let source = read('PortfolioApp.js');

  if (!source.includes('function quoteHeadlineLabel(quote)')) {
    source = replaceRequired(
      source,
      'function PositionCard({ item, compact, expanded, onToggle, onAlert }) {',
      `function quoteHeadlineLabel(quote) {\n  const contractStatus = quote?.quoteContract?.publicStatus;\n  const delay = Number(quote?.advertisedDelayMinutes || 0);\n  if (contractStatus === 'TIMESTAMP_NOT_VERIFIED') {\n    return delay > 0 ? \`Τιμή αναφοράς · καθυστέρηση ≥\${delay}′\` : 'Τιμή αναφοράς · χρόνος μη επιβεβαιωμένος';\n  }\n  if (contractStatus === 'FALLBACK_NOT_VERIFIED') return 'Ενδεικτική τιμή · μη επιβεβαιωμένη';\n  if (contractStatus === 'STALE' || quote?.status === 'stale' || quote?.usable === false) return 'Τιμή αναφοράς · παρωχημένη';\n  if (quote?.status === 'closed') return 'Τιμή κλεισίματος';\n  if (quote?.status === 'delayed') return delay > 0 ? \`Τιμή αναφοράς · καθυστέρηση ≥\${delay}′\` : 'Τιμή αναφοράς · καθυστερημένη';\n  return 'Τρέχουσα τιμή';\n}\n\nfunction PositionCard({ item, compact, expanded, onToggle, onAlert }) {`,
      'quote headline helper',
    );
  }

  source = replaceRequired(
    source,
    '<Text style={styles.muted}>Τρέχουσα τιμή</Text>',
    '<Text style={styles.muted}>{quoteHeadlineLabel(item.quote)}</Text>',
    'dynamic quote headline',
  );

  source = replaceRequired(
    source,
    "            <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.64}>{stale ? '—' : quotePrice(item.nativePrice, item.currency)}</Text>",
    "            <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.64}>{stale ? '—' : quotePrice(item.nativePrice, item.currency)}</Text>\n            {item.quote?.quoteContract?.timestampVerified === false ? <Text style={styles.quoteHeadlineWarning}>Ο ακριβής χρόνος αυτής της τιμής δεν είναι επαληθευμένος.</Text> : null}",
    'visible unverified timestamp warning',
  );

  source = replaceRequired(
    source,
    "quoteTransparencyWarning: { color: '#9a6500', fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 5 }, quoteContractText:",
    "quoteTransparencyWarning: { color: '#9a6500', fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 5 }, quoteHeadlineWarning: { color: '#9a6500', fontSize: 9, lineHeight: 13, fontWeight: '800', marginTop: 3 }, quoteContractText:",
    'quote headline warning style',
  );

  source = source.replace("const VERSION = '1.7.1';", `const VERSION = '${VERSION}';`);
  write('PortfolioApp.js', source);

  let decision = read('DecisionOverlay.js');
  decision = decision.replace("const VERSION = '1.7.1';", `const VERSION = '${VERSION}';`);
  write('DecisionOverlay.js', decision);
}

function patchVersions() {
  const appPath = path.join(root, 'app.json');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.expo = app.expo || {};
  app.expo.android = app.expo.android || {};
  app.expo.ios = app.expo.ios || {};
  app.expo.version = VERSION;
  app.expo.android.versionCode = VERSION_CODE;
  app.expo.ios.buildNumber = String(VERSION_CODE);
  fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = VERSION;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchQuoteContract();
patchPortfolioPresentation();
patchVersions();

const portfolio = read('PortfolioApp.js');
const decision = read('DecisionOverlay.js');
const quoteContract = read('src/quote-contract.js');
const app = JSON.parse(read('app.json'));
const pkg = JSON.parse(read('package.json'));

if (!portfolio.includes('function quoteHeadlineLabel(quote)')) throw new Error('v1.7.2 verification failed: quote headline helper missing');
if (!portfolio.includes('{quoteHeadlineLabel(item.quote)}')) throw new Error('v1.7.2 verification failed: dynamic quote headline missing');
if (!portfolio.includes('Ο ακριβής χρόνος αυτής της τιμής δεν είναι επαληθευμένος.')) throw new Error('v1.7.2 verification failed: visible timestamp warning missing');
if (!quoteContract.includes(`MOBILE_QUOTE_CONTRACT_VERSION = '${QUOTE_CONTRACT_VERSION}'`)) throw new Error('v1.7.2 verification failed: quote contract version missing');
if (!quoteContract.includes('Επίσημη τιμή αναφοράς με δηλωμένη καθυστέρηση')) throw new Error('v1.7.2 verification failed: delayed quote disclosure missing');
if (!portfolio.includes(`const VERSION = '${VERSION}';`) || !decision.includes(`const VERSION = '${VERSION}';`)) throw new Error('v1.7.2 verification failed: runtime version mismatch');
if (app.expo.version !== VERSION || app.expo.android.versionCode !== VERSION_CODE) throw new Error('v1.7.2 verification failed: app identity mismatch');
if (pkg.version !== VERSION) throw new Error('v1.7.2 verification failed: package identity mismatch');

console.log(`Investor Control mobile ${VERSION} build ${VERSION_CODE}: quote timing transparency applied.`);
