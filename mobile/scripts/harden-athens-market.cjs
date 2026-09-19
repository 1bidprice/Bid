const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const instrumentPath = path.join(root, 'src', 'instrument-quote-integrity.js');
const marketPath = path.join(root, 'src', 'market-data.js');
const verifierPath = path.join(root, 'scripts', 'verify-v173-universal-instrument-integrity.js');
const portfolioTestPath = path.join(root, 'scripts', 'test-portfolio-engine.cjs');

function requiredReplace(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Athens hardening failed: missing ${label}`);
  return source.replace(from, to);
}

function patchInstrumentIntegrity() {
  let source = fs.readFileSync(instrumentPath, 'utf8');

  if (!source.includes("import { MARKET_RULES } from './market-rules';")) {
    source = `import { MARKET_RULES } from './market-rules';\n\n${source}`;
  }

  const localRulesStart = source.indexOf('const MARKET_RULES = Object.freeze({');
  if (localRulesStart >= 0) {
    const nextFunction = source.indexOf('\n\nfunction upper', localRulesStart);
    if (nextFunction < 0) throw new Error('Athens hardening failed: MARKET_RULES block end not found');
    source = `${source.slice(0, localRulesStart)}${source.slice(nextFunction + 2)}`;
  }

  source = source.replace(
    "export const MOBILE_INSTRUMENT_INTEGRITY_VERSION = '2026-08-22.1';",
    "export const MOBILE_INSTRUMENT_INTEGRITY_VERSION = '2026-08-24.1';",
  );

  source = requiredReplace(
    source,
    "      approvedSourceRoles: [...rule.sourceRoles],\n      blocker: null,",
    "      approvedSourceRoles: [...rule.sourceRoles],\n      timeZone: rule.timeZone || null,\n      advertisedDelayMinutes: Number(rule.advertisedDelayMinutes || 0),\n      blocker: null,",
    'route market metadata',
  );

  if (!source.includes('const exchangeCalendarVerified = options.exchangeCalendarVerified !== false;')) {
    source = requiredReplace(
      source,
      "  const sourceApproved = route.supported && route.approvedSourceRoles.includes(role);\n  if (!sourceApproved) blockers.push('QUOTE_SOURCE_NOT_APPROVED');",
      "  const sourceApproved = route.supported && route.approvedSourceRoles.includes(role);\n  if (!sourceApproved) blockers.push('QUOTE_SOURCE_NOT_APPROVED');\n\n  const exchangeCalendarVerified = options.exchangeCalendarVerified !== false;\n  if (route.market === 'GR' && !exchangeCalendarVerified) blockers.push('EXCHANGE_CALENDAR_NOT_VERIFIED');",
      'exchange calendar integrity gate',
    );
  }

  if (!source.includes("? 'CALENDAR_NOT_VERIFIED'")) {
    source = requiredReplace(
      source,
      "      : role === 'FALLBACK_UNVERIFIED' || !sourceApproved\n        ? 'FALLBACK_NOT_VERIFIED'",
      "      : route.market === 'GR' && !exchangeCalendarVerified\n        ? 'CALENDAR_NOT_VERIFIED'\n        : role === 'FALLBACK_UNVERIFIED' || !sourceApproved\n          ? 'FALLBACK_NOT_VERIFIED'",
      'calendar public status',
    );
  }

  if (!source.includes('    exchangeCalendarVerified,')) {
    source = requiredReplace(
      source,
      '    sourceApproved,\n    timestampVerified,',
      '    sourceApproved,\n    exchangeCalendarVerified,\n    timestampVerified,',
      'calendar verification output',
    );
  }

  if (!source.includes("status === 'CALENDAR_NOT_VERIFIED'")) {
    source = requiredReplace(
      source,
      "  if (status === 'INSTRUMENT_UNVERIFIED') return 'Το προϊόν ή η αγορά του δεν έχει επαληθευτεί. Δεν χρησιμοποιείται σε αποτίμηση ή απόφαση.';",
      "  if (status === 'INSTRUMENT_UNVERIFIED') return 'Το προϊόν ή η αγορά του δεν έχει επαληθευτεί. Δεν χρησιμοποιείται σε αποτίμηση ή απόφαση.';\n  if (status === 'CALENDAR_NOT_VERIFIED') return 'Το επίσημο ημερολόγιο συνεδριάσεων της Euronext Athens δεν έχει επαληθευτεί για αυτή την ημερομηνία. Η τιμή δεν χρησιμοποιείται σε αποτίμηση ή απόφαση.';",
      'calendar public message',
    );
  }

  fs.writeFileSync(instrumentPath, source);
}

function patchMarketData() {
  let source = fs.readFileSync(marketPath, 'utf8');

  if (!source.includes("import { marketStateForSymbol } from './market-rules';")) {
    source = requiredReplace(
      source,
      "import { routeMobileInstrument } from './instrument-quote-integrity';",
      "import { routeMobileInstrument } from './instrument-quote-integrity';\nimport { marketStateForSymbol } from './market-rules';",
      'market rules import',
    );
  }

  const zoneStart = source.indexOf('function zoneParts(');
  if (zoneStart >= 0) {
    const htmlStart = source.indexOf('\n\nfunction htmlToText', zoneStart);
    if (htmlStart < 0) throw new Error('Athens hardening failed: legacy session block end not found');
    const replacement = `export function marketSessionAt(symbol, at = new Date()) {\n  return marketStateForSymbol(symbol, at).session;\n}\n\nexport function exchangeState(symbol, at = new Date()) {\n  return marketStateForSymbol(symbol, at);\n}`;
    source = `${source.slice(0, zoneStart)}${replacement}${source.slice(htmlStart)}`;
  }

  source = source.replace("'User-Agent': 'InvestorControl/0.6.4'", "'User-Agent': 'InvestorControl/1.7.3'");

  if (!source.includes("exchangeCalendarVerified: exchange.calendarVerified")) {
    source = requiredReplace(
      source,
      "  const quoteContract = buildMobileQuoteContract(symbol, quote, { now: Date.now(), exchangeOpen: exchange.open, exchangeSession: exchange.session });",
      "  const quoteContract = buildMobileQuoteContract(symbol, quote, {\n    now: Date.now(),\n    exchangeOpen: exchange.open,\n    exchangeSession: exchange.session,\n    exchangeCalendarVerified: exchange.calendarVerified !== false,\n  });",
      'quote calendar propagation',
    );
  }

  if (!source.includes('official Euronext Athens stock page identity not verified')) {
    source = requiredReplace(
      source,
      "  const text = htmlToText(html);\n  const priceValue = numberAfterLabel(text, ['Last Traded Price', 'Τελευταία Τιμή Διαπραγμάτευσης']);",
      "  const text = htmlToText(html);\n  if (!/Traded on Euronext Athens/i.test(text) || !/Last Traded Price/i.test(text)) {\n    throw new Error('official Euronext Athens stock page identity not verified');\n  }\n  const priceValue = numberAfterLabel(text, ['Last Traded Price', 'Τελευταία Τιμή Διαπραγμάτευσης']);",
      'official Athens page identity check',
    );
  }

  source = source.replace(
    "    advertisedDelayMinutes: 15,",
    "    advertisedDelayMinutes: Number(route.advertisedDelayMinutes || 15),",
  );

  fs.writeFileSync(marketPath, source);
}

function patchVerifier() {
  let source = fs.readFileSync(verifierPath, 'utf8');

  if (!source.includes('function loadMarketRulesForTest()')) {
    const helper = `function loadMarketRulesForTest() {\n  let source = read('src/market-rules.js');\n  const exported = [];\n  source = source.replace(/export const\\s+([A-Za-z0-9_]+)\\s*=/g, (_, name) => { exported.push(name); return \`const \${name} =\`; });\n  source = source.replace(/export function\\s+([A-Za-z0-9_]+)\\s*\\(/g, (_, name) => { exported.push(name); return \`function \${name}(\`; });\n  source += \`\\nmodule.exports = { \${[...new Set(exported)].join(', ')} };\\n\`;\n  const sandbox = { module: { exports: {} }, exports: {}, console, Date, Intl, Number, String, Object, Set, Math, RegExp };\n  vm.runInNewContext(source, sandbox, { filename: 'market-rules.js' });\n  return sandbox.module.exports;\n}\n\n`;
    source = requiredReplace(
      source,
      'function loadIntegrityModuleForTest() {',
      `${helper}function loadIntegrityModuleForTest() {`,
      'market rules test loader',
    );
  }

  source = source.replace(
    "  let source = read('src/instrument-quote-integrity.js');",
    "  let source = read('src/instrument-quote-integrity.js').replace(/^import .*$/gm, '');",
  );
  source = source.replace(
    "  const sandbox = { module: { exports: {} }, exports: {}, console, Date, Number, String, Object, Set, Math, RegExp };",
    "  const sandbox = { module: { exports: {} }, exports: {}, console, Date, Intl, Number, String, Object, Set, Math, RegExp, MARKET_RULES: loadMarketRulesForTest().MARKET_RULES };",
  );

  source = source.replace(
    "MOBILE_INSTRUMENT_INTEGRITY_VERSION = '2026-08-22.1'",
    "MOBILE_INSTRUMENT_INTEGRITY_VERSION = '2026-08-24.1'",
  );
  if (!source.includes("market.includes(\"marketStateForSymbol(symbol, at).session\")")) {
    source = requiredReplace(
      source,
      "assert.ok(market.includes('exchangeOpen: exchange.open'));",
      "assert.ok(market.includes('exchangeOpen: exchange.open'));\nassert.ok(market.includes(\"marketStateForSymbol(symbol, at).session\"));\nassert.ok(market.includes('exchangeCalendarVerified: exchange.calendarVerified !== false'));",
      'Athens market-state verifier assertions',
    );
  }
  fs.writeFileSync(verifierPath, source);
}

function patchPortfolioTestLoader() {
  let source = fs.readFileSync(portfolioTestPath, 'utf8');
  if (!source.includes("source = source.replace(/^import .*$/gm, '');")) {
    source = requiredReplace(
      source,
      "  let source = read(relativePath);\n  const exported = [];",
      "  let source = read(relativePath);\n  source = source.replace(/^import .*$/gm, '');\n  const exported = [];",
      'portfolio test import stripping',
    );
  }
  if (!source.includes("const marketRules = loadExportedModule('src/market-rules.js');")) {
    source = requiredReplace(
      source,
      "const accounting = loadExportedModule('src/transaction-accounting.js');\nconst integrity = loadExportedModule('src/instrument-quote-integrity.js');",
      "const accounting = loadExportedModule('src/transaction-accounting.js');\nconst marketRules = loadExportedModule('src/market-rules.js');\nconst integrity = loadExportedModule('src/instrument-quote-integrity.js', { MARKET_RULES: marketRules.MARKET_RULES });",
      'portfolio test canonical market rules injection',
    );
  }
  fs.writeFileSync(portfolioTestPath, source);
}

patchInstrumentIntegrity();
patchMarketData();
patchVerifier();
patchPortfolioTestLoader();

const instrument = fs.readFileSync(instrumentPath, 'utf8');
const market = fs.readFileSync(marketPath, 'utf8');
const verifier = fs.readFileSync(verifierPath, 'utf8');
const portfolioTest = fs.readFileSync(portfolioTestPath, 'utf8');
if (!instrument.includes("import { MARKET_RULES } from './market-rules';")) throw new Error('canonical market rules not wired into instrument integrity');
if (!instrument.includes('EXCHANGE_CALENDAR_NOT_VERIFIED')) throw new Error('Athens calendar fail-closed gate missing');
if (!market.includes("import { marketStateForSymbol } from './market-rules';")) throw new Error('canonical market state not wired into market-data');
if (market.includes('17 * 60 + 25')) throw new Error('obsolete Athens 17:25 close remains');
if (!verifier.includes('loadMarketRulesForTest')) throw new Error('instrument verifier cannot load canonical market rules');
if (!portfolioTest.includes("MARKET_RULES: marketRules.MARKET_RULES")) throw new Error('portfolio tests cannot load canonical market rules');

console.log('Athens market hardening PASS: official 10:15-17:20 session/calendar, primary delayed feed and fail-closed calendar integrity wired into canonical core.');
