const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.2.2 consistency patch failed: missing ${label}`);
  return content.replace(from, to);
}

function replaceRegexRequired(content, pattern, replacement, sentinel, label) {
  if (sentinel && content.includes(sentinel)) return content;
  if (!pattern.test(content)) throw new Error(`v1.2.2 consistency patch failed: missing ${label}`);
  pattern.lastIndex = 0;
  return content.replace(pattern, replacement);
}

function patchMarketData() {
  let source = read('src/market-data.js');

  const officialAthens = `async function fetchOfficialAthensQuote(symbol) {
  const configuredUrl = EURONEXT_ATHENS_URLS[symbol];
  if (!configuredUrl) throw new Error(\`δεν έχει οριστεί επίσημη πηγή Euronext Athens για \${symbol}\`);
  const checkedAt = new Date();
  const exchange = exchangeState(symbol, checkedAt);
  const providerSymbol = symbol.replace(/\\.GR$/, '');
  const baseUrl = \`https://athens.euronext.com/en/market-data/instruments/stocks/\${encodeURIComponent(providerSymbol)}\`;
  const urls = [...new Set([configuredUrl, \`\${baseUrl}/related\`, baseUrl])];
  let lastError = null;

  for (const url of urls) {
    try {
      const html = await fetchText(url);
      const text = htmlToText(html);
      const priceValue = numberAfterLabel(text, ['Last Traded Price', 'Τελευταία Τιμή Διαπραγμάτευσης']);
      const previousClose = numberAfterLabel(text, ['Previous Close', 'Προηγούμενο Κλείσιμο']);
      if (!finite(priceValue) || Number(priceValue) <= 0) {
        lastError = new Error(\`η επίσημη σελίδα δεν επέστρεψε τιμή για \${symbol}\`);
        continue;
      }
      return {
        nativePrice: priceValue,
        nativePreviousClose: finite(previousClose) && Number(previousClose) > 0 ? previousClose : null,
        nativeChangeBase: finite(previousClose) && Number(previousClose) > 0 ? previousClose : null,
        nativeRegularMarketPrice: priceValue,
        nativeCurrency: 'EUR',
        updatedAt: checkedAt.toISOString(),
        checkedAt: checkedAt.toISOString(),
        source: 'Euronext Athens delayed market data',
        sourceUrl: url,
        providerSymbol,
        quality: 'delayed15',
        sourceQuality: 'OFFICIAL_DELAYED',
        advertisedDelayMinutes: 15,
        session: exchange.session,
        timestampMeaning: 'retrieval-time-for-official-delayed-value',
        priceTimestampVerified: false,
        dayChangeVerified: finite(previousClose) && Number(previousClose) > 0,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(\`η Euronext Athens δεν επέστρεψε τιμή για \${symbol}\`);
}`;

  source = replaceRegexRequired(
    source,
    /async function fetchOfficialAthensQuote\(symbol\) \{[\s\S]*?\n\}\n\nasync function fetchEurUsd\(\)/,
    `${officialAthens}\n\nasync function fetchEurUsd()`,
    'const urls = [...new Set([configuredUrl',
    'resilient official Athens quote adapter',
  );

  source = replaceRequired(
    source,
    "  const quoteContract = buildMobileQuoteContract(symbol, { ...quote, ageSeconds, status }, { now: Date.now() });",
    "  const quoteContract = buildMobileQuoteContract(symbol, { ...quote, ageSeconds, status, exchangeOpen: exchange.open }, { now: Date.now() });",
    'exchange state passed to quote contract',
  );

  write('src/market-data.js', source);
}

function patchPortfolio() {
  let source = read('PortfolioApp.js');
  source = replaceRequired(source, "const VERSION = '1.2.1';", "const VERSION = '1.2.2';", 'Portfolio version');

  source = replaceRequired(
    source,
    "  if (contractStatus === 'FALLBACK_NOT_VERIFIED') return 'Εφεδρική / μη επιβεβαιωμένη';\n  if (contractStatus === 'TIMESTAMP_NOT_VERIFIED') return 'Χρόνος μη επιβεβαιωμένος';\n  if (contractStatus === 'STALE' || status === 'stale' || quote.usable === false) return 'Παρωχημένη / μη χρησιμοποιήσιμη';",
    "  if (contractStatus === 'FALLBACK_NOT_VERIFIED') return 'Εφεδρική / μη επιβεβαιωμένη';\n  if (contractStatus === 'VERIFIED_CLOSE') return 'Επιβεβ. τιμή κλεισίματος';\n  if (contractStatus === 'VERIFIED_REFERENCE') return 'Επιβεβ. τιμή αναφοράς';\n  if (contractStatus === 'OFFICIAL_DELAYED_OR_EXCHANGE') return 'Επίσημη καθυστερημένη';\n  if (contractStatus === 'TIMESTAMP_NOT_VERIFIED') return 'Χρόνος μη επιβεβαιωμένος';\n  if (contractStatus === 'STALE' || status === 'stale' || quote.usable === false) return 'Παρωχημένη / μη χρησιμοποιήσιμη';",
    'human quote quality labels',
  );

  source = source.replace(
    '<Text style={styles.muted}>Τρέχουσα τιμή</Text>',
    '<Text style={styles.muted}>{item.quote?.quoteContract?.publicStatus === \'VERIFIED_CLOSE\' ? \'Τελευταία επιβεβ. τιμή κλεισίματος\' : item.quote?.quoteContract?.publicStatus === \'VERIFIED_REFERENCE\' ? \'Επιβεβ. τιμή αναφοράς\' : \'Τρέχουσα τιμή\'}</Text>',
  );

  write('PortfolioApp.js', source);

  let decision = read('DecisionOverlay.js');
  decision = replaceRequired(decision, "const VERSION = '1.2.1';", "const VERSION = '1.2.2';", 'Decision version');
  write('DecisionOverlay.js', decision);
}

function patchOpportunities() {
  let source = read('src/OpportunitiesView.js');

  source = source.replace('<Text style={styles.muted}>Τιμή αναφοράς</Text>', '<Text style={styles.muted}>Τιμή αναφοράς ανάλυσης</Text>');
  source = source.replace(
    "<Text style={styles.ageText}>{Number.isFinite(Number(item.referencePriceAgeHours)) ? `πριν από ${Number(item.referencePriceAgeHours).toFixed(1)} ώρες` : 'χρόνος μη διαθέσιμος'}</Text>",
    "<Text style={styles.ageText}>{Number.isFinite(Number(item.referencePriceAgeHours)) ? `χρησιμοποιήθηκε στην ανάλυση πριν από ${Number(item.referencePriceAgeHours).toFixed(1)} ώρες` : 'χρόνος ανάλυσης μη διαθέσιμος'} · μπορεί να διαφέρει από την τρέχουσα τιμή χαρτοφυλακίου</Text>",
  );

  source = replaceRequired(
    source,
    "<Text style={styles.connectionText}>{feed ? `${freshness.label} · ηλικία ${freshness.ageHours.toFixed(1)} ωρών · δημιουργία ${when(feed.generatedAt)}` : 'Δεν έχει ληφθεί ακόμη έγκυρη ροή.'}</Text>",
    "<Text style={styles.connectionText}>{feed ? `Έρευνα: ${freshness.label} · δημιουργία ${when(feed.generatedAt)} · ηλικία ${freshness.ageHours.toFixed(1)} ωρών` : 'Δεν έχει ληφθεί ακόμη έγκυρη ροή.'}</Text>",
    'separate research generation time',
  );
  source = source.replace('Τελευταίος επιτυχής συγχρονισμός:', 'Συγχρονισμός συσκευής:');

  source = source.replace(
    "{productionReady ? 'Πλήρης αυτοματοποιημένη λειτουργία' : 'Περιορισμένη λειτουργία — χωρίς αυθαίρετα σήματα'}",
    "{productionReady ? 'Πλήρης αυτοματοποιημένη λειτουργία' : 'Περιορισμένα διαθέσιμα δεδομένα'}",
  );
  source = source.replace(
    "{productionReady ? 'OPERATIONAL' : 'DEGRADED'}",
    "{productionReady ? 'ΕΝΗΜΕΡΩΜΕΝΟ' : 'ΠΕΡΙΟΡΙΣΜΕΝΑ'}",
  );
  source = source.replace(
    "<Text style={styles.healthSplitText}>Υποδομή: {operationalHealth?.infrastructureStatus || '—'} · Αγορά: {operationalHealth?.marketDataStatus || '—'} · Θεμελιώδη: {operationalHealth?.fundamentalsStatus || '—'} · Αποφάσεις: {operationalHealth?.decisionEngineStatus || '—'}</Text>",
    "<Text style={styles.healthSplitText}>Δεν εμφανίζεται τελική αγορά ή πώληση όσο λείπει οποιοδήποτε υποχρεωτικό στοιχείο τεκμηρίωσης.</Text>",
  );

  const discoveryFunction = /function DiscoveryRadarCard\(\{ item \}\) \{[\s\S]*?\n\}/;
  if (discoveryFunction.test(source)) {
    source = source.replace(discoveryFunction, `function DiscoveryRadarCard({ item }) {
  const score = Math.round(Number(item.discoveryScore || 0));
  const priorityLabel = score >= 85 ? 'Πολύ υψηλή' : score >= 65 ? 'Υψηλή' : score >= 40 ? 'Μέτρια' : 'Χαμηλή';
  return <View style={styles.discoveryCard}><View style={styles.rowTop}><View style={styles.grow}><Text style={styles.company}>{item.companyName}</Text><Text style={styles.symbol}>{item.symbol || '—'} · {item.exchange || '—'}</Text></View><View style={styles.discoveryPriorityBadge}><Text style={styles.discoveryPriorityLabel}>Προτεραιότητα έρευνας</Text><Text style={styles.discoveryPriorityValue}>{priorityLabel}</Text></View></View><Text style={styles.discoveryStatus}>ΑΥΤΟΜΑΤΗ ΑΝΑΚΑΛΥΨΗ · ΟΧΙ ΑΚΟΜΗ ΠΡΟΤΑΣΗ ΑΓΟΡΑΣ</Text><Text style={styles.discoveryDisclaimer}>Η προτεραιότητα αφορά μόνο τη σειρά διερεύνησης — δεν είναι βαθμολογία επένδυσης.</Text>{(item.reasons || []).slice(0, 3).map((reason, index) => <Text key={index} style={styles.discoveryReason}>• {reason}</Text>)}<Text style={styles.discoveryTime}>Νεότερο γεγονός: {when(item.latestEventAt)}</Text></View>;
}`);
  } else if (!source.includes('Προτεραιότητα έρευνας')) {
    throw new Error('v1.2.2 consistency patch failed: discovery card not found');
  }

  if (!source.includes('discoveryPriorityBadge:')) {
    source = replaceRequired(
      source,
      "discoveryScore: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#0B66FF', alignItems: 'center', justifyContent: 'center' },",
      "discoveryScore: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#0B66FF', alignItems: 'center', justifyContent: 'center' }, discoveryPriorityBadge: { minWidth: 128, maxWidth: 150, borderRadius: 16, backgroundColor: '#edf4ff', paddingHorizontal: 10, paddingVertical: 8, alignItems: 'flex-end' }, discoveryPriorityLabel: { color: '#6f7e92', fontSize: 8, lineHeight: 11, fontWeight: '800', textAlign: 'right' }, discoveryPriorityValue: { color: '#0B66FF', fontSize: 13, lineHeight: 17, fontWeight: '900', marginTop: 2, textAlign: 'right' },",
      'discovery priority styles',
    );
  }

  write('src/OpportunitiesView.js', source);
}

function patchVersions() {
  const appPath = path.join(root, 'app.json');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.expo.version = '1.2.2';
  app.expo.android.versionCode = 25;
  app.expo.ios.buildNumber = '25';
  fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = '1.2.2';
  pkg.scripts = pkg.scripts || {};
  if (!String(pkg.scripts.postinstall || '').includes('apply-v122-market-data-consistency.js')) {
    pkg.scripts.postinstall = `${String(pkg.scripts.postinstall || '').trim()} && node scripts/apply-v122-market-data-consistency.js`.replace(/^\s*&&\s*/, '');
  }
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchMarketData();
patchPortfolio();
patchOpportunities();
patchVersions();

const market = read('src/market-data.js');
const portfolio = read('PortfolioApp.js');
const opportunities = read('src/OpportunitiesView.js');
const contract = read('src/quote-contract.js');
if (!market.includes('const urls = [...new Set([configuredUrl')) throw new Error('v1.2.2 verification failed: Athens URL retry chain');
if (!market.includes('exchangeOpen: exchange.open')) throw new Error('v1.2.2 verification failed: exchange state contract');
if (!portfolio.includes("const VERSION = '1.2.2';")) throw new Error('v1.2.2 verification failed: Portfolio version');
if (!portfolio.includes('Επιβεβ. τιμή κλεισίματος')) throw new Error('v1.2.2 verification failed: closing quote label');
if (!opportunities.includes('Τιμή αναφοράς ανάλυσης')) throw new Error('v1.2.2 verification failed: analysis reference label');
if (!opportunities.includes('Προτεραιότητα έρευνας')) throw new Error('v1.2.2 verification failed: discovery priority semantics');
if (!opportunities.includes('Συγχρονισμός συσκευής:')) throw new Error('v1.2.2 verification failed: sync/report split');
if (!contract.includes("MOBILE_QUOTE_CONTRACT_VERSION = '2026-08-07.1'")) throw new Error('v1.2.2 verification failed: quote contract version');
if (!contract.includes('valuationMaxAgeHours')) throw new Error('v1.2.2 verification failed: valuation/decision freshness split');
console.log('Investor Control v1.2.2 market-data consistency and mobile clarity applied.');
