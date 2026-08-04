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
  if (!content.includes(from)) throw new Error(`v1.1.0 alert integrity patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchAlertEngine() {
  let source = read('src/alert-engine.js');
  source = replaceRequired(
    source,
    "    if (!quote?.usable || !finitePositive(quote.nativePrice)) continue;",
    "    if (!quote?.usable || !finitePositive(quote.nativePrice)) continue;\n    if (quote.quoteContract && quote.quoteContract.valuationEligible !== true) continue;",
    'valuation-eligible alert gate',
  );
  source = replaceRequired(
    source,
    "    if (finitePositive(rule.dailyPct) && Number.isFinite(Number(quote.changePct))) {",
    "    if (finitePositive(rule.dailyPct) && quote.dayChangeVerified === true && quote.quoteContract?.dayChangeEligible !== false && Number.isFinite(Number(quote.changePct))) {",
    'verified daily-change alert gate',
  );
  source = replaceRequired(
    source,
    "    triggeredAt: new Date().toISOString(),",
    "    triggeredAt: new Date().toISOString(),\n    quoteSource: quote.source || null,\n    quoteContractVersion: quote.quoteContract?.version || null,",
    'alert provenance',
  );
  write('src/alert-engine.js', source);
}

function patchPortfolio() {
  let source = read('PortfolioApp.js');
  source = replaceRequired(
    source,
    "import { exportBackupAsync, pickBackupAsync } from './src/backup';",
    "import { exportBackupAsync, pickBackupAsync } from './src/backup';\nimport { buildMobileQuoteContract } from './src/quote-contract';",
    'mobile quote contract import',
  );

  source = replaceRequired(
    source,
    "      const quote = { ...old, nativePrice: trade.price, price: trade.price / fxRate, updatedAt: new Date(trade.timestamp).toISOString(), checkedAt: new Date().toISOString(), source: 'Finnhub WebSocket real-time trade', quality: 'realtime', status: 'live', usable: true, ageSeconds: 0, changePct: previousClose > 0 ? ((trade.price - previousClose) / previousClose) * 100 : old?.changePct };",
    "      const candidate = { ...old, symbol: 'SPCE.US', nativePrice: trade.price, price: trade.price / fxRate, updatedAt: new Date(trade.timestamp).toISOString(), checkedAt: new Date().toISOString(), source: 'Finnhub WebSocket real-time trade', quality: 'realtime', status: 'live', ageSeconds: 0, priceTimestampVerified: true, dayChangeVerified: previousClose > 0, changePct: previousClose > 0 ? ((trade.price - previousClose) / previousClose) * 100 : null };\n      const quoteContract = buildMobileQuoteContract('SPCE.US', candidate, { now: Date.now() });\n      const quote = { ...candidate, quoteContract, usable: quoteContract.valuationEligible === true, dayChangeVerified: quoteContract.dayChangeEligible === true };",
    'WebSocket canonical quote contract',
  );

  source = replaceRequired(
    source,
    "{positions.map((position) => { const rule = getRule(state.alerts, position.symbol); return <View key={position.symbol} style={styles.card}><View style={styles.rowTop}><View><Text style={styles.cardTitle}>{position.symbol}</Text><Text style={styles.muted}>{position.company}</Text></View><View style={styles.badge}><Text style={styles.badgeText}>{rule.enabled ? 'Ενεργό' : 'Ανενεργό'}</Text></View></View><Text style={styles.note}>Τρέχουσα: {quotePrice(position.nativePrice, position.currency)}</Text>",
    "{positions.map((position) => { const rule = getRule(state.alerts, position.symbol); const quoteReady = position.quote?.usable === true && position.quote?.quoteContract?.valuationEligible !== false; return <View key={position.symbol} style={styles.card}><View style={styles.rowTop}><View style={styles.grow}><Text style={styles.cardTitle}>{position.symbol}</Text><Text style={styles.muted}>{position.company}</Text></View><View style={[styles.badge, !quoteReady && styles.badgeBad]}><Text style={[styles.badgeText, !quoteReady && styles.badgeBadText]}>{!rule.enabled ? 'Ανενεργό' : quoteReady ? 'Ενεργό' : 'Παύση δεδομένων'}</Text></View></View><Text style={styles.note}>Τρέχουσα: {quotePrice(position.nativePrice, position.currency)}</Text>{rule.enabled && !quoteReady ? <Text style={styles.quoteTransparencyWarning}>Ο κανόνας παραμένει αποθηκευμένος, αλλά δεν εκτελείται χωρίς επαληθευμένη και χρησιμοποιήσιμη τιμή.</Text> : null}",
    'alert card paused-data state',
  );

  write('PortfolioApp.js', source);
}

patchAlertEngine();
patchPortfolio();

const alertEngine = read('src/alert-engine.js');
const portfolio = read('PortfolioApp.js');
if (!alertEngine.includes('quoteContract.valuationEligible')) throw new Error('alert verification failed: valuation gate');
if (!alertEngine.includes('quote.dayChangeVerified === true')) throw new Error('alert verification failed: daily-change gate');
if (!portfolio.includes('Παύση δεδομένων')) throw new Error('alert verification failed: paused UI state');
if (!portfolio.includes("buildMobileQuoteContract('SPCE.US'")) throw new Error('alert verification failed: WebSocket quote contract');
console.log('Investor Control v1.1.0 canonical alert integrity patch applied.');
