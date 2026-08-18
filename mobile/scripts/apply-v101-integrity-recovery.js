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
  if (!content.includes(from)) throw new Error(`v1.0.1 integrity patch failed: missing ${label}`);
  return content.replace(from, to);
}

function replaceRegexRequired(content, pattern, replacement, sentinel, label) {
  if (sentinel && content.includes(sentinel)) return content;
  if (!pattern.test(content)) throw new Error(`v1.0.1 integrity patch failed: missing ${label}`);
  pattern.lastIndex = 0;
  return content.replace(pattern, replacement);
}

function patchMarketData() {
  let source = read('src/market-data.js');

  source = replaceRequired(
    source,
    "const EURONEXT_ALWN_URL = 'https://athens.euronext.com/en/market-data/instruments/stocks/ALWN/related';",
    "const EURONEXT_ATHENS_URLS = {\n  'ALWN.GR': 'https://athens.euronext.com/en/market-data/instruments/stocks/ALWN/related',\n  'CREDIA.GR': 'https://athens.euronext.com/en/market-data/instruments/stocks/CREDIA/related',\n};",
    'Euronext Athens symbol map',
  );

  const officialFunction = `async function fetchOfficialAthensQuote(symbol) {
  const url = EURONEXT_ATHENS_URLS[symbol];
  if (!url) throw new Error(\`δεν έχει οριστεί επίσημη πηγή Euronext Athens για \${symbol}\`);
  const checkedAt = new Date();
  const exchange = exchangeState(symbol, checkedAt);
  const html = await fetchText(url);
  const text = htmlToText(html);
  const priceValue = numberAfterLabel(text, ['Last Traded Price', 'Τελευταία Τιμή Διαπραγμάτευσης']);
  const previousClose = numberAfterLabel(text, ['Previous Close', 'Προηγούμενο Κλείσιμο']);
  if (!finite(priceValue)) throw new Error(\`η Euronext Athens δεν επέστρεψε τιμή για \${symbol}\`);
  return {
    nativePrice: priceValue,
    nativePreviousClose: finite(previousClose) ? previousClose : null,
    nativeChangeBase: finite(previousClose) ? previousClose : null,
    nativeRegularMarketPrice: priceValue,
    nativeCurrency: 'EUR',
    updatedAt: checkedAt.toISOString(),
    checkedAt: checkedAt.toISOString(),
    source: 'Euronext Athens — επίσημα δεδομένα με καθυστέρηση 15′',
    providerSymbol: symbol.replace(/\\.GR$/, ''),
    quality: 'delayed15',
    advertisedDelayMinutes: 15,
    session: exchange.session,
    timestampMeaning: 'retrieval-time-for-official-delayed-value',
    priceTimestampVerified: false,
    dayChangeVerified: finite(previousClose),
  };
}`;

  source = replaceRegexRequired(
    source,
    /async function fetchOfficialAllwynQuote\(\) \{[\s\S]*?\n\}\n\nasync function fetchEurUsd\(\)/,
    `${officialFunction}\n\nasync function fetchEurUsd()`,
    'async function fetchOfficialAthensQuote(symbol)',
    'generic Euronext Athens quote adapter',
  );

  source = replaceRequired(
    source,
    "  const allowedAge = symbol === 'ALWN.GR' ? 25 * 60 : 3 * 60;",
    "  const allowedAge = symbol.endsWith('.GR') && quote.quality === 'delayed15' ? 35 * 60 : 3 * 60;",
    'Athens delayed quote age policy',
  );

  source = replaceRegexRequired(
    source,
    /  if \(symbol === 'ALWN\.GR'\) \{[\s\S]*?\n  \}\n\n  if \(symbol === 'SPCE\.US'\) \{/,
    `  if (EURONEXT_ATHENS_URLS[symbol]) {
    try {
      return await fetchOfficialAthensQuote(symbol);
    } catch (officialError) {
      const providerSymbol = symbol.replace(/\\.GR$/, '');
      const fallback = await fetchYahooQuote(\`\${providerSymbol}.AT\`);
      return {
        ...fallback,
        nativeCurrency: 'EUR',
        dayChangeVerified: false,
        dayChangeReason: 'Η εφεδρική πηγή δεν επιβεβαιώνει με ασφάλεια το προηγούμενο κλείσιμο για το Χρηματιστήριο Αθηνών.',
        source: \`\${fallback.source} · Euronext error: \${officialError.message}\`,
      };
    }
  }

  if (symbol === 'SPCE.US') {`,
    'EURONEXT_ATHENS_URLS[symbol]',
    'official Athens routing',
  );

  write('src/market-data.js', source);
}

function patchPortfolio() {
  let source = read('PortfolioApp.js');

  source = replaceRequired(
    source,
    "      const eurCost = position.currency === 'USD' && fxRate > 0 ? position.cost / fxRate : position.cost;",
    "      const eurCost = position.currency === 'USD' ? (fxRate > 0 ? position.cost / fxRate : null) : position.cost;",
    'currency-safe EUR cost',
  );

  source = replaceRequired(
    source,
    "  const positions = useMemo(() => positionsFrom(state), [state]);\n  const valuesReady = positions.every((position) => position.eurValue !== null);\n  const costsReady = positions.every((position) => valid(position.eurCost));\n  const totalValue = positions.length === 0 ? 0 : valuesReady ? positions.reduce((sum, position) => sum + position.eurValue, 0) : null;\n  const totalCost = positions.length === 0 ? 0 : costsReady ? positions.reduce((sum, position) => sum + position.eurCost, 0) : null;\n  const totalPnl = totalValue !== null && totalCost !== null ? totalValue - totalCost : null;",
    "  const positions = useMemo(() => positionsFrom(state), [state]);\n  const valuedPositions = positions.filter((position) => position.eurValue !== null && valid(position.eurCost));\n  const costedPositions = positions.filter((position) => valid(position.eurCost));\n  const missingValuationSymbols = positions.filter((position) => position.eurValue === null || !valid(position.eurCost)).map((position) => position.symbol);\n  const valuesReady = positions.length === valuedPositions.length;\n  const costsReady = positions.length === costedPositions.length;\n  const totalValue = positions.length === 0 ? 0 : valuedPositions.length ? valuedPositions.reduce((sum, position) => sum + position.eurValue, 0) : null;\n  const totalCost = positions.length === 0 ? 0 : costedPositions.length ? costedPositions.reduce((sum, position) => sum + position.eurCost, 0) : null;\n  const totalPnl = positions.length === 0 ? 0 : valuedPositions.length ? valuedPositions.reduce((sum, position) => sum + position.eurPnl, 0) : null;\n  const valuationCoverage = positions.length ? `${valuedPositions.length}/${positions.length}` : '0/0';",
    'partial valuation model',
  );

  source = replaceRequired(
    source,
    "          <View style={styles.grid}><Metric compact={compactMetrics} label=\"Αξία χαρτοφυλακίου\" value={cash(totalValue)} /><Metric compact={compactMetrics} label=\"Καθαρό κόστος\" value={cash(totalCost)} /><Metric compact={compactMetrics} label=\"Κέρδος / Ζημία\" value={cash(totalPnl)} negative={totalPnl < 0} positiveValue={totalPnl > 0} /><Metric compact={compactMetrics} label=\"Θέσεις\" value={String(positions.length)} /></View>\n          {!valuesReady ? <Text style={styles.warning}>Η συνολική αποτίμηση μένει κενή όταν κάποια τιμή είναι παρωχημένη ή μη διαθέσιμη.</Text> : null}",
    "          <View style={styles.grid}><Metric compact={compactMetrics} label={valuesReady ? 'Αξία χαρτοφυλακίου' : 'Επιβεβ. αξία'} value={cash(totalValue)} /><Metric compact={compactMetrics} label={costsReady ? 'Καθαρό κόστος' : 'Επιβεβ. κόστος'} value={cash(totalCost)} /><Metric compact={compactMetrics} label={valuesReady ? 'Κέρδος / Ζημία' : 'Επιβεβ. αποτέλεσμα'} value={cash(totalPnl)} negative={totalPnl < 0} positiveValue={totalPnl > 0} /><Metric compact={compactMetrics} label=\"Κάλυψη τιμών\" value={valuationCoverage} /></View>\n          {!valuesReady ? <Text style={styles.warning}>Μερική αποτίμηση {valuationCoverage}. Εξαιρούνται από την αξία και το αποτέλεσμα μόνο οι θέσεις χωρίς χρησιμοποιήσιμη τιμή ή ισοτιμία: {missingValuationSymbols.join(', ') || '—'}.</Text> : null}",
    'partial valuation presentation',
  );

  source = replaceRequired(
    source,
    "        <View style={styles.rowTop}>\n          <View style={styles.grow}>\n            <Text style={styles.cardTitle}>{item.company}</Text>\n            <Text style={styles.muted}>{item.symbol} · {item.quantity.toLocaleString('el-GR')} μετοχές</Text>\n          </View>\n          <QuoteBadge quote={item.quote} />\n        </View>",
    "        <View style={[styles.rowTop, compact && { flexDirection: 'column', alignItems: 'flex-start', gap: 8 }]}>\n          <View style={[styles.grow, { minWidth: 0 }]}>\n            <Text style={styles.cardTitle}>{item.company}</Text>\n            <Text style={styles.muted}>{item.symbol} · {item.quantity.toLocaleString('el-GR')} μετοχές</Text>\n          </View>\n          <QuoteBadge quote={item.quote} />\n        </View>",
    'responsive position header',
  );

  source = source.replace("const VERSION = '1.0.0';", "const VERSION = '1.0.1';");
  write('PortfolioApp.js', source);

  let decision = read('DecisionOverlay.js');
  decision = decision.replace("const VERSION = '1.0.0';", "const VERSION = '1.0.1';");
  write('DecisionOverlay.js', decision);
}

function patchVersions() {
  const appPath = path.join(root, 'app.json');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.expo.version = '1.0.1';
  app.expo.android.versionCode = 21;
  app.expo.ios.buildNumber = '21';
  fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = '1.0.1';
  pkg.scripts = pkg.scripts || {};
  if (!String(pkg.scripts.postinstall || '').includes('apply-v101-integrity-recovery.js')) {
    pkg.scripts.postinstall = `${String(pkg.scripts.postinstall || '').trim()} && node scripts/apply-v101-integrity-recovery.js`.replace(/^\s*&&\s*/, '');
  }
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchMarketData();
patchPortfolio();
patchVersions();

const market = read('src/market-data.js');
const portfolio = read('PortfolioApp.js');
if (!market.includes("'CREDIA.GR': 'https://athens.euronext.com")) throw new Error('CrediaBank official quote source missing');
if (!market.includes('async function fetchOfficialAthensQuote(symbol)')) throw new Error('generic Athens adapter missing');
if (!portfolio.includes('Μερική αποτίμηση {valuationCoverage}')) throw new Error('partial valuation notice missing');
if (!portfolio.includes("const VERSION = '1.0.1';")) throw new Error('Portfolio version missing');
console.log('Investor Control v1.0.1 integrity and continuity patch applied.');
