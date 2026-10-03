const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const file = path.join(__dirname, '..', 'src', 'instrument-save-preflight.js');
let source = fs.readFileSync(file, 'utf8');
const exported = [];
source = source.replace(/export const\s+([A-Za-z0-9_]+)\s*=/g, (_, name) => { exported.push(name); return 'const ' + name + ' ='; });
source = source.replace(/export function\s+([A-Za-z0-9_]+)\s*\(/g, (_, name) => { exported.push(name); return 'function ' + name + '('; });
source += '\nmodule.exports = { ' + [...new Set(exported)].join(', ') + ' };\n';
const sandbox = { module: { exports: {} }, exports: {}, String, Set };
vm.runInNewContext(source, sandbox, { filename: 'instrument-save-preflight.js' });

const { classifyInstrumentSavePreflight } = sandbox.module.exports;

assert.deepEqual(
  JSON.parse(JSON.stringify(classifyInstrumentSavePreflight({
    identityVerified: true,
    identityStatusReason: 'OFFICIAL_EXCHANGE_IDENTITY',
  }))),
  { status: 'VERIFIED', reason: 'OFFICIAL_EXCHANGE_IDENTITY' },
);

assert.deepEqual(
  JSON.parse(JSON.stringify(classifyInstrumentSavePreflight({
    identityVerified: false,
    identityStatusReason: 'ATHENS_SYMBOL_IDENTITY_NOT_FOUND',
  }))),
  { status: 'REJECTED', reason: 'ATHENS_SYMBOL_IDENTITY_NOT_FOUND' },
);

assert.deepEqual(
  JSON.parse(JSON.stringify(classifyInstrumentSavePreflight({
    identityVerified: false,
    identityStatusReason: 'FINNHUB_IDENTITY_MISMATCH',
  }))),
  { status: 'REJECTED', reason: 'FINNHUB_IDENTITY_MISMATCH' },
);

assert.deepEqual(
  JSON.parse(JSON.stringify(classifyInstrumentSavePreflight({
    identityVerified: false,
    identityStatusReason: 'ATHENS_SYMBOL_RESOLUTION_FAILED',
  }))),
  { status: 'PENDING_CONFIRMATION', reason: 'ATHENS_SYMBOL_RESOLUTION_FAILED' },
);

assert.deepEqual(
  JSON.parse(JSON.stringify(classifyInstrumentSavePreflight(null, {
    gatewayCode: 'HTTP_503',
  }))),
  { status: 'PENDING_CONFIRMATION', reason: 'HTTP_503' },
);

console.log('Instrument save preflight PASS: verified identities save, definitive mismatches reject, transient failures require explicit pending confirmation.');
