const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = [
  'src/transaction-accounting.js',
  'src/portfolio-engine.js',
  'src/position-lots.js',
];

const unsafe = 'const finite = (value) => Number.isFinite(Number(value));';
const safe = "const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));";

for (const relativePath of files) {
  const fullPath = path.join(root, relativePath);
  let source = fs.readFileSync(fullPath, 'utf8');
  if (source.includes(unsafe)) source = source.replace(unsafe, safe);
  if (!source.includes(safe)) throw new Error(`numeric hardening failed for ${relativePath}`);
  fs.writeFileSync(fullPath, source);
}

// Live-device QA: the Transactions tab referenced transactionTotal without
// importing it. Metro can build that source, but opening the tab throws a
// runtime ReferenceError. Materialize the missing canonical import and keep
// the verifier responsible for preventing the regression from returning.
{
  const fullPath = path.join(root, 'PortfolioApp.js');
  let source = fs.readFileSync(fullPath, 'utf8');
  const oldImport = "  transactionGross,\n  transactionOrderPrice,\n} from './src/transaction-accounting';";
  const newImport = "  transactionGross,\n  transactionOrderPrice,\n  transactionTotal,\n} from './src/transaction-accounting';";
  if (source.includes(oldImport)) source = source.replace(oldImport, newImport);
  if (!source.includes(newImport)) throw new Error('Transactions tab runtime import hardening failed');
  if (!source.includes('const total = transactionTotal(transaction);')) throw new Error('Transactions tab canonical total render missing');
  fs.writeFileSync(fullPath, source);
}

// Live-device QA: canonical feed quotes were reclassified without the current
// exchange state. On a closed US weekend that made a verified Friday regular-
// session close look stale instead of valuation-eligible. Feed the same market
// state/calendar context used by direct provider classification.
{
  const fullPath = path.join(root, 'src/market-data.js');
  let source = fs.readFileSync(fullPath, 'utf8');
  const oldRead = "      const quote = quoteFromRegistry(symbol, registry[symbol], { now: Date.now() });";
  const newRead = [
    "      const exchange = exchangeState(symbol);",
    "      const quote = quoteFromRegistry(symbol, registry[symbol], {",
    "        now: Date.now(),",
    "        exchangeOpen: exchange.open,",
    "        exchangeSession: exchange.session,",
    "        exchangeCalendarVerified: exchange.calendarVerified !== false,",
    "      });",
  ].join('\n');
  if (source.includes(oldRead)) source = source.replace(oldRead, newRead);
  if (!source.includes(newRead)) throw new Error('Canonical feed exchange-state hardening failed');
  fs.writeFileSync(fullPath, source);
}

console.log('Core live-device hardening PASS: null-safe numerics, Transactions runtime import and closed-market canonical feed context are enforced.');
