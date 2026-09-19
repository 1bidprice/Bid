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
  if (!content.includes(from)) throw new Error(`Investor Control v1.7.3b runtime patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchMarketContext() {
  let source = read('src/market-data.js');
  source = replaceRequired(
    source,
    '  const quoteContract = buildMobileQuoteContract(symbol, quote, { now: Date.now() });',
    '  const quoteContract = buildMobileQuoteContract(symbol, quote, { now: Date.now(), exchangeOpen: exchange.open, exchangeSession: exchange.session });',
    'exchange state in quote integrity contract',
  );
  write('src/market-data.js', source);
}

function patchPositionCardLayout() {
  let source = read('PortfolioApp.js');
  source = replaceRequired(
    source,
    "badge: { backgroundColor: '#edf4ff', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18 },",
    "badge: { backgroundColor: '#edf4ff', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18, maxWidth: '48%', flexShrink: 1 },",
    'bounded quote badge width',
  );
  write('PortfolioApp.js', source);
}

patchMarketContext();
patchPositionCardLayout();

const market = read('src/market-data.js');
const portfolio = read('PortfolioApp.js');

if (!market.includes('exchangeOpen: exchange.open')) throw new Error('v1.7.3b verification failed: exchange-open context missing');
if (!portfolio.includes("maxWidth: '48%', flexShrink: 1")) throw new Error('v1.7.3b verification failed: bounded position badge missing');

console.log('Investor Control mobile v1.7.3 build 31: closed-market context and mobile badge-width regression fix applied.');
