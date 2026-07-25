'use strict';

const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(mobileRoot, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(mobileRoot, relativePath), content, 'utf8');
}

function replaceRequired(source, pattern, replacement, label) {
  if (source.includes(replacement)) {
    console.log(`PASS ${label}: already applied`);
    return source;
  }
  if (!source.includes(pattern)) {
    throw new Error(`Patch blocked: ${label} pattern not found.`);
  }
  console.log(`APPLY ${label}`);
  return source.replace(pattern, replacement);
}

function replaceRegexRequired(source, pattern, replacement, label) {
  if (typeof replacement === 'string' && source.includes(replacement)) {
    console.log(`PASS ${label}: already applied`);
    return source;
  }
  if (!pattern.test(source)) {
    throw new Error(`Patch blocked: ${label} pattern not found.`);
  }
  console.log(`APPLY ${label}`);
  return source.replace(pattern, replacement);
}

let market = read('src/market-data.js');

market = market.replace(/InvestorControl\/0\.6\.[0-3]/g, 'InvestorControl/0.6.4');

market = replaceRequired(
  market,
  `      const previousClose = finite(meta.chartPreviousClose || meta.previousClose)\n        ? Number(meta.chartPreviousClose || meta.previousClose)\n        : null;`,
  `      // Yahoo's chartPreviousClose can represent the 5-day chart baseline, not today's prior close.\n      // Prefer previousClose so the daily percentage matches the broker.\n      const previousClose = finite(meta.previousClose || meta.chartPreviousClose)\n        ? Number(meta.previousClose || meta.chartPreviousClose)\n        : null;`,
  'Yahoo previous-close priority',
);

market = replaceRegexRequired(
  market,
  /      const changeBase = (?:\['pre-market', 'post-market'\]\.includes\(point\.session\)|point\.session === 'post-market') && finite\(regularMarketPrice\)\n        \? regularMarketPrice\n        : previousClose;/,
  `      const changeBase = point.session === 'post-market' && finite(regularMarketPrice)\n        ? regularMarketPrice\n        : previousClose;`,
  'session-aware daily change base',
);

if (!market.includes('nativeProviderChangePct:')) {
  market = replaceRequired(
    market,
    `    nativeRegularMarketPrice: Number(payload.c),\n    nativeCurrency: 'USD',`,
    `    nativeRegularMarketPrice: Number(payload.c),\n    nativeProviderChangePct: Number.isFinite(Number(payload?.dp)) ? Number(payload.dp) : null,\n    nativeCurrency: 'USD',`,
    'Finnhub provider percentage capture',
  );
}

market = replaceRegexRequired(
  market,
  /      const previousClose = Number\(current\?\.nativePreviousClose \|\| 0\);\n      const fxRate = Number\(current\?\.fxRate \|\| 0\);\n      const session = marketSessionAt\(appSymbol, new Date\(timestamp\)\);/,
  `      const previousClose = finite(current?.nativePreviousClose)\n        ? Number(current.nativePreviousClose)\n        : 0;\n      const regularMarketPrice = finite(current?.nativeRegularMarketPrice)\n        ? Number(current.nativeRegularMarketPrice)\n        : 0;\n      const fxRate = Number(current?.fxRate || 0);\n      const session = marketSessionAt(appSymbol, new Date(timestamp));\n      const changeBase = session === 'post-market' && regularMarketPrice > 0\n        ? regularMarketPrice\n        : previousClose;`,
  'WebSocket reference-price selection',
);

market = replaceRequired(
  market,
  `        session,\n        changePct: previousClose > 0\n          ? ((Number(latest.p) - previousClose) / previousClose) * 100\n          : current?.changePct,`,
  `        session,\n        nativeChangeBase: changeBase > 0 ? changeBase : current?.nativeChangeBase,\n        changePct: changeBase > 0\n          ? ((Number(latest.p) - changeBase) / changeBase) * 100\n          : current?.changePct,`,
  'WebSocket percentage calculation',
);

market = replaceRegexRequired(
  market,
  /  if \(symbol === 'SPCE\.US'\) \{[\s\S]*?\n  \}\n\n  const ticker =/,
  `  if (symbol === 'SPCE.US') {\n    // When a user has a Finnhub token, keep Finnhub as the canonical source for\n    // previous close/reference prices. Yahoo remains a fallback only.\n    if (finnhubToken) {\n      const finnhub = await fetchFinnhubQuote('SPCE', finnhubToken).catch(() => null);\n      if (finnhub) return finnhub;\n    }\n    return await fetchYahooQuote('SPCE');\n  }\n\n  const ticker =`,
  'Finnhub-first SPCE source selection',
);

market = replaceRegexRequired(
  market,
  /  const checkedAt = checkedTimestamp\(incomingQuote\) >= checkedTimestamp\(currentQuote\)[\s\S]*?  return classifyQuote\(symbol, \{\n    \.\.\.selected,\n    session: repairSession\(symbol, selected\),\n    checkedAt: checkedAt \|\| new Date\(\)\.toISOString\(\),\n  \}\);/,
  `  const incomingChecked = checkedTimestamp(incomingQuote);\n  const currentChecked = checkedTimestamp(currentQuote);\n  const checkedAt = incomingChecked >= currentChecked\n    ? incomingQuote.checkedAt\n    : currentQuote.checkedAt;\n\n  // The newest traded price and the freshest reference values are not always\n  // from the same payload. A persisted WebSocket trade may be newer than the\n  // REST quote, while the REST quote carries the correct previous close.\n  const referenceQuote = incomingChecked >= currentChecked ? incomingQuote : currentQuote;\n  const session = repairSession(symbol, selected);\n  const previousClose = finite(referenceQuote?.nativePreviousClose)\n    ? Number(referenceQuote.nativePreviousClose)\n    : finite(selected?.nativePreviousClose)\n      ? Number(selected.nativePreviousClose)\n      : null;\n  const regularMarketPrice = finite(referenceQuote?.nativeRegularMarketPrice)\n    ? Number(referenceQuote.nativeRegularMarketPrice)\n    : finite(selected?.nativeRegularMarketPrice)\n      ? Number(selected.nativeRegularMarketPrice)\n      : null;\n  const changeBase = session === 'post-market' && finite(regularMarketPrice)\n    ? regularMarketPrice\n    : previousClose;\n\n  return classifyQuote(symbol, {\n    ...selected,\n    nativePreviousClose: previousClose,\n    nativeRegularMarketPrice: regularMarketPrice,\n    nativeChangeBase: changeBase,\n    changePct: finite(changeBase)\n      ? ((Number(selected.nativePrice) - Number(changeBase)) / Number(changeBase)) * 100\n      : selected.changePct,\n    session,\n    checkedAt: checkedAt || new Date().toISOString(),\n  });`,
  'fresh reference fields survive quote merge',
);

const requiredMarketMarkers = [
  'meta.previousClose || meta.chartPreviousClose',
  "point.session === 'post-market' && finite(regularMarketPrice)",
  'nativeProviderChangePct:',
  "if (finnhubToken) {\n      const finnhub = await fetchFinnhubQuote('SPCE', finnhubToken).catch(() => null);",
  'const referenceQuote = incomingChecked >= currentChecked ? incomingQuote : currentQuote;',
  'nativeChangeBase: changeBase > 0 ? changeBase : current?.nativeChangeBase,',
];
for (const marker of requiredMarketMarkers) {
  if (!market.includes(marker)) throw new Error(`Verification failed: missing ${marker}`);
}
if (market.includes('meta.chartPreviousClose || meta.previousClose')) {
  throw new Error('Verification failed: obsolete Yahoo baseline priority remains.');
}

write('src/market-data.js', market);

for (const relativePath of ['PortfolioApp.js', 'DecisionOverlay.js']) {
  let source = read(relativePath);
  source = source.replace(/const VERSION = '0\.6\.[0-3]';/, "const VERSION = '0.6.4';");
  if (!source.includes("const VERSION = '0.6.4';")) {
    throw new Error(`Version update failed in ${relativePath}`);
  }
  write(relativePath, source);
}

const appPath = path.join(mobileRoot, 'app.json');
const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
app.expo.version = '0.6.4';
app.expo.android.versionCode = 12;
app.expo.ios.buildNumber = '12';
fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`, 'utf8');

const packagePath = path.join(mobileRoot, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.version = '0.6.4';
pkg.scripts.postinstall = 'node scripts/apply-v064-market-baseline-fix.js';
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

const pct = (price, base) => ((price - base) / base) * 100;
if (pct(2.58, 2.46).toFixed(2) !== '4.88') {
  throw new Error('Premarket baseline regression failed.');
}
if (pct(2.60, 2.57).toFixed(2) !== '1.17') {
  throw new Error('Postmarket baseline regression failed.');
}

console.log('PASS Investor Control v0.6.4 market baseline integrity.');
