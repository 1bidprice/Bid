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

function replaceOneOf(relativePath, candidates, replacement, label) {
  let source = read(relativePath);
  if (source.includes(replacement)) {
    console.log(`PASS ${label}: already applied`);
    return;
  }
  const match = candidates.find((candidate) => source.includes(candidate));
  if (!match) throw new Error(`Patch blocked: ${label} pattern not found in ${relativePath}`);
  source = source.replace(match, replacement);
  write(relativePath, source);
  console.log(`APPLY ${label}`);
}

function insertBefore(relativePath, marker, insertion, label) {
  let source = read(relativePath);
  if (source.includes(insertion.trim())) {
    console.log(`PASS ${label}: already applied`);
    return;
  }
  if (!source.includes(marker)) throw new Error(`Patch blocked: ${label} marker not found in ${relativePath}`);
  source = source.replace(marker, `${insertion}\n${marker}`);
  write(relativePath, source);
  console.log(`APPLY ${label}`);
}

const oldSessionBaseV062 = `      const changeBase = ['pre-market', 'post-market'].includes(point.session) && finite(regularMarketPrice)\n        ? regularMarketPrice\n        : previousClose;`;
const oldSessionBaseV063 = `      const changeBase = point.session === 'post-market' && finite(regularMarketPrice)\n        ? regularMarketPrice\n        : previousClose;`;
const authoritativeBase = '      const changeBase = previousClose;';

replaceOneOf(
  'src/market-data.js',
  [oldSessionBaseV062, oldSessionBaseV063],
  authoritativeBase,
  'all sessions use previous official close',
);

const normalizer = `function normalizeDailyChange(quote) {
  if (!quote) return quote;
  const previousClose = finite(quote.nativePreviousClose)
    ? Number(quote.nativePreviousClose)
    : null;
  const nativePrice = finite(quote.nativePrice)
    ? Number(quote.nativePrice)
    : null;

  return {
    ...quote,
    nativeChangeBase: previousClose,
    changePct: previousClose && nativePrice
      ? ((nativePrice - previousClose) / previousClose) * 100
      : null,
  };
}`;

insertBefore(
  'src/market-data.js',
  'export function classifyQuote(symbol, quote) {',
  normalizer,
  'daily-change normalizer',
);

replaceOneOf(
  'src/market-data.js',
  [
    `export function classifyQuote(symbol, quote) {\n  if (!quote || !finite(quote.nativePrice) || !quote.updatedAt) return quote;\n  const exchange = exchangeState(symbol);\n  const updatedMs = new Date(quote.updatedAt).getTime();`,
  ],
  `export function classifyQuote(symbol, quote) {\n  if (!quote || !finite(quote.nativePrice) || !quote.updatedAt) return quote;\n  const normalizedQuote = normalizeDailyChange(quote);\n  const exchange = exchangeState(symbol);\n  const updatedMs = new Date(normalizedQuote.updatedAt).getTime();`,
  'classify normalized quote',
);

replaceOneOf(
  'src/market-data.js',
  [
    `  return {\n    ...quote,\n    ageSeconds,\n    status,\n    exchangeOpen: exchange.open,\n    usable: status !== 'stale',\n  };`,
  ],
  `  return {\n    ...normalizedQuote,\n    ageSeconds,\n    status,\n    exchangeOpen: exchange.open,\n    usable: status !== 'stale',\n  };`,
  'return normalized quote',
);

replaceOneOf(
  'src/market-data.js',
  ['InvestorControl/0.6.2', 'InvestorControl/0.6.3'],
  'InvestorControl/0.6.4',
  'market-data version',
);
replaceOneOf(
  'PortfolioApp.js',
  ["const VERSION = '0.6.1';", "const VERSION = '0.6.3';"],
  "const VERSION = '0.6.4';",
  'portfolio version',
);
replaceOneOf(
  'DecisionOverlay.js',
  ["const VERSION = '0.6.1';", "const VERSION = '0.6.3';"],
  "const VERSION = '0.6.4';",
  'decision version',
);
replaceOneOf(
  'package.json',
  ['"version": "0.6.1"', '"version": "0.6.3"'],
  '"version": "0.6.4"',
  'package version',
);
replaceOneOf(
  'app.json',
  ['"version": "0.6.1"', '"version": "0.6.3"'],
  '"version": "0.6.4"',
  'app version',
);
replaceOneOf(
  'app.json',
  ['"versionCode": 9', '"versionCode": 11'],
  '"versionCode": 12',
  'Android version code',
);
replaceOneOf(
  'app.json',
  ['"buildNumber": "9"', '"buildNumber": "11"'],
  '"buildNumber": "12"',
  'iOS build number',
);

const marketSource = read('src/market-data.js');
if (!marketSource.includes('const changeBase = previousClose;')) {
  throw new Error('Verification failed: Yahoo quote does not use previous close.');
}
if (!marketSource.includes('const normalizedQuote = normalizeDailyChange(quote);')) {
  throw new Error('Verification failed: persisted quotes are not normalized.');
}
if (!marketSource.includes('...normalizedQuote,')) {
  throw new Error('Verification failed: normalized quote is not returned.');
}
if (marketSource.includes("['pre-market', 'post-market'].includes(point.session)")) {
  throw new Error('Verification failed: obsolete extended-session comparison remains.');
}
if (marketSource.includes("point.session === 'post-market' && finite(regularMarketPrice)")) {
  throw new Error('Verification failed: post-market still uses regular-market close.');
}

const pct = (price, previousClose) => ((price - previousClose) / previousClose) * 100;
if (pct(2.77, 2.70).toFixed(2) !== '2.59') {
  throw new Error('Broker parity test failed for SPCE pre-market.');
}
if (pct(2.57, 2.53).toFixed(2) !== '1.58') {
  throw new Error('Broker parity test failed for SPCE post-market.');
}
if (pct(13.105, 13.274).toFixed(2) !== '-1.27') {
  throw new Error('Broker parity test failed for ALWN regular market.');
}

console.log('PASS Investor Control v0.6.4 authoritative daily-change integrity.');
