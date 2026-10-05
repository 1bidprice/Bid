const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'src', 'intelligence-readiness.js'), 'utf8');
const exported = [];
source = source.replace(/export const\s+([A-Za-z0-9_]+)\s*=/g, (_, name) => { exported.push(name); return 'const ' + name + ' ='; });
source = source.replace(/export function\s+([A-Za-z0-9_]+)\s*\(/g, (_, name) => { exported.push(name); return 'function ' + name + '('; });
source += '\nmodule.exports = { ' + [...new Set(exported)].join(', ') + ' };\n';
const sandbox = { module: { exports: {} }, exports: {}, Date, Number, Math };
vm.runInNewContext(source, sandbox, { filename: 'intelligence-readiness.js' });
const { intelligenceSystemReady, intelligenceFeedFresh, intelligenceDecisionContext } = sandbox.module.exports;

const good = {
  status: 'OPERATIONAL',
  marketDataStatus: 'OPERATIONAL',
  fundamentalsStatus: 'OPERATIONAL',
  decisionEngineStatus: 'READY',
};
assert.equal(intelligenceSystemReady(good), true);
assert.equal(intelligenceSystemReady({ ...good, marketDataStatus: 'PARTIAL' }), false);
assert.equal(intelligenceSystemReady({ ...good, fundamentalsStatus: 'PARTIAL' }), false);
assert.equal(intelligenceSystemReady({ ...good, decisionEngineStatus: 'BLOCKED' }), false);

const now = Date.parse('2026-09-23T18:00:00Z');
assert.equal(intelligenceFeedFresh({ generatedAt: '2026-09-23T15:00:01Z' }, now), true);
assert.equal(intelligenceFeedFresh({ generatedAt: '2026-09-23T13:59:59Z' }, now), false);

const context = intelligenceDecisionContext({ generatedAt: '2026-09-23T17:00:00Z', operationalHealth: good }, now);
assert.deepEqual(context, { feedFresh: true, systemReady: true });

console.log('PASS intelligence readiness: foreground and background share strict fail-closed readiness.');
