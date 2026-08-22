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

function replaceRegexRequired(content, pattern, replacement, sentinel, label) {
  if (sentinel && content.includes(sentinel)) return content;
  if (!pattern.test(content)) throw new Error(`Investor Control v1.7.3b runtime patch failed: missing ${label}`);
  pattern.lastIndex = 0;
  return content.replace(pattern, replacement);
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

  source = replaceRegexRequired(
    source,
    /<View style=\{styles\.rowTop\}>\s*<View style=\{styles\.grow\}>\s*<Text style=\{styles\.cardTitle\}>\{item\.company\}<\/Text>\s*<Text style=\{styles\.muted\}>\{item\.symbol\} · \{item\.quantity\.toLocaleString\('el-GR'\)\} μετοχές<\/Text>\s*<\/View>\s*<QuoteBadge quote=\{item\.quote\} \/>\s*<\/View>/,
    `<View style={{ width: '100%' }}>\n          <Text style={styles.cardTitle} numberOfLines={2}>{item.company}</Text>\n          <Text style={styles.muted}>{item.symbol} · {item.quantity.toLocaleString('el-GR')} μετοχές</Text>\n          <View style={{ alignItems: 'flex-start', marginTop: 10 }}>\n            <QuoteBadge quote={item.quote} />\n          </View>\n        </View>`,
    "<View style={{ alignItems: 'flex-start', marginTop: 10 }}>",
    'position title and quote badge layout',
  );

  source = replaceRequired(
    source,
    '<View style={[styles.badge, bad && styles.badgeBad]}>',
    "<View style={[styles.badge, bad && styles.badgeBad, { maxWidth: '100%' }]}>",
    'bounded quote badge',
  );

  source = replaceRequired(
    source,
    '<Text style={[styles.badgeText, bad && styles.badgeBadText]}>{text}</Text>',
    '<Text style={[styles.badgeText, bad && styles.badgeBadText]} numberOfLines={2}>{text}</Text>',
    'bounded quote badge text',
  );

  write('PortfolioApp.js', source);
}

patchMarketContext();
patchPositionCardLayout();

const market = read('src/market-data.js');
const portfolio = read('PortfolioApp.js');

if (!market.includes('exchangeOpen: exchange.open')) throw new Error('v1.7.3b verification failed: exchange-open context missing');
if (!portfolio.includes("<View style={{ alignItems: 'flex-start', marginTop: 10 }}>")) throw new Error('v1.7.3b verification failed: position badge layout missing');
if (!portfolio.includes("{ maxWidth: '100%' }")) throw new Error('v1.7.3b verification failed: bounded badge missing');

console.log('Investor Control mobile v1.7.3 build 31: closed-market context and position-card layout regression fix applied.');
