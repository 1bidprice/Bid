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

// Live-QA regression: broker cash debit is authoritative; rounded 3.17 must not survive
// when it cannot reproduce 2,282.72 USD for 720 shares.
const spce = assertInvariant({
  id: 'spce-live-regression',
  type: 'buy',
  symbol: 'SPCE.US',
  company: 'Virgin Galactic Holdings',
  quantity: 720,
  currency: 'USD',
  executionPrice: 3.17,
  price: 3.17,
  fees: 0,
  total: 2282.72,
}, 'SPCE live reconciliation');
assert.equal(spce.grossAmount, 2282.72);
assertClose(spce.executionPrice, 2282.72 / 720, 1e-12, 'SPCE derived execution price');
assertClose(allInPrice(spce), 2282.72 / 720, 1e-12, 'SPCE all-in');
assert.notEqual(spce.executionPrice, 3.17);

// A broker-provided execution price that already reconciles after cent rounding is kept.
const allwynCanonical = assertInvariant({
  id: 'allwyn-canonical',
  type: 'buy',
  symbol: 'ALWN.GR',
  company: 'Allwyn',
  quantity: 193,
  currency: 'EUR',
  executionPrice: 13.565,
  price: 13.565,
  feeBreakdown: { commission: 9.16, transfer: 1.57, clearing: 0.72, exchange: 0.5 },
  total: 2630.0,
}, 'Allwyn canonical reconciliation');
assert.equal(allwynCanonical.executionPrice, 13.565);
assert.equal(allwynCanonical.grossAmount, 2618.05);
assert.equal(allwynCanonical.total, 2630.0);

// Historic Allwyn migration remains deterministic and idempotent.
const allwynLegacy = assertInvariant({
  id: 'allwyn-legacy',
  type: 'buy',
  symbol: 'ALWN.GR',
  company: 'Allwyn',
  date: '2026-07-14',
  quantity: 193,
  currency: 'EUR',
  price: 13.57,
  fees: 11.95,
  total: 2630.96,
}, 'Allwyn legacy migration');
assert.equal(allwynLegacy.executionPrice, 13.565);
assert.equal(allwynLegacy.total, 2630.0);
assert.deepEqual(normalizeTransaction(allwynLegacy), allwynLegacy);

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

console.log(`Accounting invariants PASS: SPCE live regression + Allwyn migration + ${synthetic.length} synthetic transactions.`);
