const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const portfolio = read('PortfolioApp.js');
const decision = read('DecisionOverlay.js');
const quoteContract = read('src/quote-contract.js');
const app = JSON.parse(read('app.json'));
const pkg = JSON.parse(read('package.json'));

const requiredPortfolio = [
  'function quoteHeadlineLabel(quote)',
  "contractStatus === 'TIMESTAMP_NOT_VERIFIED'",
  'Τιμή αναφοράς · καθυστέρηση ≥',
  '{quoteHeadlineLabel(item.quote)}',
  'Ο ακριβής χρόνος αυτής της τιμής δεν είναι επαληθευμένος.',
  "const VERSION = '1.7.2';",
];
for (const invariant of requiredPortfolio) {
  if (!portfolio.includes(invariant)) throw new Error(`v1.7.2 quote transparency missing Portfolio invariant: ${invariant}`);
}

if (portfolio.includes('<Text style={styles.muted}>Τρέχουσα τιμή</Text>')) {
  throw new Error('v1.7.2 quote transparency failed: unconditional current-price label remains');
}

for (const invariant of [
  "MOBILE_QUOTE_CONTRACT_VERSION = '2026-08-18.1'",
  'Επίσημη τιμή αναφοράς με δηλωμένη καθυστέρηση',
  'Ο ακριβής χρόνος της τιμής δεν έχει επαληθευτεί.',
]) {
  if (!quoteContract.includes(invariant)) throw new Error(`v1.7.2 quote contract invariant missing: ${invariant}`);
}

if (!decision.includes("const VERSION = '1.7.2';")) throw new Error('DecisionOverlay version mismatch');
if (app.expo.version !== '1.7.2' || app.expo.android.versionCode !== 30) throw new Error('app identity mismatch');
if (pkg.version !== '1.7.2') throw new Error('package identity mismatch');

console.log('PASS v1.7.2 quote timing transparency, dynamic price label and release identity');
