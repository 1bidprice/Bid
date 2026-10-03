const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'src', 'remote-alert-sync.js'), 'utf8');
source = source
  .replace(/^import .*$/gm, '')
  .replace(/export const\s+([A-Za-z0-9_]+)\s*=/g, 'const $1 =')
  .replace(/export async function\s+([A-Za-z0-9_]+)\s*\(/g, 'async function $1(')
  .replace(/export function\s+([A-Za-z0-9_]+)\s*\(/g, 'function $1(');
source += '\nmodule.exports = { buildRemoteAlertOperations };\n';
const sandbox = { module: { exports: {} }, exports: {}, Number, String, Array };
vm.runInNewContext(source, sandbox, { filename: 'remote-alert-sync.js' });
const { buildRemoteAlertOperations } = sandbox.module.exports;

const operations = buildRemoteAlertOperations({
  symbol: 'SPCE.US',
  enabled: true,
  above: 4,
  below: 2,
  dailyPct: 5,
});
assert.equal(operations.length, 3);
assert.deepEqual(
  JSON.parse(JSON.stringify(operations.map((item) => [item.action, item.kind, item.threshold]))),
  [
    ['UPSERT', 'PRICE_ABOVE', 4],
    ['UPSERT', 'PRICE_BELOW', 2],
    ['UPSERT', 'DAILY_PCT', 5],
  ],
);
assert.ok(operations.every((item) => !item.ruleId.includes('.')));

const disabled = buildRemoteAlertOperations({
  symbol: 'ALWN.GR',
  enabled: false,
  above: 20,
  below: 10,
  dailyPct: 5,
});
assert.ok(disabled.every((item) => item.action === 'DELETE'));

const sparse = buildRemoteAlertOperations({
  symbol: 'CREDIA.GR',
  enabled: true,
  above: null,
  below: 0.8,
  dailyPct: null,
});
assert.deepEqual(
  JSON.parse(JSON.stringify(sparse.map((item) => item.action))),
  ['DELETE', 'UPSERT', 'DELETE'],
);

assert.equal(JSON.stringify(operations).includes('quantity'), false);
assert.equal(JSON.stringify(operations).includes('costBasis'), false);
assert.equal(JSON.stringify(operations).includes('pnl'), false);

console.log('Remote alert sync PASS: local alert thresholds map to privacy-minimal server rules without portfolio fields.');
