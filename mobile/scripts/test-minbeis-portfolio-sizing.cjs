const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'minbeis-portfolio-sizing.js');

function loadModule() {
  let source = fs.readFileSync(sourcePath, 'utf8');
  const exported = [];
  source = source.replace(/export const\s+([A-Za-z0-9_]+)\s*=/g, (_, name) => { exported.push(name); return 'const ' + name + ' ='; });
  source = source.replace(/export function\s+([A-Za-z0-9_]+)\s*\(/g, (_, name) => { exported.push(name); return 'function ' + name + '('; });
  source += '\nmodule.exports = { ' + [...new Set(exported)].join(', ') + ' };\n';
  const sandbox = { module: { exports: {} }, exports: {}, Number, String, Set, Math, Object, Array };
  vm.runInNewContext(source, sandbox, { filename: 'minbeis-portfolio-sizing.js' });
  return sandbox.module.exports;
}

const { applyMinbeisPortfolioSizing, CONCENTRATION_POLICY_MODES } = loadModule();
const probe = { action: 'BUY_PROBE', allocationPct: 0.5, symbol: 'STM', humanApprovalRequired: true, automaticBrokerOrder: false };

let result = applyMinbeisPortfolioSizing(probe, [
  { symbol: 'ALPHA.GR', eurValue: 1000 },
  { symbol: 'ETE.GR', eurValue: null },
], { symbol: 'STM' });
assert.equal(result.portfolioSizingStatus, 'PERSONALIZATION_UNAVAILABLE');
assert.equal(result.portfolioAdjustedAllocationPct, 0.5);
assert.ok(result.portfolioSizingWarnings.includes('PORTFOLIO_VALUATION_INCOMPLETE'));

result = applyMinbeisPortfolioSizing(probe, [
  { symbol: 'STM.US', eurValue: 9000 },
  { symbol: 'ALPHA.GR', eurValue: 1000 },
], {
  symbol: 'STM',
  concentrationPolicyMode: CONCENTRATION_POLICY_MODES.NO_LIMIT,
});
assert.equal(result.portfolioSizingStatus, 'PASS_USER_NO_LIMIT');
assert.equal(result.portfolioAdjustedAllocationPct, 0.5);
assert.equal(result.maxSinglePositionPct, null);
assert.ok(result.portfolioSizingWarnings.includes('CONCENTRATION_RISK'));

result = applyMinbeisPortfolioSizing(probe, [
  { symbol: 'STM.US', eurValue: 1000 },
  { symbol: 'ALPHA.GR', eurValue: 9000 },
], {
  symbol: 'STM',
  concentrationPolicyMode: CONCENTRATION_POLICY_MODES.USER_LIMIT,
  maxSinglePositionPct: 10,
});
assert.equal(result.portfolioSizingStatus, 'BLOCKED_BY_USER_POLICY');
assert.equal(result.portfolioAdjustedAllocationPct, 0);
assert.ok(result.portfolioSizingBlockers.includes('USER_SINGLE_POSITION_LIMIT_REACHED'));

result = applyMinbeisPortfolioSizing(probe, [
  { symbol: 'STM.US', eurValue: 9500 },
  { symbol: 'ALPHA.GR', eurValue: 500 },
], {
  symbol: 'STM',
  concentrationPolicyMode: CONCENTRATION_POLICY_MODES.INFORM_ONLY,
});
assert.equal(result.portfolioSizingStatus, 'PASS_ADVISORY');
assert.equal(result.portfolioAdjustedAllocationPct, 0.5);
assert.equal(result.concentrationBand, 'EXTREME');

console.log('MINBEIS portfolio policy PASS: concentration is advisory by default, user caps are optional, NO_LIMIT permits concentrated strategies, and incomplete valuation does not erase the base MINBEIS decision.');
