const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');

let source = fs.readFileSync(path.join(__dirname, '..', 'src', 'portfolio-history.js'), 'utf8')
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ');
const sandbox = { Date, Number, String, Object, Array, Map, Math, Set };
vm.createContext(sandbox);
vm.runInContext(source + '\nthis.api={createPortfolioHistoryState,normalizePortfolioHistoryState,compactPortfolioHistory,recordPortfolioHistoryPoint,portfolioHistoryPointsForRange};', sandbox);
const api = sandbox.api;

const idA = 'minbeis-a';
const idB = 'minbeis-b';
assert.equal(api.normalizePortfolioHistoryState(null, idA).status, 'EMPTY');
assert.equal(api.normalizePortfolioHistoryState({ ownerInstallationId: idB, points: [] }, idA).status, 'FOREIGN_OWNER');
assert.equal(api.normalizePortfolioHistoryState({ points: [] }, idA).status, 'LEGACY_UNOWNED');

const base = Date.parse('2026-09-30T10:00:00.000Z');
const ready = { valuesReady: true, costsReady: true, totalValue: 10000, totalCost: 9000, totalPnl: 1000 };
let recorded = api.recordPortfolioHistoryPoint(api.createPortfolioHistoryState(idA), idA, ready, base);
assert.equal(recorded.changed, true);
assert.equal(recorded.state.points.length, 1);

const tooSoon = api.recordPortfolioHistoryPoint(recorded.state, idA, { ...ready, totalValue: 10010, totalPnl: 1010 }, base + 60_000);
assert.equal(tooSoon.changed, false);
assert.equal(tooSoon.state.points.length, 1);

recorded = api.recordPortfolioHistoryPoint(recorded.state, idA, { ...ready, totalValue: 10100, totalPnl: 1100 }, base + 5 * 60_000);
assert.equal(recorded.changed, true);
assert.equal(recorded.state.points.length, 2);

const partial = api.recordPortfolioHistoryPoint(recorded.state, idA, { ...ready, valuesReady: false }, base + 10 * 60_000);
assert.equal(partial.changed, false);
assert.equal(partial.state.points.length, 2);

const oneDay = api.portfolioHistoryPointsForRange(recorded.state, '1D', base + 6 * 60_000, 360);
assert.equal(oneDay.length, 2);
assert.equal(oneDay[1].value, 10100);

const many = [];
for (let i = 0; i < 1000; i += 1) {
  many.push({ capturedAt: new Date(base - i * 60_000).toISOString(), value: 10000 + i, cost: 9000, pnl: 1000 + i });
}
const compacted = api.compactPortfolioHistory(many, base);
assert.ok(compacted.length < many.length);

console.log('MINBEIS portfolio history ownership, capture, range and compaction contract verified');
