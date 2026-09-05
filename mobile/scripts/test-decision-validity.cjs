const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'decision-validity.js');

function loadModule() {
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
    Date,
    Number,
  };
  vm.runInNewContext(source, sandbox, { filename: 'decision-validity.js' });
  return sandbox.module.exports;
}

const { finalActionValidity, finalActionIsCurrent } = loadModule();
const now = new Date('2026-09-05T16:15:00Z').getTime();

const active = {
  status: 'FINAL',
  validUntil: '2026-09-05T18:00:00Z',
  holderAction: 'SELL_NOW',
};
assert.equal(finalActionIsCurrent(active, { now, feedFresh: true, systemReady: true }), true);

// Real-device regression: a FINAL SPCE action that expired on 4 Sep must not
// still surface as "ΑΜΕΣΗ ΠΩΛΗΣΗ / ΜΕΙΩΣΗ" on 5 Sep.
const expiredSpce = {
  status: 'FINAL',
  validUntil: '2026-09-04T20:24:58Z',
  holderAction: 'SELL_NOW',
};
const expiredReport = finalActionValidity(expiredSpce, { now, feedFresh: true, systemReady: true });
assert.equal(expiredReport.eligible, false);
assert.equal(expiredReport.reason, 'DECISION_EXPIRED');
assert.equal(expiredReport.expired, true);

// A fresh quote must not revive an action from a stale research feed.
const staleFeedReport = finalActionValidity(active, { now, feedFresh: false, systemReady: true });
assert.equal(staleFeedReport.eligible, false);
assert.equal(staleFeedReport.reason, 'FEED_NOT_FRESH');

// A degraded decision/evidence system must fail closed even with a fresh feed.
const degradedReport = finalActionValidity(active, { now, feedFresh: true, systemReady: false });
assert.equal(degradedReport.eligible, false);
assert.equal(degradedReport.reason, 'SYSTEM_NOT_READY');

// Missing or invalid validUntil is never treated as unlimited validity.
for (const validUntil of [null, '', 'not-a-date']) {
  const report = finalActionValidity({ status: 'FINAL', validUntil }, { now, feedFresh: true, systemReady: true });
  assert.equal(report.eligible, false);
  assert.equal(report.reason, 'VALID_UNTIL_NOT_VERIFIED');
}

assert.equal(finalActionIsCurrent({ status: 'DRAFT', validUntil: '2026-09-06T00:00:00Z' }, { now, feedFresh: true, systemReady: true }), false);

console.log('Decision validity PASS: expired/stale/degraded/missing-validity actions fail closed; only current FINAL actions remain eligible.');
