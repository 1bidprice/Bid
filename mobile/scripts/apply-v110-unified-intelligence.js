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
  if (!content.includes(from)) throw new Error(`v1.1.0 mobile patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchFeedStore() {
  let source = read('src/intelligence-feed-store.js');

  source = replaceRequired(
    source,
    "    metricNotes: safeArray(item?.metricNotes),\n  };",
    "    metricNotes: safeArray(item?.metricNotes),\n    marketQuote: item?.marketQuote && typeof item.marketQuote === 'object' ? item.marketQuote : null,\n  };",
    'market quote item normalization',
  );

  source = replaceRequired(
    source,
    "  const discoveryRadar = safeArray(payload.discoveryRadar).map((item) => ({ ...item, reasons: safeArray(item?.reasons), events: safeArray(item?.events), suggestedAction: 'WATCH' }));\n  return {",
    "  const discoveryRadar = safeArray(payload.discoveryRadar).map((item) => ({ ...item, reasons: safeArray(item?.reasons), events: safeArray(item?.events), suggestedAction: 'WATCH', scoreType: item?.scoreType || 'DISCOVERY_PRIORITY', scoreLabel: item?.scoreLabel || 'Προτεραιότητα διερεύνησης', investmentScore: null }));\n  const quoteRegistry = payload.quoteRegistry && typeof payload.quoteRegistry === 'object'\n    ? Object.fromEntries(Object.entries(payload.quoteRegistry).filter(([, item]) => item && typeof item === 'object'))\n    : {};\n  return {",
    'quote registry normalization',
  );

  source = replaceRequired(
    source,
    "    sourceHealth: payload.sourceHealth && typeof payload.sourceHealth === 'object' ? payload.sourceHealth : null,",
    "    sourceHealth: payload.sourceHealth && typeof payload.sourceHealth === 'object' ? payload.sourceHealth : null,\n    quoteRegistry,",
    'quote registry preservation',
  );

  write('src/intelligence-feed-store.js', source);
}

function patchMarketData() {
  let source = read('src/market-data.js');

  source = replaceRequired(
    source,
    "import AsyncStorage from '@react-native-async-storage/async-storage';",
    "import AsyncStorage from '@react-native-async-storage/async-storage';\nimport { buildMobileQuoteContract, quoteFromRegistry, safeProviderDiagnostic } from './quote-contract';",
    'quote contract import',
  );

  source = replaceRequired(
    source,
    "const PERSISTED_STATE_KEY = 'investor-control-mobile-state-v2';",
    "const PERSISTED_STATE_KEY = 'investor-control-mobile-state-v2';\nconst INTELLIGENCE_FEED_STORAGE_KEY = 'investor-control.intelligence-feed.v1';",
    'intelligence feed key',
  );

  if (!source.includes('async function readCanonicalFeedQuotes(')) {
    source = replaceRequired(
      source,
      `async function readPersistedPrices() {
  try {
    const raw = await AsyncStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed?.prices && typeof parsed.prices === 'object' ? parsed.prices : {};
  } catch (_) {
    return {};
  }
}
`,
      `async function readPersistedPrices() {
  try {
    const raw = await AsyncStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed?.prices && typeof parsed.prices === 'object' ? parsed.prices : {};
  } catch (_) {
    return {};
  }
}

async function readCanonicalFeedQuotes(symbols = []) {
  try {
    const raw = await AsyncStorage.getItem(INTELLIGENCE_FEED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const registry = parsed?.quoteRegistry && typeof parsed.quoteRegistry === 'object'
      ? parsed.quoteRegistry
      : {};
    const quotes = {};
    for (const symbol of symbols) {
      const quote = quoteFromRegistry(symbol, registry[symbol], { now: Date.now() });
      if (quote) quotes[symbol] = quote;
    }
    return quotes;
  } catch (_) {
    return {};
  }
}
`,
      'canonical feed quote reader',
    );
  }

  source = replaceRequired(
    source,
    "        source: `${fallback.source} · Euronext error: ${officialError.message}`,",
    "        source: fallback.source,\n        userNotice: 'Η επίσημη πηγή Euronext Athens δεν ήταν διαθέσιμη. Η εφεδρική τιμή δεν χρησιμοποιείται σε αποτίμηση ή τελική απόφαση.',\n        providerDiagnostic: safeProviderDiagnostic(officialError, 'OFFICIAL_ATHENS_QUOTE_UNAVAILABLE'),",
    'safe Athens fallback diagnostics',
  );

  source = replaceRequired(
    source,
    `  return {
    ...quote,
    ageSeconds,
    status,
    exchangeOpen: exchange.open,
    usable: status !== 'stale',
  };`,
    `  const quoteContract = buildMobileQuoteContract(symbol, { ...quote, ageSeconds, status }, { now: Date.now() });
  return {
    ...quote,
    ageSeconds,
    status,
    exchangeOpen: exchange.open,
    quoteContract,
    usable: quoteContract.valuationEligible === true,
    dayChangeVerified: quoteContract.dayChangeEligible === true,
  };`,
    'quote contract classification',
  );

  source = replaceRequired(
    source,
    `  const currentTime = quoteTimestamp(currentQuote);
  const incomingTime = quoteTimestamp(incomingQuote);
  const toleranceMs = 1000;
  let selected;

  if (incomingTime > currentTime + toleranceMs) selected = incomingQuote;
  else if (currentTime > incomingTime + toleranceMs) selected = currentQuote;
  else selected = quotePriority(incomingQuote) >= quotePriority(currentQuote)
    ? incomingQuote
    : currentQuote;`,
    `  const currentTime = quoteTimestamp(currentQuote);
  const incomingTime = quoteTimestamp(incomingQuote);
  const toleranceMs = 1000;
  const currentApproved = currentQuote?.quoteContract?.valuationEligible === true;
  const incomingApproved = incomingQuote?.quoteContract?.valuationEligible === true;
  let selected;

  if (currentApproved !== incomingApproved) selected = incomingApproved ? incomingQuote : currentQuote;
  else if (incomingTime > currentTime + toleranceMs) selected = incomingQuote;
  else if (currentTime > incomingTime + toleranceMs) selected = currentQuote;
  else selected = quotePriority(incomingQuote) >= quotePriority(currentQuote)
    ? incomingQuote
    : currentQuote;`,
    'approved source precedence',
  );

  source = replaceRequired(
    source,
    "  const fetched = {};\n  const errors = [];",
    "  const fetched = {};\n  const errors = [];\n  const canonicalFeedQuotes = await readCanonicalFeedQuotes(cleanSymbols);",
    'canonical quote load',
  );

  source = source.split("      errors.push(`${symbol}: ${error.message}`);").join("      errors.push(`${symbol}: ${safeProviderDiagnostic(error)}`);");

  source = replaceRequired(
    source,
    `  const persisted = await readPersistedPrices();
  const baseline = mergePortfolioQuotes(persisted, inMemoryQuotes);
  const newest = mergePortfolioQuotes(baseline, fetched);`,
    `  const persisted = await readPersistedPrices();
  const baseline = mergePortfolioQuotes(persisted, inMemoryQuotes);
  const canonicalBaseline = mergePortfolioQuotes(baseline, canonicalFeedQuotes);
  const newest = mergePortfolioQuotes(canonicalBaseline, fetched);`,
    'canonical quote merge',
  );

  write('src/market-data.js', source);
}

function patchPortfolio() {
  let source = read('PortfolioApp.js');

  source = replaceRequired(
    source,
    "  if (status === 'stale' || quote.usable === false) return 'Παρωχημένη / μη χρησιμοποιήσιμη';",
    "  const contractStatus = quote?.quoteContract?.publicStatus;\n  if (contractStatus === 'FALLBACK_NOT_VERIFIED') return 'Εφεδρική / μη επιβεβαιωμένη';\n  if (contractStatus === 'TIMESTAMP_NOT_VERIFIED') return 'Χρόνος μη επιβεβαιωμένος';\n  if (contractStatus === 'STALE' || status === 'stale' || quote.usable === false) return 'Παρωχημένη / μη χρησιμοποιήσιμη';",
    'contract-aware quote label',
  );

  source = replaceRequired(
    source,
    "          {!dayChangeVerified ? <Text style={styles.quoteTransparencyWarning}>{item.quote?.dayChangeReason || 'Η ημερήσια μεταβολή δεν έχει επιβεβαιωθεί από αξιόπιστη βάση προηγούμενου κλεισίματος.'}</Text> : null}",
    "          {!dayChangeVerified ? <Text style={styles.quoteTransparencyWarning}>{item.quote?.dayChangeReason || 'Η ημερήσια μεταβολή δεν έχει επιβεβαιωθεί από αξιόπιστη βάση προηγούμενου κλεισίματος.'}</Text> : null}\n          {item.quote?.quoteContract?.publicMessage ? <Text style={styles.quoteContractText}>{item.quote.quoteContract.publicMessage}</Text> : null}",
    'quote contract public message',
  );

  source = replaceRequired(
    source,
    "quoteTransparencyWarning: { color: '#9a6500', fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 5 }, note:",
    "quoteTransparencyWarning: { color: '#9a6500', fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 5 }, quoteContractText: { color: '#40536f', fontSize: 10, lineHeight: 15, fontWeight: '700', marginTop: 5 }, note:",
    'quote contract style',
  );

  source = source.replace("const VERSION = '1.0.1';", "const VERSION = '1.1.0';");
  write('PortfolioApp.js', source);

  let decision = read('DecisionOverlay.js');
  decision = decision.replace("const VERSION = '1.0.1';", "const VERSION = '1.1.0';");
  write('DecisionOverlay.js', decision);
}

function patchOpportunities() {
  let source = read('src/OpportunitiesView.js');

  source = replaceRequired(
    source,
    "  const productionReady = operationalHealth?.status === 'OPERATIONAL' && freshness.state === 'fresh';",
    "  const productionReady = operationalHealth?.status === 'OPERATIONAL'\n    && operationalHealth?.marketDataStatus === 'OPERATIONAL'\n    && operationalHealth?.fundamentalsStatus === 'OPERATIONAL'\n    && freshness.state === 'fresh';",
    'strict production readiness',
  );

  source = replaceRequired(
    source,
    "          <Text style={styles.productionHealthText}>{productionReady ? 'Η ροή είναι πρόσφατη και οι βασικοί έλεγχοι δεδομένων λειτουργούν.' : 'Το σύστημα συνεχίζει να συλλέγει και να ελέγχει δεδομένα, αλλά δεν εγκρίνει αγορά ή πώληση όταν λείπει πηγή, ιστορικό, benchmark, θεμελιώδη ή διασταύρωση.'}</Text>",
    "          <Text style={styles.productionHealthText}>{productionReady ? 'Η ροή είναι πρόσφατη και οι υποχρεωτικοί έλεγχοι αγοράς και θεμελιωδών λειτουργούν.' : 'Το σύστημα συνεχίζει να συλλέγει και να ελέγχει δεδομένα, αλλά δεν εγκρίνει αγορά ή πώληση όταν λείπει πηγή, ιστορικό, benchmark, θεμελιώδη ή διασταύρωση.'}</Text>\n          <Text style={styles.healthSplitText}>Υποδομή: {operationalHealth?.infrastructureStatus || '—'} · Αγορά: {operationalHealth?.marketDataStatus || '—'} · Θεμελιώδη: {operationalHealth?.fundamentalsStatus || '—'} · Αποφάσεις: {operationalHealth?.decisionEngineStatus || '—'}</Text>",
    'split production health status',
  );

  source = replaceRequired(
    source,
    "function DiscoveryRadarCard({ item }) {\n  return <View style={styles.discoveryCard}><View style={styles.rowTop}><View style={styles.grow}><Text style={styles.company}>{item.companyName}</Text><Text style={styles.symbol}>{item.symbol || '—'} · {item.exchange || '—'}</Text></View><View style={styles.discoveryScore}><Text style={styles.discoveryScoreValue}>{Math.round(Number(item.discoveryScore || 0))}</Text><Text style={styles.discoveryScoreLabel}>σήμα</Text></View></View><Text style={styles.discoveryStatus}>ΑΥΤΟΜΑΤΗ ΑΝΑΚΑΛΥΨΗ · ΟΧΙ ΑΚΟΜΗ ΠΡΟΤΑΣΗ ΑΓΟΡΑΣ</Text>{(item.reasons || []).slice(0, 3).map((reason, index) => <Text key={index} style={styles.discoveryReason}>• {reason}</Text>)}<Text style={styles.discoveryTime}>Νεότερο γεγονός: {when(item.latestEventAt)}</Text></View>;\n}",
    "function DiscoveryRadarCard({ item }) {\n  return <View style={styles.discoveryCard}><View style={styles.rowTop}><View style={styles.grow}><Text style={styles.company}>{item.companyName}</Text><Text style={styles.symbol}>{item.symbol || '—'} · {item.exchange || '—'}</Text></View><View style={styles.discoveryScore}><Text style={styles.discoveryScoreValue}>{Math.round(Number(item.discoveryScore || 0))}</Text><Text style={styles.discoveryScoreLabel}>προτερ.</Text></View></View><Text style={styles.discoveryStatus}>ΑΥΤΟΜΑΤΗ ΑΝΑΚΑΛΥΨΗ · ΟΧΙ ΑΚΟΜΗ ΠΡΟΤΑΣΗ ΑΓΟΡΑΣ</Text><Text style={styles.discoveryDisclaimer}>Βαθμός προτεραιότητας διερεύνησης — όχι επενδυτική βαθμολογία.</Text>{(item.reasons || []).slice(0, 3).map((reason, index) => <Text key={index} style={styles.discoveryReason}>• {reason}</Text>)}<Text style={styles.discoveryTime}>Νεότερο γεγονός: {when(item.latestEventAt)}</Text></View>;\n}",
    'discovery score semantics',
  );

  source = replaceRequired(
    source,
    "        </View>\n        {item.thesis ? <Text style={styles.thesis}",
    "        </View>\n        {item.marketQuote?.quoteContract?.publicMessage ? <View style={styles.marketQuoteContract}><Text style={styles.marketQuoteContractText}>{item.marketQuote.quoteContract.publicMessage}</Text></View> : null}\n        {item.thesis ? <Text style={styles.thesis}",
    'research quote contract message',
  );

  source = replaceRequired(
    source,
    "productionHealthText: { color: '#617187', fontSize: 11, lineHeight: 17, marginTop: 8 }, productionMetrics:",
    "productionHealthText: { color: '#617187', fontSize: 11, lineHeight: 17, marginTop: 8 }, healthSplitText: { color: '#40536f', fontSize: 9, lineHeight: 14, fontWeight: '800', marginTop: 6 }, productionMetrics:",
    'split health style',
  );

  source = replaceRequired(
    source,
    "discoveryStatus: { color: '#0B66FF', fontSize: 10, lineHeight: 14, fontWeight: '900', marginTop: 10 }, discoveryReason:",
    "discoveryStatus: { color: '#0B66FF', fontSize: 10, lineHeight: 14, fontWeight: '900', marginTop: 10 }, discoveryDisclaimer: { color: '#6f7e92', fontSize: 9, lineHeight: 13, fontWeight: '800', marginTop: 4 }, discoveryReason:",
    'discovery disclaimer style',
  );

  source = replaceRequired(
    source,
    "ageText: { color: '#7b889d', fontSize: 9, lineHeight: 13, marginTop: 3 }, timeContext:",
    "ageText: { color: '#7b889d', fontSize: 9, lineHeight: 13, marginTop: 3 }, marketQuoteContract: { backgroundColor: '#f3f7fc', borderRadius: 12, padding: 9, marginTop: 9 }, marketQuoteContractText: { color: '#40536f', fontSize: 10, lineHeight: 15, fontWeight: '700' }, timeContext:",
    'research quote contract style',
  );

  write('src/OpportunitiesView.js', source);
}

function patchVersions() {
  const appPath = path.join(root, 'app.json');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.expo.version = '1.1.0';
  app.expo.android.versionCode = 22;
  app.expo.ios.buildNumber = '22';
  fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = '1.1.0';
  pkg.scripts = pkg.scripts || {};
  if (!String(pkg.scripts.postinstall || '').includes('apply-v110-unified-intelligence.js')) {
    pkg.scripts.postinstall = `${String(pkg.scripts.postinstall || '').trim()} && node scripts/apply-v110-unified-intelligence.js`.replace(/^\s*&&\s*/, '');
  }
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchFeedStore();
patchMarketData();
patchPortfolio();
patchOpportunities();
patchVersions();

const market = read('src/market-data.js');
const store = read('src/intelligence-feed-store.js');
const portfolio = read('PortfolioApp.js');
const opportunities = read('src/OpportunitiesView.js');
if (!market.includes('readCanonicalFeedQuotes')) throw new Error('v1.1.0 verification failed: canonical feed quote bridge');
if (market.includes('Euronext error: ${officialError.message}')) throw new Error('v1.1.0 verification failed: raw provider error leak');
if (!store.includes('quoteRegistry')) throw new Error('v1.1.0 verification failed: quote registry store');
if (!portfolio.includes("const VERSION = '1.1.0';")) throw new Error('v1.1.0 verification failed: portfolio version');
if (!opportunities.includes('Βαθμός προτεραιότητας διερεύνησης')) throw new Error('v1.1.0 verification failed: discovery score semantics');
if (!opportunities.includes('marketDataStatus')) throw new Error('v1.1.0 verification failed: split health status');
console.log('Investor Control mobile v1.1.0 unified intelligence patch applied.');
