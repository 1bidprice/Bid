import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBroadFundamentalCandidates } from '../src/broad-equity-fundamental-selector.js';

function item(id, score, growth, margin, leverage, risk = 25) {
  return {
    instrumentId: id,
    broadScreen: {
      score,
      preliminaryRiskScore: risk,
      finalActionEligible: false,
      rawSignals: { revenueGrowthPct: growth, netMarginPct: margin, liabilitiesToAssetsPct: leverage },
    },
  };
}

const universe = [
  item('composite-1', 99, 10, 10, 50), item('composite-2', 98, 11, 11, 51), item('composite-3', 97, 12, 12, 52),
  item('growth-1', 70, 90, 5, 60), item('growth-2', 69, 80, 4, 58), item('growth-3', 68, 70, 3, 57),
  item('margin-1', 72, 5, 45, 55), item('margin-2', 71, 4, 40, 54), item('margin-3', 70, 3, 35, 53),
  item('balance-1', 65, 2, 8, 10), item('balance-2', 64, 1, 7, 12), item('balance-3', 63, 0, 6, 14),
  item('distress', 100, 100, 100, 5, 95),
];

test('selector builds a diversified pre-market cohort instead of taking only composite leaders', () => {
  const result = selectBroadFundamentalCandidates(universe, { limit: 8 });
  assert.equal(result.selectedCount, 8);
  assert.equal(result.candidates.some((candidate) => candidate.instrumentId === 'distress'), false);
  const lanes = new Set(result.candidates.map((candidate) => candidate.broadScreen.selector.primaryLane));
  assert.ok(lanes.has('COMPOSITE_QUALITY'));
  assert.ok(lanes.has('REVENUE_GROWTH'));
  assert.ok(lanes.has('PROFITABILITY'));
  assert.ok(lanes.has('BALANCE_SHEET_STRENGTH'));
  assert.equal(new Set(result.candidates.map((candidate) => candidate.instrumentId)).size, result.candidates.length);
});
