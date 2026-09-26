const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'src', 'minbeis-mobile-decision.js'), 'utf8');
const exported = [];
source = source.replace(/export const\s+([A-Za-z0-9_]+)\s*=/g, (_, name) => { exported.push(name); return 'const ' + name + ' ='; });
source = source.replace(/export function\s+([A-Za-z0-9_]+)\s*\(/g, (_, name) => { exported.push(name); return 'function ' + name + '('; });
source += '\nmodule.exports = { ' + [...new Set(exported)].join(', ') + ' };\n';
const sandbox = { module: { exports: {} }, exports: {}, Number, String, Set, Map, Object, Array };
vm.runInNewContext(source, sandbox, { filename: 'minbeis-mobile-decision.js' });
const { buildPersonalizedMinbeisDashboard } = sandbox.module.exports;

const feed = {
  decisions: [
    { id: 'held', companyId: 'held', companyName: 'Held Co', symbol: 'HELD', finalAction: { status: 'FINAL', holderAction: 'HOLD', nonHolderAction: 'WATCH' } },
    { id: 'sell', companyId: 'sell', companyName: 'Sell Co', symbol: 'SELL', finalAction: { status: 'FINAL', holderAction: 'SELL_NOW', nonHolderAction: 'AVOID' } },
    { id: 'buy', companyId: 'buy', companyName: 'Buy Co', symbol: 'BUY', finalAction: { status: 'FINAL', holderAction: 'HOLD', nonHolderAction: 'BUY_NOW' } },
    { id: 'wait', companyId: 'wait', companyName: 'Wait Co', symbol: 'WAIT', finalAction: { status: 'FINAL', holderAction: 'HOLD', nonHolderAction: 'BUY_NOW' } },
  ],
  opportunityPurchaseDecisions: [
    { companyId: 'buy', symbol: 'BUY', status: 'BUY_CONFIRMED', buyNowEligible: true, minbeisDecision: { action: 'BUY_STARTER' } },
  ],
};
const positions = [{ symbol: 'HELD.US', quantity: 10 }, { symbol: 'SELL.US', quantity: 5 }];
const dashboard = buildPersonalizedMinbeisDashboard(feed, positions, { isCurrentDecision: () => true });

assert.equal(dashboard.rows.find((x) => x.companyId === 'held').action, 'HOLD');
assert.equal(dashboard.rows.find((x) => x.companyId === 'sell').action, 'REDUCE');
assert.equal(dashboard.rows.find((x) => x.companyId === 'buy').action, 'BUY_STARTER');
assert.equal(dashboard.rows.find((x) => x.companyId === 'wait').action, 'NO_BUY');
assert.equal(dashboard.counts.REDUCE, 1);
assert.equal(dashboard.counts.BUY_STARTER, 1);
assert.equal(dashboard.actionableCount, 2);

const stale = buildPersonalizedMinbeisDashboard(feed, positions, { isCurrentDecision: () => false });
assert.equal(stale.rows.length, 0);

console.log('PASS MINBEIS dashboard: holder/non-holder personalization, strict BUY gate and fail-closed freshness.');


{
  const mixed = buildPersonalizedMinbeisDashboard(feed, positions, { isCurrentDecision: () => true });
  const ownedRows = mixed.rows.filter((row) => row.owned);
  const newIdeaRows = mixed.rows.filter((row) => !row.owned);
  assert.equal(ownedRows.length, 2, 'owned positions remain distinguishable from new ideas');
  assert.equal(newIdeaRows.length, 2, 'new ideas remain separate from owned positions');
  assert.ok(ownedRows.every((row) => ['HOLD', 'REDUCE', 'WATCH'].includes(row.action)));
}
