const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'src', 'minbeis-home-summary.js'), 'utf8');
source = source.replace("import { finalActionIsCurrent } from './decision-validity';", "const finalActionIsCurrent = globalThis.__finalActionIsCurrent;");
const exported = [];
source = source.replace(/export function\s+([A-Za-z0-9_]+)\s*\(/g, (_, name) => { exported.push(name); return 'function ' + name + '('; });
source += '\nmodule.exports = { ' + exported.join(', ') + ' };\n';

const sandbox = {
  module: { exports: {} },
  exports: {},
  globalThis: {
    __finalActionIsCurrent: (finalAction, options) => finalAction?.status === 'FINAL' && options.feedFresh && options.systemReady && new Date(finalAction.validUntil).getTime() > options.now,
  },
  Date, Number, String, Set, Map, Array, Object, Math,
};
vm.runInNewContext(source, sandbox, { filename: 'minbeis-home-summary.js' });
const { buildMinbeisHomeSummary } = sandbox.module.exports;

const now = Date.parse('2026-09-23T18:00:00Z');
const feed = {
  generatedAt: '2026-09-23T17:00:00Z',
  operationalHealth: {
    status: 'OPERATIONAL',
    marketDataStatus: 'OPERATIONAL',
    fundamentalsStatus: 'OPERATIONAL',
    decisionEngineStatus: 'READY',
  },
  published: [{
    symbol: 'SPCE',
    minbeisAssessment: { classification: 'TRAP' },
    finalAction: { status: 'FINAL', holderAction: 'HOLD', validUntil: '2026-09-24T18:00:00Z' },
  }],
  reviewReady: [{
    symbol: 'CREDIA',
    minbeisAssessment: { classification: 'CONFIRMATION_REQUIRED' },
    finalAction: { status: 'BLOCKED', blockers: ['REFERENCE_PRICE_TIMESTAMP_NOT_VERIFIED'] },
  }],
  research: [],
};
const positions = [
  { symbol: 'SPCE.US', quantity: 10 },
  { symbol: 'CREDIA.GR', quantity: 20 },
  { symbol: 'ALWN.GR', quantity: 5 },
];

const summary = buildMinbeisHomeSummary(feed, positions, { now });
assert.equal(summary.state, 'ATTENTION');
assert.equal(summary.attentionCount, 2);
assert.equal(summary.coveredPositionCount, 2);
assert.equal(summary.pendingPositionCount, 1);
assert.ok(summary.attentionSymbols.includes('SPCE'));
assert.ok(summary.attentionSymbols.includes('CREDIA'));
assert.deepEqual(summary.pendingSymbols, ['ALWN']);

const stale = buildMinbeisHomeSummary({ ...feed, generatedAt: '2026-09-22T10:00:00Z' }, positions, { now });
assert.equal(stale.state, 'STALE');
assert.equal(stale.feedFresh, false);

console.log('PASS MINBEIS home summary: portfolio attention, coverage and stale-feed fail-closed behavior.');
