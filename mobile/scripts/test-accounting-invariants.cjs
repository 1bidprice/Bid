const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'transaction-accounting.js');

function loadAccounting() {
  let source = fs.readFileSync(sourcePath, 'utf8');
  const exported = [];
  source = source.replace(/export const\s+([A-Za-z0-9_]+)\s*=/g, (_, name) => {
    exported.push(name);
    return `const ${name} =`;
  });
  source = source.replace(/export function\s+([A-Za-z0-9_]+)\s*\(/g, (_, name) => {
    exported.push(name);
    return `function ${name}(`;
  });
  source += `\nmodule.exports = { ${[...new Set(exported)].join(', ')} };\n`;
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    Date,
    Number,
    String,
    Object,
    Array,
    Math,
  };
  vm.runInNewContext(source, sandbox, { filename: 'transaction-accounting.js' });
  return sandbox.module.exports;
}

const accounting = loadAccounting();
const {
  normalizeTransaction,
  normalizeTransactions,
  transactionExecutionPrice,
  transactionGross,
  transactionFees,
  transactionTotal,
  allInPrice,
  accountingInvariantReport,
  roundMoney,
} = accounting;

function assertClose(actual, expected, epsilon = 1e-10, label = 'value') {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= epsilon, `${label}: expected ${expected}, got ${actual}`);
}

function assertInvariant(transaction, label) {
  const normalized = normalizeTransaction(transaction);
  const report = accountingInvariantReport(normalized);
  assert.equal(report.ok, true, `${label}: accounting invariant failed: ${JSON.stringify(report)}`);
  assert.equal(roundMoney(normalized.quantity * normalized.executionPrice), normalized.grossAmount, `${label}: quantity x execution price must reconcile to gross`);
  const expectedTotal = normalized.type === 'sell'
    ? roundMoney(normalized.grossAmount - normalized.fees)
    : roundMoney(normalized.grossAmount + normalized.fees);
  assert.equal(expectedTotal, normalized.total, `${label}: gross +/- fees must reconcile to total`);
  return normalized;
}

// Authoritative settlement cash must override a rounded stored execution price.
const roundedLegacy = assertInvariant({
  id: 'synthetic-rounded-legacy',
  type: 'buy',
  symbol: 'SYNTH.US',
  company: 'Synthetic Instrument',
  quantity: 40,
  currency: 'USD',
  executionPrice: 2.5,
  price: 2.5,
  fees: 0,
  total: 101.2,
}, 'Synthetic rounded-price reconciliation');
assert.equal(roundedLegacy.grossAmount, 101.2);
assertClose(roundedLegacy.executionPrice, 101.2 / 40, 1e-12, 'Synthetic derived execution price');
assertClose(allInPrice(roundedLegacy), 101.2 / 40, 1e-12, 'Synthetic all-in');
assert.notEqual(roundedLegacy.executionPrice, 2.5);

// A broker-provided execution price that already reconciles after cent rounding is kept.
const canonical = assertInvariant({
  id: 'synthetic-canonical',
  type: 'buy',
  symbol: 'CANON.GR',
  company: 'Synthetic Canonical',
  quantity: 25,
  currency: 'EUR',
  executionPrice: 8.04,
  price: 8.04,
  feeBreakdown: { commission: 2, transfer: 1, clearing: 1, exchange: 0.5 },
  total: 205.5,
}, 'Synthetic canonical reconciliation');
assert.equal(canonical.executionPrice, 8.04);
assert.equal(canonical.grossAmount, 201.0);
assert.equal(canonical.total, 205.5);

// Generic legacy normalization remains deterministic and idempotent.
const genericLegacy = assertInvariant({
  id: 'synthetic-legacy',
  type: 'buy',
  symbol: 'LEGACY.GR',
  company: 'Synthetic Legacy',
  date: '2026-01-15',
  quantity: 10,
  currency: 'EUR',
  price: 5,
  fees: 1,
  total: 51,
}, 'Generic legacy normalization');
assert.equal(genericLegacy.executionPrice, 5);
assert.equal(genericLegacy.total, 51);
assert.deepEqual(normalizeTransaction(genericLegacy), genericLegacy);

const buyWithFees = assertInvariant({
  type: 'buy', symbol: 'TEST.US', quantity: 100, currency: 'USD', executionPrice: 10,
  feeBreakdown: { commission: 4, other: 1 }, total: 1005,
}, 'Buy fees');
assert.equal(transactionGross(buyWithFees), 1000);
assert.equal(transactionFees(buyWithFees), 5);
assert.equal(transactionTotal(buyWithFees), 1005);
assert.equal(transactionExecutionPrice(buyWithFees), 10);

const sellWithFees = assertInvariant({
  type: 'sell', symbol: 'TEST.US', quantity: 100, currency: 'USD', executionPrice: 10,
  feeBreakdown: { commission: 4, other: 1 }, total: 995,
}, 'Sell fees');
assert.equal(sellWithFees.grossAmount, 1000);
assert.equal(sellWithFees.total, 995);
assert.equal(sellWithFees.executionPrice, 10);

// If gross and price disagree with the settlement total, the settlement total wins.
const conflicting = assertInvariant({
  type: 'buy', symbol: 'CONFLICT.US', quantity: 10, currency: 'USD',
  executionPrice: 10, grossAmount: 100, fees: 1, total: 102,
}, 'Conflicting stored fields');
assert.equal(conflicting.grossAmount, 101);
assert.equal(conflicting.executionPrice, 10.1);
assert.equal(conflicting.total, 102);

// Live-device crash guard: old or damaged local JSON must never put object values
// into React Text. Invalid/missing currency remains null so valuation still fails
// closed instead of inferring a currency from the ticker.
const hostileLegacy = assertInvariant({
  id: { legacy: true },
  type: 'buy',
  symbol: 'synth.us',
  company: { name: 'Synthetic Instrument' },
  date: { iso: '2026-01-20' },
  quantity: '40',
  currency: '
  broker: { name: 'legacy broker' },
  orderReference: { value: 123 },
  notes: { text: 'legacy note' },
}, 'Malformed legacy render safety');
assert.equal(hostileLegacy.symbol, 'SYNTH.US');
assert.equal(hostileLegacy.currency, null);
assert.equal(hostileLegacy.company, 'SYNTH.US');
assert.equal(hostileLegacy.date, '');
for (const key of ['id', 'symbol', 'company', 'date', 'broker', 'orderReference', 'settlementReference', 'notes', 'migrationNote', 'createdAt', 'updatedAt']) {
  assert.equal(typeof hostileLegacy[key], 'string', `render field ${key} must be a string`);
}
assert.doesNotThrow(() => new Intl.NumberFormat('el-GR', {
  style: 'currency',
  currency: hostileLegacy.currency || 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(hostileLegacy.total));
assert.deepEqual(normalizeTransaction(hostileLegacy), hostileLegacy);

// Synthetic coverage: every normalized transaction must satisfy the same equations,
// regardless of symbol, currency, side, quantity, fees, or intentionally rounded price.
let seed = 0x1a2b3c4d;
function random() {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 0x100000000;
}

const synthetic = [];
for (let i = 0; i < 2000; i += 1) {
  const type = random() > 0.35 ? 'buy' : 'sell';
  const quantity = 1 + Math.floor(random() * 5000);
  const exactPrice = 0.1 + random() * 500;
  const gross = roundMoney(quantity * exactPrice);
  const fees = roundMoney(random() * 30);
  const total = type === 'sell' ? roundMoney(Math.max(0, gross - fees)) : roundMoney(gross + fees);
  const displayedPrice = Number(exactPrice.toFixed(random() > 0.5 ? 2 : 4));
  synthetic.push({
    id: `synthetic-${i}`,
    type,
    symbol: i % 2 ? `SYN${i}.US` : `SYN${i}.GR`,
    quantity,
    currency: i % 2 ? 'USD' : 'EUR',
    executionPrice: displayedPrice,
    fees,
    total,
  });
}

for (const transaction of synthetic) assertInvariant(transaction, transaction.id);
const normalizedBatch = normalizeTransactions(synthetic);
assert.equal(normalizedBatch.length, synthetic.length);
for (const transaction of normalizedBatch) {
  const twice = normalizeTransaction(transaction);
  assert.equal(twice.grossAmount, transaction.grossAmount);
  assert.equal(twice.total, transaction.total);
  assertClose(twice.executionPrice, transaction.executionPrice, 1e-12, `${transaction.id} idempotent price`);
  assert.equal(accountingInvariantReport(twice).ok, true);
}

console.log(`Accounting invariants PASS: synthetic cash reconciliation + render-safe fail-closed legacy ledger + generic idempotent normalization + ${synthetic.length} synthetic transactions.`);
,
  executionPrice: '2.5',
  fees: '0',
  total: '100',
  broker: { name: 'legacy broker' },
  orderReference: { value: 123 },
  notes: { text: 'legacy note' },
}, 'Malformed legacy render safety');
assert.equal(hostileLegacy.symbol, 'SPCE.US');
assert.equal(hostileLegacy.currency, null);
assert.equal(hostileLegacy.company, 'SPCE.US');
assert.equal(hostileLegacy.date, '');
for (const key of ['id', 'symbol', 'company', 'date', 'broker', 'orderReference', 'settlementReference', 'notes', 'migrationNote', 'createdAt', 'updatedAt']) {
  assert.equal(typeof hostileLegacy[key], 'string', `render field ${key} must be a string`);
}
assert.doesNotThrow(() => new Intl.NumberFormat('el-GR', {
  style: 'currency',
  currency: hostileLegacy.currency || 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(hostileLegacy.total));
assert.deepEqual(normalizeTransaction(hostileLegacy), hostileLegacy);

// Synthetic coverage: every normalized transaction must satisfy the same equations,
// regardless of symbol, currency, side, quantity, fees, or intentionally rounded price.
let seed = 0x1a2b3c4d;
function random() {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 0x100000000;
}

const synthetic = [];
for (let i = 0; i < 2000; i += 1) {
  const type = random() > 0.35 ? 'buy' : 'sell';
  const quantity = 1 + Math.floor(random() * 5000);
  const exactPrice = 0.1 + random() * 500;
  const gross = roundMoney(quantity * exactPrice);
  const fees = roundMoney(random() * 30);
  const total = type === 'sell' ? roundMoney(Math.max(0, gross - fees)) : roundMoney(gross + fees);
  const displayedPrice = Number(exactPrice.toFixed(random() > 0.5 ? 2 : 4));
  synthetic.push({
    id: `synthetic-${i}`,
    type,
    symbol: i % 2 ? `SYN${i}.US` : `SYN${i}.GR`,
    quantity,
    currency: i % 2 ? 'USD' : 'EUR',
    executionPrice: displayedPrice,
    fees,
    total,
  });
}

for (const transaction of synthetic) assertInvariant(transaction, transaction.id);
const normalizedBatch = normalizeTransactions(synthetic);
assert.equal(normalizedBatch.length, synthetic.length);
for (const transaction of normalizedBatch) {
  const twice = normalizeTransaction(transaction);
  assert.equal(twice.grossAmount, transaction.grossAmount);
  assert.equal(twice.total, transaction.total);
  assertClose(twice.executionPrice, transaction.executionPrice, 1e-12, `${transaction.id} idempotent price`);
  assert.equal(accountingInvariantReport(twice).ok, true);
}

console.log(`Accounting invariants PASS: SPCE live regression + render-safe fail-closed legacy ledger + Allwyn migration + ${synthetic.length} synthetic transactions.`);
