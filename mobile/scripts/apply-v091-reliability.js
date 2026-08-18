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
  if (!content.includes(from)) throw new Error(`v0.9.1 patch failed: missing ${label}`);
  return content.replace(from, to);
}

function insertAfterRequired(content, marker, addition, sentinel, label) {
  if (content.includes(sentinel)) return content;
  if (!content.includes(marker)) throw new Error(`v0.9.1 patch failed: missing ${label}`);
  return content.replace(marker, `${marker}${addition}`);
}

function patchMarketData() {
  let source = read('src/market-data.js');

  source = replaceRequired(
    source,
    "async function fetchOfficialAllwynQuote() {\n  const html = await fetchText(EURONEXT_ALWN_URL);",
    "async function fetchOfficialAllwynQuote() {\n  const checkedAt = new Date();\n  const exchange = exchangeState('ALWN.GR', checkedAt);\n  const html = await fetchText(EURONEXT_ALWN_URL);",
    'Allwyn checked-at state',
  );

  source = replaceRequired(
    source,
    "    updatedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),\n    checkedAt: new Date().toISOString(),\n    source: 'Euronext Athens — επίσημα δεδομένα με καθυστέρηση 15′',\n    providerSymbol: 'ALWN',\n    quality: 'delayed15',\n    advertisedDelayMinutes: 15,\n    session: 'regular-market',",
    "    updatedAt: exchange.open\n      ? new Date(checkedAt.getTime() - 15 * 60 * 1000).toISOString()\n      : checkedAt.toISOString(),\n    checkedAt: checkedAt.toISOString(),\n    source: 'Euronext Athens — επίσημα δεδομένα με καθυστέρηση 15′',\n    providerSymbol: 'ALWN',\n    quality: 'delayed15',\n    advertisedDelayMinutes: 15,\n    session: exchange.session,\n    timestampMeaning: exchange.open ? 'estimated-delayed' : 'retrieval',\n    priceTimestampVerified: false,\n    dayChangeVerified: finite(previousClose),",
    'Allwyn timestamp semantics',
  );

  source = insertAfterRequired(
    source,
    '    session: point.session,',
    "\n    timestampMeaning: 'provider-market-time',\n    priceTimestampVerified: true,\n    dayChangeVerified: finite(previousClose),",
    "timestampMeaning: 'provider-market-time'",
    'Yahoo session metadata',
  );

  source = insertAfterRequired(
    source,
    '    session: marketSessionAt(`${ticker}.US`, new Date(timestamp * 1000)),',
    "\n    timestampMeaning: 'provider-market-time',\n    priceTimestampVerified: true,\n    dayChangeVerified: finite(payload.pc),",
    'dayChangeVerified: finite(payload.pc)',
    'Finnhub session metadata',
  );

  source = replaceRequired(
    source,
    "  const ticker = symbol.endsWith('.US')\n    ? symbol.slice(0, -3)\n    : symbol.endsWith('.GR')\n      ? `${symbol.slice(0, -3)}.AT`\n      : symbol;\n  return await fetchYahooQuote(ticker);",
    "  const ticker = symbol.endsWith('.US')\n    ? symbol.slice(0, -3)\n    : symbol.endsWith('.GR')\n      ? `${symbol.slice(0, -3)}.AT`\n      : symbol;\n  const fallback = await fetchYahooQuote(ticker);\n  if (symbol.endsWith('.GR')) {\n    return {\n      ...fallback,\n      dayChangeVerified: false,\n      dayChangeReason: 'Η εφεδρική πηγή δεν επιβεβαιώνει με ασφάλεια το προηγούμενο κλείσιμο για το Χρηματιστήριο Αθηνών.',\n    };\n  }\n  return fallback;",
    'Greek fallback daily-change gate',
  );

  source = replaceRequired(
    source,
    "        changePct: finite(changeBase)\n          ? ((Number(withFx.nativePrice) - changeBase) / changeBase) * 100\n          : null,",
    "        changePct: Number.isFinite(Number(withFx.nativeProviderChangePct))\n          ? Number(withFx.nativeProviderChangePct)\n          : finite(changeBase)\n            ? ((Number(withFx.nativePrice) - changeBase) / changeBase) * 100\n            : null,",
    'provider daily-change preference',
  );

  write('src/market-data.js', source);
}

function patchPortfolio() {
  let source = read('PortfolioApp.js');
  source = source.replace("const VERSION = '0.9.0';", "const VERSION = '0.9.1';");

  source = replaceRequired(
    source,
    '  const dayChange = Number(item.quote?.changePct);\n  const positionChange = Number(item.nativePct);',
    "  const dayChangeVerified = item.quote?.dayChangeVerified !== false;\n  const dayChange = dayChangeVerified ? Number(item.quote?.changePct) : null;\n  const positionChange = Number(item.nativePct);\n  const currentSession = marketSessionAt(item.symbol);",
    'verified daily change state',
  );

  source = replaceRequired(
    source,
    '  fetchPortfolioQuotes,\n  openFinnhubTrades,',
    '  fetchPortfolioQuotes,\n  marketSessionAt,\n  openFinnhubTrades,',
    'market session import',
  );

  source = replaceRequired(
    source,
    '<PositionPerformanceLine label="Ημέρα" value={dayChange} stale={stale} primary />',
    '<PositionPerformanceLine label={dayChangeVerified ? "Ημέρα" : "Ημέρα · μη επιβεβαιωμένη"} value={dayChange} stale={stale || !dayChangeVerified} primary />',
    'daily change visual gate',
  );

  source = replaceRequired(
    source,
    "          <Text style={styles.quoteTransparencyText}>Πηγή: {item.quote?.source || '—'}</Text>\n          <Text style={styles.quoteTransparencyText}>Τελευταία τιμή: {item.quote?.updatedAt ? when(item.quote.updatedAt) : '—'}</Text>\n          <Text style={styles.quoteTransparencyText}>Κατάσταση: {quoteQualityLabel(item.quote)} · Συνεδρία: {quoteSessionLabel(item.quote)}</Text>",
    "          <Text style={styles.quoteTransparencyText}>Πηγή: {item.quote?.source || '—'}</Text>\n          <Text style={styles.quoteTransparencyText}>{item.quote?.priceTimestampVerified === false ? 'Χρόνος δεδομένου: δεν δηλώνεται από την πηγή' : `Χρόνος δεδομένου: ${item.quote?.updatedAt ? when(item.quote.updatedAt) : '—'}`}</Text>\n          <Text style={styles.quoteTransparencyText}>Τελευταίος έλεγχος: {item.quote?.checkedAt ? when(item.quote.checkedAt) : '—'}</Text>\n          <Text style={styles.quoteTransparencyText}>Κατάσταση: {quoteQualityLabel(item.quote)} · Τρέχουσα συνεδρία: {quoteSessionLabel({ session: currentSession })}</Text>\n          {!dayChangeVerified ? <Text style={styles.quoteTransparencyWarning}>{item.quote?.dayChangeReason || 'Η ημερήσια μεταβολή δεν έχει επιβεβαιωθεί από αξιόπιστη βάση προηγούμενου κλεισίματος.'}</Text> : null}",
    'quote transparency semantics',
  );

  source = replaceRequired(
    source,
    "quoteTransparencyText: { color: '#718096', fontSize: 11, lineHeight: 16 }, note:",
    "quoteTransparencyText: { color: '#718096', fontSize: 11, lineHeight: 16 }, quoteTransparencyWarning: { color: '#9a6500', fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 5 }, note:",
    'quote warning style',
  );

  write('PortfolioApp.js', source);

  source = read('DecisionOverlay.js');
  source = source.replace("const VERSION = '0.9.0';", "const VERSION = '0.9.1';");
  write('DecisionOverlay.js', source);
}

function patchFeedFreshness() {
  let source = read('src/intelligence-feed-store.js');
  source = replaceRequired(
    source,
    "  if (ageHours <= 36) return { state: 'fresh', ageHours, label: 'Ενημερωμένη' };\n  if (ageHours <= 96) return { state: 'delayed', ageHours, label: 'Καθυστερημένη ενημέρωση' };",
    "  if (ageHours <= 4) return { state: 'fresh', ageHours, label: 'Ενημερωμένη' };\n  if (ageHours <= 12) return { state: 'delayed', ageHours, label: 'Καθυστερημένη ενημέρωση' };",
    'feed freshness thresholds',
  );
  write('src/intelligence-feed-store.js', source);

  source = read('src/OpportunitiesView.js');
  source = replaceRequired(
    source,
    "<Text style={styles.connectionText}>{feed ? `${freshness.label} · δημιουργία ${when(feed.generatedAt)}` : 'Δεν έχει ληφθεί ακόμη έγκυρη ροή.'}</Text>",
    "<Text style={styles.connectionText}>{feed ? `${freshness.label} · ηλικία ${freshness.ageHours.toFixed(1)} ωρών · δημιουργία ${when(feed.generatedAt)}` : 'Δεν έχει ληφθεί ακόμη έγκυρη ροή.'}</Text>",
    'visible feed age',
  );
  write('src/OpportunitiesView.js', source);
}

function patchVersions() {
  const appPath = path.join(root, 'app.json');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.expo.version = '0.9.1';
  app.expo.android.versionCode = 19;
  app.expo.ios.buildNumber = '19';
  fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = '0.9.1';
  pkg.scripts = pkg.scripts || {};
  if (!pkg.scripts.postinstall.includes('apply-v091-reliability.js')) {
    pkg.scripts.postinstall += ' && node scripts/apply-v091-reliability.js';
  }
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchMarketData();
patchPortfolio();
patchFeedFreshness();
patchVersions();

console.log('Investor Control v0.9.1 reliability patch applied.');
