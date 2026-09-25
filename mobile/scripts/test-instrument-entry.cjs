const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'src', 'instrument-entry.js'), 'utf8');
const exported = [];
source = source.replace(/export const\s+([A-Za-z0-9_]+)\s*=/g, (_, name) => { exported.push(name); return 'const ' + name + ' ='; });
source = source.replace(/export function\s+([A-Za-z0-9_]+)\s*\(/g, (_, name) => { exported.push(name); return 'function ' + name + '('; });
source += '\nmodule.exports = { ' + [...new Set(exported)].join(', ') + ' };\n';
const sandbox = { module: { exports: {} }, exports: {}, String, Object };
vm.runInNewContext(source, sandbox, { filename: 'instrument-entry.js' });
const {
  canonicalInstrumentSymbol,
  baseInstrumentSymbol,
  instrumentCurrency,
  inferInstrumentMarket,
  instrumentEntryFromTransaction,
} = sandbox.module.exports;

assert.equal(canonicalInstrumentSymbol('nvda', 'US'), 'NVDA.US');
assert.equal(canonicalInstrumentSymbol('CREDIA.GR', 'GR'), 'CREDIA.GR');
assert.equal(canonicalInstrumentSymbol('spce.us', 'US'), 'SPCE.US');
assert.equal(canonicalInstrumentSymbol('', 'US'), null);
assert.equal(canonicalInstrumentSymbol('bad symbol', 'US'), null);
assert.equal(baseInstrumentSymbol('ALWN.GR'), 'ALWN');
assert.equal(baseInstrumentSymbol('BUS'), 'BUS');
assert.equal(baseInstrumentSymbol('TIGR'), 'TIGR');
assert.equal(canonicalInstrumentSymbol('BUS', 'US'), 'BUS.US');
assert.equal(instrumentCurrency('GR'), 'EUR');
assert.equal(instrumentCurrency('US'), 'USD');
assert.equal(inferInstrumentMarket('SPCE.US', 'EUR'), 'US');
assert.equal(inferInstrumentMarket('', 'USD'), 'US');
assert.deepEqual(
  instrumentEntryFromTransaction({ symbol: 'CREDIA.GR', currency: 'EUR' }),
  { market: 'GR', symbolInput: 'CREDIA', canonicalSymbol: 'CREDIA.GR', currency: 'EUR' },
);

console.log('PASS instrument entry: users type ticker only; market determines canonical suffix and currency.');
