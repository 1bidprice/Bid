const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'minbeis-portfolio-sizing.js');

function loadModule() {
  let source = fs.readFileSync(sourcePath, 'utf8');
  const exported = [];
  source = source.replace(/export function\s+([A-Za-z0-9_]+)\s*\(/g, (_, name) => { exported.push(name); return 'function ' + name + '('; });
  source += '\nmodule.exports = { ' + [...new Set(exported)].join(', ') + ' };\n';
  const sandbox = { module: { exports: {} }, exports: {}, Number, String, Set, Math };
  vm.runInNewContext(source, sandbox, { filename: 'minbeis-portfolio-sizing.js' });
  return sandbox.module.exports;
}

const { applyMinbeisPortfolioSizing } = loadModule();
const probe = { action: 'BUY_PROBE', allocationPct: 0.5, symbol: 'STM', humanApprovalRequired: true, automaticBrokerOrder: false };

let result = applyMinbeisPortfolioSizing(probe, [{ symbol: 'ALPHA.GR', eurValue: 1000 }, { symbol: 'ETE.GR', eurValue: null }], { symbol: 'STM' });
assert.equal(result.portfolioSizingStatus, 'BLOCKED');
assert.equal(result.portfolioAdjustedAllocationPct, 0);
assert.ok(result.portfolioSizingBlockers.includes('PORTFOLIO_VALUATION_INCOMPLETE'));

result = applyMinbeisPortfolioSizing(probe, [{ symbol: 'ALPHA.GR', eurValue: 6000 }, { symbol: 'ETE.GR', eurValue: 4000 }], { symbol: 'STM', maxSinglePositionPct: 10 });
assert.equal(result.portfolioSizingStatus, 'PASS');
assert.equal(result.portfolioAdjustedAllocationPct, 0.5);

result = applyMinbeisPortfolioSizing(probe, [{ symbol: 'STM.US', eurValue: 1000 }, { symbol: 'ALPHA.GR', eurValue: 9000 }], { symbol: 'STM', maxSinglePositionPct: 10 });
assert.equal(result.portfolioSizingStatus, 'BLOCKED');
assert.equal(result.portfolioAdjustedAllocationPct, 0);
assert.ok(result.portfolioSizingBlockers.includes('SINGLE_POSITION_CAP_REACHED'));

console.log('MINBEIS portfolio sizing PASS: incomplete valuation fails closed, valid probes pass, and concentration cap blocks excess exposure.');
