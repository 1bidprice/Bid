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
  if (!content.includes(from)) throw new Error(`v0.8.1 patch failed: missing ${label}`);
  return content.replace(from, to);
}

function replaceBetween(content, startMarker, endMarker, replacement, label) {
  if (content.includes(replacement)) return content;
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`v0.8.1 patch failed: missing ${label}`);
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}

function patchPortfolioLots() {
  let source = read('PortfolioApp.js');

  source = replaceRequired(
    source,
    "} from './src/transaction-accounting';\n\nconst VERSION",
    "} from './src/transaction-accounting';\nconst { buildPositionLots } = require('./src/position-lots');\n\nconst VERSION",
    'position-lots import',
  );

  source = replaceRequired(
    source,
    "      const nativePrice = usable ? Number(quote.nativePrice) : null;\n      const eurPrice",
    "      const nativePrice = usable ? Number(quote.nativePrice) : null;\n      const lotAnalysis = buildPositionLots(state.transactions, position.symbol, nativePrice);\n      const eurPrice",
    'lot analysis calculation',
  );

  source = replaceRequired(
    source,
    "        nativePrice,\n        eurPrice,",
    "        nativePrice,\n        lotAnalysis,\n        eurPrice,",
    'lot analysis position field',
  );

  const replacement = `function lotDate(value) {
  if (!value) return '—';
  const date = new Date(\`${'${value}'}T12:00:00\`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function ReturnLine({ label, value, strong = false }) {
  const numeric = valid(value) ? Number(value) : null;
  return (
    <View style={styles.returnLine}>
      <Text style={styles.returnLabel} numberOfLines={1}>{label}</Text>
      <Text style={[strong ? styles.change : styles.lotChange, numeric !== null && numeric < 0 ? styles.red : styles.green]}>
        {numeric === null ? '—' : pct(numeric)}
      </Text>
    </View>
  );
}

function PositionReturnStack({ dailyChange, lotAnalysis, stale }) {
  const lots = Array.isArray(lotAnalysis?.openLots) ? lotAnalysis.openLots : [];
  return (
    <View style={styles.changeStack}>
      <ReturnLine label="Σήμερα" value={stale ? null : dailyChange} strong />
      {lots.length === 1 ? (
        <ReturnLine
          label={\`Από αγορά · ${'${lotDate(lots[0].date)}'}\`}
          value={stale ? null : lots[0].performancePct}
        />
      ) : lots.map((lot) => (
        <ReturnLine
          key={lot.lotId}
          label={\`${'${lot.purchaseNumber}'}η αγορά · ${'${lotDate(lot.date)}'}\`}
          value={stale ? null : lot.performancePct}
        />
      ))}
    </View>
  );
}

function PositionCard({ item, compact, expanded, onToggle, onAlert }) {
  const stale = item.quote && !item.quote.usable;
  const change = Number(item.quote?.changePct);
  const lots = Array.isArray(item.lotAnalysis?.openLots) ? item.lotAnalysis.openLots : [];
  return (
    <View style={styles.card}>
      <Pressable onPress={onToggle}>
        <View style={styles.rowTop}>
          <View style={styles.grow}>
            <Text style={styles.cardTitle}>{item.company}</Text>
            <Text style={styles.muted}>{item.symbol} · {item.quantity.toLocaleString('el-GR')} μετοχές</Text>
          </View>
          <QuoteBadge quote={item.quote} />
        </View>
        <View style={styles.priceRow}>
          <View style={styles.grow}>
            <Text style={styles.muted}>Τρέχουσα τιμή</Text>
            <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.64}>{stale ? '—' : quotePrice(item.nativePrice, item.currency)}</Text>
            {item.currency === 'USD' && !stale ? <Text style={styles.muted}>≈ {quotePrice(item.eurPrice, 'EUR')}</Text> : null}
          </View>
          <PositionReturnStack dailyChange={change} lotAnalysis={item.lotAnalysis} stale={stale} />
        </View>
        <View style={styles.grid}>
          <Metric compact={compact} label="Αξία θέσης" value={cash(item.nativeValue, item.currency)} />
          <Metric compact={compact} label="Συνολικό κόστος" value={cash(item.cost, item.currency)} />
          <Metric compact={compact} label="Κέρδος / Ζημία" value={cash(item.nativePnl, item.currency)} negative={item.nativePnl < 0} positiveValue={item.nativePnl > 0} />
          <Metric compact={compact} label="Μέση τιμή all-in" value={quotePrice(item.average, item.currency)} />
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.detailPanel}>
          {lots.length ? <>
            <Text style={styles.lotSectionTitle}>Αγορές χωριστά</Text>
            {lots.map((lot) => (
              <View key={lot.lotId} style={styles.lotDetail}>
                <View style={styles.grow}>
                  <Text style={styles.statusStrong}>{lot.purchaseNumber}η αγορά · {lotDate(lot.date)}</Text>
                  <Text style={styles.source}>{Number(lot.remainingQuantity).toLocaleString('el-GR', { maximumFractionDigits: 4 })} μετοχές · all-in {quotePrice(lot.allInPrice, item.currency, 4)}</Text>
                </View>
                <Text style={[styles.lotDetailPct, Number(lot.performancePct) < 0 ? styles.red : styles.green]}>{stale ? '—' : pct(lot.performancePct)}</Text>
              </View>
            ))}
            {item.lotAnalysis?.hadSales ? <Text style={styles.source}>Οι πωλήσεις κατανέμονται FIFO μόνο για την απεικόνιση των επιμέρους αγορών. Τα συνολικά λογιστικά στοιχεία της θέσης δεν αλλάζουν.</Text> : null}
          </> : null}
          {item.currency === 'USD' && item.eurValue !== null ? <Text style={styles.note}>Σε ευρώ: αξία ≈ {cash(item.eurValue)} · αποτέλεσμα ≈ {cash(item.eurPnl)}</Text> : null}
          <Text style={styles.source}>Πηγή: {item.quote?.source || '—'}{item.quote?.updatedAt ? \`\\nΤιμή: ${'${when(item.quote.updatedAt)}'} · Έλεγχος: ${'${when(item.quote.checkedAt)}'}\` : ''}</Text>
          {stale ? <Text style={styles.warning}>Η τιμή είναι παρωχημένη και δεν χρησιμοποιείται στη συνολική αποτίμηση.</Text> : null}
          <Pressable style={styles.secondaryActionFull} onPress={onAlert}><Text style={styles.secondaryStrong}>Ρύθμιση ειδοποιήσεων</Text></Pressable>
        </View>
      ) : <Text style={styles.tapHint}>Πάτησε για στοιχεία και ειδοποιήσεις</Text>}
    </View>
  );
}

`;

  source = replaceBetween(
    source,
    'function PositionCard({ item, compact, expanded, onToggle, onAlert }) {',
    'function transactionForm(transaction = null) {',
    replacement,
    'PositionCard block',
  );

  source = replaceRequired(
    source,
    "  priceRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 18, gap: 10 }, big: { color: '#16345f', fontSize: 39, lineHeight: 45, fontWeight: '900', marginTop: 2 }, change: { fontSize: 21, fontWeight: '900', paddingBottom: 7 }, note:",
    "  priceRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 18, gap: 10 }, big: { color: '#16345f', fontSize: 39, lineHeight: 45, fontWeight: '900', marginTop: 2 }, changeStack: { minWidth: 132, maxWidth: '48%', alignItems: 'stretch', justifyContent: 'flex-end', gap: 6, paddingBottom: 4 }, returnLine: { alignItems: 'flex-end' }, returnLabel: { color: '#8793a5', fontSize: 10, lineHeight: 13, fontWeight: '800', maxWidth: 145, textAlign: 'right' }, change: { fontSize: 21, lineHeight: 25, fontWeight: '900' }, lotChange: { fontSize: 16, lineHeight: 20, fontWeight: '900' }, lotSectionTitle: { color: '#16345f', fontSize: 16, fontWeight: '900', marginBottom: 5 }, lotDetail: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderBottomColor: '#e6ecf3', paddingVertical: 10 }, lotDetailPct: { fontSize: 17, fontWeight: '900', textAlign: 'right' }, note:",
    'purchase return styles',
  );

  write('PortfolioApp.js', source);
}

function patchVersions() {
  let portfolio = read('PortfolioApp.js');
  portfolio = replaceRequired(portfolio, "const VERSION = '0.8.0';", "const VERSION = '0.8.1';", 'Portfolio version');
  write('PortfolioApp.js', portfolio);

  let decision = read('DecisionOverlay.js');
  decision = replaceRequired(decision, "const VERSION = '0.8.0';", "const VERSION = '0.8.1';", 'DecisionOverlay version');
  write('DecisionOverlay.js', decision);

  const appJsonPath = path.join(root, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  appJson.expo.version = '0.8.1';
  appJson.expo.android.versionCode = 17;
  appJson.expo.ios.buildNumber = '17';
  fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  packageJson.version = '0.8.1';
  packageJson.scripts = packageJson.scripts || {};
  packageJson.scripts.postinstall = 'node scripts/apply-v065-native-ui-fix.js && node scripts/apply-v070-opportunities.js && node scripts/apply-v071-live-sync.js && node scripts/apply-v080-autonomous-decisions.js && node scripts/apply-v081-separate-purchase-returns.js';
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

patchPortfolioLots();
patchVersions();

const source = read('PortfolioApp.js');
if (!source.includes("const { buildPositionLots } = require('./src/position-lots');")) throw new Error('v0.8.1 verification failed: lot import missing');
if (!source.includes('<PositionReturnStack dailyChange={change}')) throw new Error('v0.8.1 verification failed: return stack missing');
if (!source.includes('Αγορές χωριστά')) throw new Error('v0.8.1 verification failed: separate purchases detail missing');
if (!source.includes("const VERSION = '0.8.1';")) throw new Error('v0.8.1 verification failed: wrong Portfolio version');
console.log('Investor Control v0.8.1 separate purchase returns patch applied.');
