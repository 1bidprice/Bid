const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'src', 'minbeis-product-metrics-core.js'), 'utf8');
const exported = [];
source = source.replace(/export const\s+([A-Za-z0-9_]+)\s*=/g, (_, name) => { exported.push(name); return 'const ' + name + ' ='; });
source = source.replace(/export function\s+([A-Za-z0-9_]+)\s*\(/g, (_, name) => { exported.push(name); return 'function ' + name + '('; });
source += '\nmodule.exports = { ' + [...new Set(exported)].join(', ') + ' };\n';
const sandbox = { module: { exports: {} }, exports: {}, Date, Number, Math, Set, Array, Object, JSON };
vm.runInNewContext(source, sandbox, { filename: 'minbeis-product-metrics-core.js' });

const {
  MAX_LOCAL_MINBEIS_SESSIONS,
  startMinbeisProductSession,
  recordMinbeisProductFeedback,
  summarizeMinbeisProductMetrics,
} = sandbox.module.exports;

let state = {};
const opens = [
  '2026-09-19T10:00:00Z',
  '2026-09-20T10:00:00Z',
  '2026-09-21T10:00:00Z',
  '2026-09-22T10:00:00Z',
  '2026-09-23T10:00:00Z',
];
for (let index = 0; index < opens.length; index += 1) {
  const started = startMinbeisProductSession(state, opens[index]);
  state = started.state;
  state = recordMinbeisProductFeedback(state, {
    sessionStartedAt: started.sessionStartedAt,
    useful: index !== 2,
    feedbackAt: new Date(new Date(opens[index]).getTime() + (30 + index * 10) * 1000).toISOString(),
  });
}

const summary = summarizeMinbeisProductMetrics(state, '2026-09-23T12:00:00Z');
assert.equal(summary.activeDays, 5);
assert.equal(summary.feedbackCount, 5);
assert.equal(summary.usefulFeedbackCount, 4);
assert.equal(summary.clarityPositiveRatePct, 80);
assert.equal(summary.repeatUsefulnessPct, 80);
assert.equal(summary.minimumEvidenceMet, true);
assert.equal(summary.privacy.localOnly, true);
assert.equal(summary.privacy.networkTransmission, false);
assert.equal(summary.privacy.storesSymbols, false);
assert.equal(summary.privacy.storesPortfolioValues, false);
assert.equal(summary.privacy.storesDecisions, false);
assert.ok(summary.medianTimeToClaritySec >= 30 && summary.medianTimeToClaritySec <= 70);

let bounded = {};
for (let index = 0; index < MAX_LOCAL_MINBEIS_SESSIONS + 25; index += 1) {
  bounded = startMinbeisProductSession(bounded, new Date(Date.parse('2026-01-01T00:00:00Z') + index * 60_000).toISOString()).state;
}
assert.equal(bounded.sessions.length, MAX_LOCAL_MINBEIS_SESSIONS);

console.log('PASS MINBEIS local product metrics: bounded, privacy-first, time-to-clarity and repeat-usefulness.');
