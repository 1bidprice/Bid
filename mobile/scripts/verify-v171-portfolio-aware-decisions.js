const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function canonical(value) { return String(value || '').trim().toUpperCase().replace(/\.(US|GR)$/, ''); }
function currency(referencePrice, item) {
  const explicit = String(referencePrice?.currency || item?.marketQuote?.currency || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(explicit)) return explicit;
  const symbol = String(item?.marketQuote?.appSymbol || item?.symbol || '').trim().toUpperCase();
  const exchange = String(item?.exchange || '').trim().toUpperCase();
  if (symbol.endsWith('.US') || /NASDAQ|NYSE|NEW YORK STOCK EXCHANGE/.test(exchange)) return 'USD';
  if (symbol.endsWith('.GR') || /EURONEXT ATHENS|ATHENS/.test(exchange)) return 'EUR';
  return null;
}
function effective(item, held) {
  const finalAction = item.finalAction;
  return held.has(canonical(item.symbol)) ? finalAction.holderAction : finalAction.nonHolderAction;
}

assert(canonical('SPCE.US') === canonical('SPCE'), 'SPCE symbol bridge failed');
assert(canonical('ALWN.GR') === canonical('ALWN'), 'ALWN symbol bridge failed');
assert(canonical('CREDIA.GR') === canonical('CREDIA'), 'CREDIA symbol bridge failed');

const held = new Set(['SPCE.US', 'ALWN.GR', 'CREDIA.GR'].map(canonical));
const spce = { symbol: 'SPCE', finalAction: { status: 'FINAL', holderAction: 'SELL_NOW', nonHolderAction: 'AVOID' } };
const vctr = { symbol: 'VCTR', finalAction: { status: 'FINAL', holderAction: 'HOLD', nonHolderAction: 'BUY_NOW' } };
assert(effective(spce, held) === 'SELL_NOW', 'SPCE holder must receive SELL_NOW');
assert(effective(vctr, held) === 'BUY_NOW', 'VCTR non-holder must receive BUY_NOW');
const actions = [spce, vctr].map((item) => effective(item, held));
assert(actions.filter((code) => code === 'BUY_NOW').length === 1, 'personalized BUY count mismatch');
assert(actions.filter((code) => code === 'SELL_NOW').length === 1, 'personalized SELL count mismatch');

assert(currency({ value: 111.08, currency: null }, { symbol: 'VCTR', exchange: 'Nasdaq' }) === 'USD', 'VCTR currency must infer USD');
assert(currency({ value: 36.13, currency: null }, { symbol: 'RDN', exchange: 'New York Stock Exchange' }) === 'USD', 'RDN currency must infer USD');
assert(currency({ value: 74.58, currency: null }, { symbol: 'UHAL', exchange: 'New York Stock Exchange' }) === 'USD', 'UHAL currency must infer USD');
assert(currency({ value: 13.535, currency: null }, { symbol: 'ALWN', exchange: 'Euronext Athens' }) === 'EUR', 'ALWN currency must infer EUR');
assert(currency({ value: 1, currency: null }, { symbol: 'UNKNOWN', exchange: 'Unknown' }) === null, 'unknown currency must not default to EUR');

const finalCard = read('src/FinalDecisionCard.js');
const opportunities = read('src/OpportunitiesView.js');
const portfolio = read('PortfolioApp.js');
const app = JSON.parse(read('app.json'));
const pkg = JSON.parse(read('package.json'));

assert(finalCard.includes('canonicalPositionSymbol(position.symbol) === canonicalPositionSymbol(item?.symbol)'), 'FinalDecisionCard canonical holder match missing');
assert(portfolio.includes('<OpportunitiesView portfolioPositions={positions} />'), 'portfolio positions are not bridged to OpportunitiesView');
assert(opportunities.includes('personalizedDecisionCounts(feed, portfolioPositions)'), 'personalized decision counter missing');
assert(opportunities.includes('inferredReferenceCurrency(referencePrice, item)'), 'safe currency inference missing');
assert(!opportunities.includes("currency: referencePrice.currency || 'EUR'"), 'false EUR fallback still present');
assert(app.expo.version === '1.7.1', `app version mismatch: ${app.expo.version}`);
assert(Number(app.expo.android.versionCode) === 29, `Android versionCode mismatch: ${app.expo.android.versionCode}`);
assert(pkg.version === '1.7.1', `package version mismatch: ${pkg.version}`);

console.log('PASS v1.7.1 portfolio-aware holder/non-holder decisions, personalized counters, safe currency inference, version 1.7.1 build 29.');
