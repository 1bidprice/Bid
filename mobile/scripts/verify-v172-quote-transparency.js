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
];
for (const invariant of requiredPortfolio) {
  if (!portfolio.includes(invariant)) throw new Error(`v1.7.2+ quote transparency missing Portfolio invariant: ${invariant}`);
}

if (portfolio.includes('<Text style={styles.muted}>Τρέχουσα τιμή</Text>')) {
  throw new Error('v1.7.2+ quote transparency failed: unconditional current-price label remains');
}

for (const invariant of [
  'Επίσημη τιμή αναφοράς με δηλωμένη καθυστέρηση',
  'Ο ακριβής χρόνος της τιμής δεν έχει επαληθευτεί.',
]) {
  if (!quoteContract.includes(invariant)) throw new Error(`v1.7.2+ quote contract invariant missing: ${invariant}`);
}

const versionParts = String(app.expo.version || '').split('.').map(Number);
const atLeast172 = versionParts.length === 3
  && (versionParts[0] > 1
    || (versionParts[0] === 1 && versionParts[1] > 7)
    || (versionParts[0] === 1 && versionParts[1] === 7 && versionParts[2] >= 2));
if (!atLeast172 || Number(app.expo.android.versionCode) < 30) throw new Error('app identity regressed below v1.7.2 build 30');
if (pkg.version !== app.expo.version) throw new Error('package/app version mismatch');
if (!portfolio.includes(`const VERSION = '${app.expo.version}';`)) throw new Error('PortfolioApp runtime version mismatch');
if (!decision.includes(`const VERSION = '${app.expo.version}';`)) throw new Error('DecisionOverlay runtime version mismatch');
if (!/MOBILE_QUOTE_CONTRACT_VERSION = '2026-08-(18|19|20|2[1-9]|3[01])\./.test(quoteContract)) {
  throw new Error('quote contract regressed below the v1.7.2 transparency contract');
}

console.log(`PASS v1.7.2+ quote timing transparency preserved on ${app.expo.version} build ${app.expo.android.versionCode}.`);
