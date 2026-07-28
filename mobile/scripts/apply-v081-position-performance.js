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
  if (content.includes(replacement.slice(0, Math.min(80, replacement.length)))) return content;
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`v0.8.1 patch failed: missing ${label}`);
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}

function patchPortfolio() {
  let source = read('PortfolioApp.js');

  if (!source.includes("require('./src/position-lots')")) {
    source = replaceRequired(
      source,
      "} from './src/transaction-accounting';\n\nconst VERSION = '0.8.0';",
      "} from './src/transaction-accounting';\nconst { buildPositionLots } = require('./src/position-lots');\n\nconst VERSION = '0.8.1';",
      'position-lots import and Portfolio version',
    );
  } else {
    source = source.replace("const VERSION = '0.8.0';", "const VERSION = '0.8.1';");
  }

  if (!source.includes('const lotSummary = buildPositionLots(')) {
    source = replaceRequired(
      source,
      "      const nativePnl = nativeValue === null ? null : nativeValue - position.cost;\n      const eurCost = position.currency === 'USD' && fxRate > 0 ? position.cost / fxRate : position.cost;\n      return {",
      "      const nativePnl = nativeValue === null ? null : nativeValue - position.cost;\n      const eurCost = position.currency === 'USD' && fxRate > 0 ? position.cost / fxRate : position.cost;\n      const lotSummary = buildPositionLots(state.transactions, position.symbol, nativePrice);\n      return {",
      'lot summary calculation',
    );
    source = replaceRequired(
      source,
      "        eurPnl: eurValue === null ? null : eurValue - eurCost,\n        average: position.quantity > 0 ? position.cost / position.quantity : 0,",
      "        eurPnl: eurValue === null ? null : eurValue - eurCost,\n        average: position.quantity > 0 ? position.cost / position.quantity : 0,\n        lots: lotSummary.openLots,\n        lotMethod: lotSummary.method,\n        hadLotSales: lotSummary.hadSales,\n        unmatchedSellQuantity: lotSummary.unmatchedSellQuantity,",
      'lot fields on position',
    );
  }

  const cardReplacement = `function PositionLotRow({ lot, currency, stale }) {
  const performance = Number(lot.performancePct);
  const performanceStyle = performance < 0 ? styles.red : performance > 0 ? styles.green : styles.muted;
  const date = lot.date ? new Date(String(lot.date) + 'T12:00:00').toLocaleDateString('el-GR') : '—';
  const remaining = Number(lot.remainingQuantity || 0);
  const original = Number(lot.originalQuantity || 0);
  return (
    <View style={styles.lotCard}>
      <View style={styles.rowTop}>
        <View style={styles.grow}>
          <Text style={styles.lotTitle}>Αγορά {lot.purchaseNumber}</Text>
          <Text style={styles.lotDate}>{date}{lot.broker ? ' · ' + lot.broker : ''}</Text>
        </View>
        <Text style={[styles.lotPerformance, performanceStyle]}>{stale ? '—' : pct(performance)}</Text>
      </View>
      <Text style={styles.lotMeta}>{remaining.toLocaleString('el-GR')} μετοχές{remaining !== original ? ' από ' + original.toLocaleString('el-GR') + ' αρχικές' : ''} · all-in {quotePrice(lot.allInPrice, currency, 4)}</Text>
      <View style={styles.lotResultRow}>
        <Text style={styles.lotResultLabel}>Από τη συγκεκριμένη αγορά</Text>
        <Text style={[styles.lotResultValue, performanceStyle]}>{stale ? '—' : cash(lot.pnl, currency)}</Text>
      </View>
    </View>
  );
}

function PositionCard({ item, compact, expanded, onToggle, onAlert }) {
  const stale = item.quote && !item.quote.usable;
  const dayChange = Number(item.quote?.changePct);
  const positionChange = Number(item.nativePct);
  const dayStyle = dayChange < 0 ? styles.red : dayChange > 0 ? styles.green : styles.muted;
  const positionStyle = positionChange < 0 ? styles.red : positionChange > 0 ? styles.green : styles.muted;
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
          <View style={styles.performanceStack}>
            <View style={styles.performanceLine}><Text style={styles.performanceLabel}>Ημέρα</Text><Text style={[styles.performanceValue, dayStyle]}>{stale ? '—' : pct(dayChange)}</Text></View>
            <View style={styles.performanceDivider} />
            <View style={styles.performanceLine}><Text style={styles.performanceLabel}>Από θέση</Text><Text style={[styles.performanceValue, positionStyle]}>{stale ? '—' : pct(positionChange)}</Text></View>
          </View>
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
          {item.currency === 'USD' && item.eurValue !== null ? <Text style={styles.note}>Σε ευρώ: αξία ≈ {cash(item.eurValue)} · αποτέλεσμα ≈ {cash(item.eurPnl)}</Text> : null}
          <View style={styles.lotsSection}>
            <View style={styles.lotsHeader}>
              <View style={styles.grow}><Text style={styles.lotsTitle}>Επιμέρους αγορές</Text><Text style={styles.lotsSubtitle}>Κάθε αγορά κρατά το δικό της all-in και πρόσημο.</Text></View>
              <View style={styles.lotsCountBadge}><Text style={styles.lotsCountText}>{item.lots?.length || 0}</Text></View>
            </View>
            {(item.lots || []).map((lot) => <PositionLotRow key={lot.lotId} lot={lot} currency={item.currency} stale={stale} />)}
            {item.hadLotSales ? <Text style={styles.lotMethodNote}>Οι πωλήσεις κατανέμονται FIFO μόνο για την απεικόνιση των ανοιχτών αγορών. Το συνολικό κόστος της κάρτας παραμένει στο λογιστικό μοντέλο v2.</Text> : null}
            {item.unmatchedSellQuantity > 0 ? <Text style={styles.warning}>Υπάρχει πώληση {item.unmatchedSellQuantity.toLocaleString('el-GR')} μετοχών που δεν αντιστοιχεί σε καταγεγραμμένη αγορά.</Text> : null}
          </View>
          <Text style={styles.source}>Πηγή: {item.quote?.source || '—'}{item.quote?.updatedAt ? '\\nΤιμή: ' + when(item.quote.updatedAt) + ' · Έλεγχος: ' + when(item.quote.checkedAt) : ''}</Text>
          {stale ? <Text style={styles.warning}>Η τιμή είναι παρωχημένη και δεν χρησιμοποιείται στη συνολική αποτίμηση.</Text> : null}
          <Pressable style={styles.secondaryActionFull} onPress={onAlert}><Text style={styles.secondaryStrong}>Ρύθμιση ειδοποιήσεων</Text></Pressable>
        </View>
      ) : <Text style={styles.tapHint}>Πάτησε για επιμέρους αγορές, στοιχεία και ειδοποιήσεις</Text>}
    </View>
  );
}`;

  if (!source.includes('function PositionLotRow(')) {
    source = replaceBetween(
      source,
      'function PositionCard({ item, compact, expanded, onToggle, onAlert }) {',
      '\n\nfunction transactionForm(',
      cardReplacement,
      'PositionCard block',
    );
  }

  if (!source.includes('performanceStack:')) {
    const styleStart = "  priceRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 18, gap: 10 },";
    const styleEnd = '\n  emptyCard:';
    const start = source.indexOf(styleStart);
    const end = source.indexOf(styleEnd, start + styleStart.length);
    if (start < 0 || end < 0) throw new Error('v0.8.1 patch failed: missing position-card style block');
    const styles = "  priceRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 18, gap: 10 }, big: { color: '#16345f', fontSize: 39, lineHeight: 45, fontWeight: '900', marginTop: 2 }, performanceStack: { width: 142, borderRadius: 16, borderWidth: 1, borderColor: '#d8e2ee', backgroundColor: '#f8fbff', paddingHorizontal: 11, paddingVertical: 8 }, performanceLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, performanceLabel: { color: '#7b889d', fontSize: 11, fontWeight: '800' }, performanceValue: { fontSize: 17, fontWeight: '900', textAlign: 'right' }, performanceDivider: { height: 1, backgroundColor: '#e4ebf4', marginVertical: 7 }, note: { color: '#67768c', fontSize: 15, lineHeight: 23, marginTop: 10 }, source: { color: '#8591a3', fontSize: 13, lineHeight: 20, marginTop: 10 }, tapHint: { color: '#0B66FF', fontWeight: '800', marginTop: 15, fontSize: 13 }, detailPanel: { borderTopWidth: 1, borderTopColor: '#e5ebf3', marginTop: 16, paddingTop: 14 }, lotsSection: { marginTop: 14 }, lotsHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }, lotsTitle: { color: '#16345f', fontSize: 18, fontWeight: '900' }, lotsSubtitle: { color: '#7b889d', fontSize: 12, lineHeight: 17, marginTop: 2 }, lotsCountBadge: { minWidth: 34, height: 34, borderRadius: 17, backgroundColor: '#edf4ff', alignItems: 'center', justifyContent: 'center' }, lotsCountText: { color: '#0B66FF', fontWeight: '900' }, lotCard: { borderRadius: 17, borderWidth: 1, borderColor: '#d7e1ed', backgroundColor: '#f9fbfe', padding: 13, marginBottom: 9 }, lotTitle: { color: '#16345f', fontSize: 16, fontWeight: '900' }, lotDate: { color: '#8490a2', fontSize: 11, lineHeight: 16, marginTop: 2 }, lotPerformance: { fontSize: 17, fontWeight: '900' }, lotMeta: { color: '#62738a', fontSize: 12, lineHeight: 18, marginTop: 8 }, lotResultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 9, paddingTop: 9, borderTopWidth: 1, borderTopColor: '#e3eaf3' }, lotResultLabel: { color: '#7b889d', fontSize: 11, flex: 1 }, lotResultValue: { fontSize: 14, fontWeight: '900', textAlign: 'right' }, lotMethodNote: { color: '#6d7b8e', backgroundColor: '#f1f5fa', borderRadius: 13, padding: 10, fontSize: 11, lineHeight: 16, marginTop: 2 },";
    source = `${source.slice(0, start)}${styles}${source.slice(end)}`;
  }

  write('PortfolioApp.js', source);
}

function patchVersions() {
  let decision = read('DecisionOverlay.js');
  decision = decision.replace("const VERSION = '0.8.0';", "const VERSION = '0.8.1';");
  if (!decision.includes("const VERSION = '0.8.1';")) throw new Error('v0.8.1 patch failed: DecisionOverlay version');
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
  packageJson.scripts['test:lots'] = 'node scripts/test-position-lots.cjs';
  packageJson.scripts.postinstall = 'node scripts/apply-v065-native-ui-fix.js && node scripts/apply-v070-opportunities.js && node scripts/apply-v071-live-sync.js && node scripts/apply-v080-autonomous-decisions.js && node scripts/apply-v081-position-performance.js';
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

patchPortfolio();
patchVersions();

const portfolio = read('PortfolioApp.js');
if (!portfolio.includes("const VERSION = '0.8.1';")) throw new Error('v0.8.1 verification failed: Portfolio version');
if (!portfolio.includes("require('./src/position-lots')")) throw new Error('v0.8.1 verification failed: lot engine import');
if (!portfolio.includes('Από θέση')) throw new Error('v0.8.1 verification failed: position performance label');
if (!portfolio.includes('Επιμέρους αγορές')) throw new Error('v0.8.1 verification failed: separate purchase lots');
if (!portfolio.includes('lotSummary.openLots')) throw new Error('v0.8.1 verification failed: open lots not attached');
console.log('Investor Control v0.8.1 position performance and purchase-lot patch applied.');
