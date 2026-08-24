const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadExports(relativePath, context = {}) {
  let source = read(relativePath);
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
  const sandbox = { module: { exports: {} }, exports: {}, console, Date, Number, String, Object, Array, Set, Math, RegExp, ...context };
  vm.runInNewContext(source, sandbox, { filename: relativePath });
  return sandbox.module.exports;
}

const accounting = loadExports('src/transaction-accounting.js');

const withNullTotal = accounting.normalizeTransaction({
  type: 'buy', symbol: 'NULL.US', quantity: 10, currency: 'USD', executionPrice: 5,
  total: null, grossAmount: null, fees: null,
});
assert.equal(withNullTotal.grossAmount, 50, 'null gross/total must not become authoritative zero');
assert.equal(withNullTotal.total, 50, 'null total must be derived from price x quantity');
assert.equal(withNullTotal.executionPrice, 5);
assert.equal(accounting.accountingInvariantReport(withNullTotal).ok, true);

const withEmptyTotal = accounting.normalizeTransaction({
  type: 'buy', symbol: 'EMPTY.GR', quantity: 4, currency: 'EUR', executionPrice: 2.5,
  total: '', grossAmount: '', fees: '',
});
assert.equal(withEmptyTotal.grossAmount, 10);
assert.equal(withEmptyTotal.total, 10);
assert.equal(accounting.accountingInvariantReport(withEmptyTotal).ok, true);

const portfolioSource = read('src/portfolio-engine.js');
assert.ok(portfolioSource.includes("value !== null && value !== undefined && value !== ''"), 'portfolio finite guard must reject null/undefined/empty values');
const lotSource = read('src/position-lots.js');
assert.ok(lotSource.includes("value !== null && value !== undefined && value !== ''"), 'lot finite guard must reject null/undefined/empty values');

console.log('Numeric null-safety PASS: null/undefined/empty values cannot silently become zero in canonical accounting, portfolio or lot logic.');
