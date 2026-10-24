const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const VERSION = '1.7.3';
const VERSION_CODE = 31;
const QUOTE_CONTRACT_VERSION = '2026-08-20.2';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`Investor Control v1.7.3 universal-integrity patch failed: missing ${label}`);
  return content.replace(from, to);
}

function replaceRegexRequired(content, pattern, replacement, sentinel, label) {
  if (sentinel && content.includes(sentinel)) return content;
  if (!pattern.test(content)) throw new Error(`Investor Control v1.7.3 universal-integrity patch failed: missing ${label}`);
  pattern.lastIndex = 0;
  return content.replace(pattern, replacement);
}

function patchQuoteContract() {
  let source = read('src/quote-contract.js');
  source = replaceRequired(
    source,
    `export const MOBILE_QUOTE_CONTRACT_VERSION = '2026-08-18.1';`,
    `import { evaluateMobileQuoteIntegrity, mobileQuotePublicMessage } from './instrument-quote-integrity';\n\nexport const MOBILE_QUOTE_CONTRACT_VERSION = '${QUOTE_CONTRACT_VERSION}';`,
    'universal quote integrity import',
  );

  source = replaceRegexRequired(
    source,
    /export function buildMobileQuoteContract\(symbol, quote = \{\}, options = \{\}\) \{[\s\S]*?\n\}\n\nexport function quoteFromRegistry/,
    `export function buildMobileQuoteContract(symbol, quote = {}, options = {}) {
  const integrity = evaluateMobileQuoteIntegrity(symbol, quote, options);
  const previousClose = positive(quote.nativePreviousClose ?? quote.previousClose);
  const dayChangeEligible = integrity.decisionReady === true
    && quote.dayChangeVerified !== false
    && quote?.quoteContract?.dayChangeEligible !== false
    && previousClose !== null;
  const diagnosticCodes = [...new Set([
    ...integrity.blockers,
    ...(previousClose === null ? ['PREVIOUS_CLOSE_NOT_VERIFIED'] : []),
    ...(Array.isArray(quote?.quoteContract?.diagnosticCodes) ? quote.quoteContract.diagnosticCodes : []),
  ])];
  return {
    version: MOBILE_QUOTE_CONTRACT_VERSION,
    integrityVersion: integrity.version,
    invariant: integrity.invariant,
    sourceRole: integrity.sourceRole,
    sourceApproved: integrity.sourceApproved,
    timestampVerified: integrity.timestampVerified,
    identityVerified: integrity.identityReady,
    valuationEligible: integrity.valuationReady,
    decisionEligible: integrity.decisionReady,
    dayChangeEligible,
    publicStatus: integrity.publicStatus,
    publicMessage: mobileQuotePublicMessage(integrity),
    diagnosticCodes,
    instrumentIntegrity: integrity,
  };
}

export function quoteFromRegistry`,
    'instrumentIntegrity: integrity',
    'universal mobile quote contract',
  );

  source = replaceRequired(
    source,
    "    nativeCurrency: entry.currency || (String(symbol).endsWith('.US') ? 'USD' : 'EUR'),",
    "    nativeCurrency: /^[A-Z]{3}$/.test(String(entry.currency || '').toUpperCase()) ? String(entry.currency).toUpperCase() : null,",
    'no inferred registry currency',
  );
  source = replaceRequired(
    source,
    "    providerSymbol: entry.appSymbol || symbol,",
    "    providerSymbol: entry.providerSymbol || entry.appSymbol || symbol,",
    'registry provider symbol lineage',
  );
  source = replaceRequired(
    source,
    "    priceTimestampVerified: inherited?.timestampVerified !== false,",
    "    priceTimestampVerified: inherited?.timestampVerified === true,",
    'registry timestamp must be explicit',
  );

  write('src/quote-contract.js', source);
}

function patchMarketData() {
  let source = read('src/market-data.js');
  source = replaceRequired(
    source,
    "import { buildMobileQuoteContract, quoteFromRegistry, safeProviderDiagnostic } from './quote-contract';",
    "import { buildMobileQuoteContract, quoteFromRegistry, safeProviderDiagnostic } from './quote-contract';\nimport { routeMobileInstrument } from './instrument-quote-integrity';",
    'market route import',
  );

  source = replaceRegexRequired(
    source,
    /const EURONEXT_ATHENS_URLS = \{[\s\S]*?\n\};/,
    "const EURONEXT_ATHENS_STOCK_URL = (ticker) => `https://athens.euronext.com/en/market-data/instruments/stocks/${encodeURIComponent(ticker)}/related`;",
    'EURONEXT_ATHENS_STOCK_URL',
    'remove Athens ticker whitelist',
  );

  source = replaceRegexRequired(
    source,
    /async function fetchOfficialAthensQuote\(symbol\) \{[\s\S]*?\n\}\n\nasync function fetchEurUsd\(\)/,
    `async function fetchOfficialAthensQuote(symbol) {
  const route = routeMobileInstrument(symbol);
  if (!route.supported || route.market !== 'GR') throw new Error('μη επαληθευμένη αγορά για επίσημη πηγή Αθήνας');
  const checkedAt = new Date();
  const exchange = exchangeState(symbol, checkedAt);
  const html = await fetchText(EURONEXT_ATHENS_STOCK_URL(route.baseSymbol));
  const text = htmlToText(html);
  const priceValue = numberAfterLabel(text, ['Last Traded Price', 'Τελευταία Τιμή Διαπραγμάτευσης']);
  const previousClose = numberAfterLabel(text, ['Previous Close', 'Προηγούμενο Κλείσιμο']);
  if (!finite(priceValue)) throw new Error(\`η Euronext Athens δεν επέστρεψε τιμή για \${route.baseSymbol}\`);
  return {
    nativePrice: priceValue,
    nativePreviousClose: finite(previousClose) ? previousClose : null,
    nativeChangeBase: finite(previousClose) ? previousClose : null,
    nativeRegularMarketPrice: priceValue,
    nativeCurrency: 'EUR',
    updatedAt: null,
    checkedAt: checkedAt.toISOString(),
    source: 'Euronext Athens — επίσημα δεδομένα με καθυστέρηση 15′',
    providerSymbol: route.baseSymbol,
    quality: 'primary_exchange_delayed',
    advertisedDelayMinutes: 15,
    session: exchange.session,
    timestampMeaning: 'exact-trade-time-not-provided-by-adapter',
    priceTimestampVerified: false,
    dayChangeVerified: false,
  };
}

async function fetchEurUsd()`,
    'exact-trade-time-not-provided-by-adapter',
    'generic official Athens adapter',
  );

  source = replaceRegexRequired(
    source,
    /async function fetchFinnhubQuote\(ticker, token\) \{[\s\S]*?\n\}\n\nexport function openFinnhubTrades/,
    `async function fetchFinnhubQuote(ticker, token) {
  if (!token) throw new Error('δεν έχει αποθηκευτεί Finnhub token');
  const payload = await fetchJson(
    \`https://finnhub.io/api/v1/quote?symbol=\${encodeURIComponent(ticker)}&token=\${encodeURIComponent(token)}\`,
  );
  if (!finite(payload?.c)) throw new Error('το Finnhub δεν επέστρεψε έγκυρη τιμή');
  const timestampVerified = finite(payload?.t);
  const timestamp = timestampVerified ? Number(payload.t) : null;
  const checkedAt = new Date();
  return {
    nativePrice: Number(payload.c),
    nativePreviousClose: finite(payload.pc) ? Number(payload.pc) : null,
    nativeChangeBase: finite(payload.pc) ? Number(payload.pc) : null,
    nativeRegularMarketPrice: Number(payload.c),
    nativeProviderChangePct: Number.isFinite(Number(payload?.dp)) ? Number(payload.dp) : null,
    nativeCurrency: 'USD',
    updatedAt: timestampVerified ? new Date(timestamp * 1000).toISOString() : null,
    checkedAt: checkedAt.toISOString(),
    source: 'Finnhub US quote',
    providerSymbol: ticker,
    quality: 'realtime',
    priceTimestampVerified: timestampVerified,
    session: timestampVerified ? marketSessionAt(\`\${ticker}.US\`, new Date(timestamp * 1000)) : marketSessionAt(\`\${ticker}.US\`, checkedAt),
  };
}

export function openFinnhubTrades`,
    'const timestampVerified = finite(payload?.t);',
    'no fabricated Finnhub timestamp',
  );

  source = replaceRegexRequired(
    source,
    /export function classifyQuote\(symbol, quote\) \{[\s\S]*?\n\}\n\nfunction quoteTimestamp/,
    `export function classifyQuote(symbol, quote) {
  if (!quote || !finite(quote.nativePrice)) return quote;
  const exchange = exchangeState(symbol);
  const quoteContract = buildMobileQuoteContract(symbol, quote, { now: Date.now() });
  const updatedMs = new Date(quote.updatedAt || 0).getTime();
  const ageSeconds = Number.isFinite(updatedMs) && updatedMs > 0
    ? Math.max(0, Math.round((Date.now() - updatedMs) / 1000))
    : null;
  let status = 'unverified';
  if (quoteContract.publicStatus === 'STALE') status = 'stale';
  else if (quoteContract.publicStatus === 'FALLBACK_NOT_VERIFIED' || quoteContract.publicStatus === 'INSTRUMENT_UNVERIFIED' || quoteContract.publicStatus === 'UNAVAILABLE') status = 'unverified';
  else if (!exchange.open) {
    if (quote.session === 'pre-market') status = 'pre-market';
    else if (quote.session === 'post-market') status = 'post-market';
    else status = 'closed';
  } else if (quoteContract.publicStatus === 'TIMESTAMP_NOT_VERIFIED' || quoteContract.sourceRole === 'PRIMARY_EXCHANGE') status = 'delayed';
  else status = quote.quality === 'realtime' ? 'live' : 'near-live';

  return {
    ...quote,
    ageSeconds,
    status,
    exchangeOpen: exchange.open,
    quoteContract,
    instrumentIntegrity: quoteContract.instrumentIntegrity,
    usable: quoteContract.valuationEligible === true,
    dayChangeVerified: quoteContract.dayChangeEligible === true,
  };
}

function quoteTimestamp`,
    'instrumentIntegrity: quoteContract.instrumentIntegrity',
    'universal quote classification',
  );

  source = replaceRequired(
    source,
    "  const value = new Date(quote?.updatedAt || 0).getTime();",
    "  const value = new Date(quote?.updatedAt || quote?.checkedAt || 0).getTime();",
    'observation timestamp fallback',
  );

  source = replaceRegexRequired(
    source,
    /function applyFx\(symbol, quote, fx\) \{[\s\S]*?\n\}\n\nasync function fetchNativeQuote/,
    `function applyFx(symbol, quote, fx) {
  const route = routeMobileInstrument(symbol);
  if (!route.supported) throw new Error('MARKET_ROUTE_UNVERIFIED');
  const nativeCurrency = String(quote?.nativeCurrency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(nativeCurrency)) throw new Error('CURRENCY_NOT_VERIFIED');
  if (route.expectedCurrency !== nativeCurrency) throw new Error('QUOTE_CURRENCY_MISMATCH');
  if (nativeCurrency === 'EUR') {
    return {
      ...quote,
      price: Number(quote.nativePrice),
      previousClose: quote.nativePreviousClose == null ? null : Number(quote.nativePreviousClose),
      currency: 'EUR',
      nativeCurrency,
      fxRate: 1,
      fxUpdatedAt: null,
    };
  }
  if (nativeCurrency !== 'USD') throw new Error('UNSUPPORTED_NATIVE_CURRENCY');
  if (!finite(fx?.rate)) throw new Error('λείπει η ισοτιμία EUR/USD');
  return {
    ...quote,
    price: Number(quote.nativePrice) / Number(fx.rate),
    previousClose: quote.nativePreviousClose == null ? null : Number(quote.nativePreviousClose) / Number(fx.rate),
    currency: 'EUR',
    nativeCurrency,
    fxRate: Number(fx.rate),
    fxUpdatedAt: fx.updatedAt,
  };
}

async function fetchNativeQuote`,
    "throw new Error('MARKET_ROUTE_UNVERIFIED');",
    'no inferred native currency',
  );

  source = replaceRegexRequired(
    source,
    /async function fetchNativeQuote\(symbol, finnhubToken\) \{[\s\S]*?\n\}\n\nexport async function fetchPortfolioQuotes/,
    `async function fetchNativeQuote(symbol, finnhubToken) {
  const route = routeMobileInstrument(symbol);
  if (!route.supported) throw new Error(route.blocker || 'MARKET_ROUTE_UNVERIFIED');

  if (route.market === 'US') {
    if (finnhubToken) {
      const licensed = await fetchFinnhubQuote(route.baseSymbol, finnhubToken).catch(() => null);
      if (licensed) return licensed;
    }
    return await fetchYahooQuote(route.baseSymbol);
  }

  if (route.market === 'GR') {
    try {
      return await fetchOfficialAthensQuote(symbol);
    } catch (officialError) {
      const fallback = await fetchYahooQuote(\`\${route.baseSymbol}.AT\`);
      return {
        ...fallback,
        nativeCurrency: 'EUR',
        source: fallback.source,
        userNotice: 'Η επίσημη πηγή Euronext Athens δεν ήταν διαθέσιμη. Η εφεδρική τιμή είναι μόνο πληροφοριακή.',
        providerDiagnostic: safeProviderDiagnostic(officialError, 'OFFICIAL_ATHENS_QUOTE_UNAVAILABLE'),
      };
    }
  }

  throw new Error('MARKET_ROUTE_UNVERIFIED');
}

export async function fetchPortfolioQuotes`,
    "if (route.market === 'US')",
    'market-based quote routing',
  );

  source = replaceRequired(
    source,
    "  if (quote.status === 'closed') return 'Τιμή κλεισίματος';\n  return 'Παρωχημένη τιμή — δεν υπολογίζεται';",
    "  if (quote.status === 'closed') return quote?.quoteContract?.timestampVerified === false ? 'Επίσημη αναφορά · χρόνος μη επιβεβαιωμένος' : 'Τιμή κλεισίματος';\n  if (quote.status === 'unverified') return 'Μη επαληθευμένη — δεν υπολογίζεται';\n  return 'Παρωχημένη τιμή — δεν υπολογίζεται';",
    'unverified quote status',
  );

  write('src/market-data.js', source);
}

function patchPortfolioIntegrity() {
  let source = read('PortfolioApp.js');
  source = replaceRequired(
    source,
    "import {\n  FINNHUB_TOKEN_KEY,",
    "import { routeMobileInstrument } from './src/instrument-quote-integrity';\nimport {\n  FINNHUB_TOKEN_KEY,",
    'portfolio market route import',
  );

  source = replaceRequired(
    source,
    "      const quote = state.prices[position.symbol];\n      const usable = quote?.usable === true;",
    "      const quote = state.prices[position.symbol];\n      const route = routeMobileInstrument(position.symbol);\n      const positionCurrencyVerified = route.supported === true && route.expectedCurrency === position.currency;\n      const usable = quote?.usable === true && positionCurrencyVerified;",
    'position currency and market integrity',
  );

  source = replaceRequired(
    source,
    "        quote,\n        nativePrice,",
    "        quote,\n        instrumentRoute: route,\n        positionCurrencyVerified,\n        instrumentIntegrityWarning: !route.supported\n          ? 'Η αγορά αυτού του προϊόντος δεν έχει ακόμη επαληθευμένο αυτόματο route. Η θέση παραμένει αποθηκευμένη χωρίς αυτόματη αποτίμηση.'\n          : !positionCurrencyVerified\n            ? `Το δηλωμένο νόμισμα (${position.currency}) δεν συμφωνεί με την επαληθευμένη αγορά (${route.expectedCurrency}). Η θέση δεν αποτιμάται αυτόματα.`\n            : null,\n        nativePrice,",
    'position integrity lineage',
  );

  source = replaceRequired(
    source,
    "          {stale ? <Text style={styles.warning}>Η τιμή είναι παρωχημένη και δεν χρησιμοποιείται στη συνολική αποτίμηση.</Text> : null}",
    "          {item.instrumentIntegrityWarning ? <Text style={styles.warning}>{item.instrumentIntegrityWarning}</Text> : null}\n          {stale && !item.instrumentIntegrityWarning ? <Text style={styles.warning}>Η τιμή είναι παρωχημένη ή μη επαληθευμένη και δεν χρησιμοποιείται στη συνολική αποτίμηση.</Text> : null}",
    'position integrity warning',
  );

  source = source.replace("const VERSION = '1.7.2';", `const VERSION = '${VERSION}';`);
  write('PortfolioApp.js', source);

  let decision = read('DecisionOverlay.js');
  decision = decision.replace("const VERSION = '1.7.2';", `const VERSION = '${VERSION}';`);
  write('DecisionOverlay.js', decision);
}

function patchVersions() {
  const appPath = path.join(root, 'app.json');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.expo = app.expo || {};
  app.expo.android = app.expo.android || {};
  app.expo.ios = app.expo.ios || {};
  app.expo.version = VERSION;
  app.expo.android.versionCode = VERSION_CODE;
  app.expo.ios.buildNumber = String(VERSION_CODE);
  fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = VERSION;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchQuoteContract();
patchMarketData();
patchPortfolioIntegrity();
patchVersions();

const market = read('src/market-data.js');
const portfolio = read('PortfolioApp.js');
const decision = read('DecisionOverlay.js');
const quoteContract = read('src/quote-contract.js');
const app = JSON.parse(read('app.json'));
const pkg = JSON.parse(read('package.json'));

if (market.includes('EURONEXT_ATHENS_URLS')) throw new Error('v1.7.3 verification failed: Athens ticker whitelist still present');
if (market.includes("symbol === 'SPCE.US'")) throw new Error('v1.7.3 verification failed: SPCE ticker special-case still present');
if (!market.includes("if (route.market === 'US')")) throw new Error('v1.7.3 verification failed: universal US routing missing');
if (!market.includes("if (route.market === 'GR')")) throw new Error('v1.7.3 verification failed: universal Athens routing missing');
if (market.includes("quote?.nativeCurrency || (symbol.endsWith('.US') ? 'USD' : 'EUR')")) throw new Error('v1.7.3 verification failed: inferred currency fallback remains');
if (!quoteContract.includes(`MOBILE_QUOTE_CONTRACT_VERSION = '${QUOTE_CONTRACT_VERSION}'`)) throw new Error('v1.7.3 verification failed: quote contract version mismatch');
if (!quoteContract.includes('evaluateMobileQuoteIntegrity')) throw new Error('v1.7.3 verification failed: universal quote gate not connected');
if (!portfolio.includes('positionCurrencyVerified')) throw new Error('v1.7.3 verification failed: position currency gate missing');
if (!portfolio.includes(`const VERSION = '${VERSION}';`) || !decision.includes(`const VERSION = '${VERSION}';`)) throw new Error('v1.7.3 verification failed: runtime version mismatch');
if (app.expo.version !== VERSION || app.expo.android.versionCode !== VERSION_CODE || pkg.version !== VERSION) throw new Error('v1.7.3 verification failed: app identity mismatch');

console.log(`Investor Control mobile ${VERSION} build ${VERSION_CODE}: universal instrument and quote integrity applied.`);
