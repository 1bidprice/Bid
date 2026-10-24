const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');

let source = fs.readFileSync(path.join(__dirname, '..', 'src', 'portfolio-insights.js'), 'utf8')
  .replace(/export function /g, 'function ');
const sandbox = { Number, String, Array, Math };
vm.createContext(sandbox);
vm.runInContext(source + '\nthis.api={buildPortfolioInsights};', sandbox);
const { buildPortfolioInsights } = sandbox.api;

const result = buildPortfolioInsights([
  { symbol: 'ALWN.GR', company: 'Allwyn', eurValue: 2100, eurPnl: -400 },
  { symbol: 'SPCE.US', company: 'Virgin Galactic', eurValue: 1950, eurPnl: -120 },
  { symbol: 'CREDIA.GR', company: 'CrediaBank', eurValue: 15, eurPnl: -10 },
]);
assert.equal(result.positionCount, 3);
assert.equal(result.valuedPositionCount, 3);
assert.equal(result.coverage, '3/3');
assert.equal(result.allocation[0].symbol, 'ALWN.GR');
assert.ok(result.top1Pct > 50 && result.top1Pct < 53);
assert.ok(result.top3Pct > 99.99 && result.top3Pct <= 100.001);
assert.equal(result.pnlContribution[0].symbol, 'ALWN.GR');
assert.ok(result.pnlContribution[0].contributionPct > 70);

const partial = buildPortfolioInsights([
  { symbol: 'A.US', eurValue: 100, eurPnl: 10 },
  { symbol: 'B.GR', eurValue: null, eurPnl: null },
]);
assert.equal(partial.coverage, '1/2');
assert.equal(partial.allocation.length, 1);

console.log('MINBEIS portfolio allocation and P/L contribution insights verified');
