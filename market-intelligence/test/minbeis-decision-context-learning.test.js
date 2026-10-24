import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMinbeisDecisionContextLearning } from '../src/minbeis-decision-context-learning.js';

function row(index, action = 'BUY_PROBE', realised = 10, regime = 'RISK_ON', event = 'EARNINGS') {
  return {
    decisionId: 'd' + index,
    instrumentId: 'company:' + (index % 6),
    decisionAt: `2026-01-${String((index % 10) + 1).padStart(2, '0')}T16:00:00Z`,
    action,
    decisionReason: action === 'BUY_PROBE' ? 'STRICT_BUY_CONFIRMED_PROBE' : 'FINAL_POLICY_WATCH',
    contextSnapshot: {
      decision: { reason: action === 'BUY_PROBE' ? 'STRICT_BUY_CONFIRMED_PROBE' : 'FINAL_POLICY_WATCH' },
      research: {
        marketRegimeSnapshot: { regime },
        leadEventType: event,
        catalystEventTypes: [event],
        riskEventTypes: ['VOLATILITY'],
      },
    },
    horizons: {
      '30': { status: 'MATURED', realisedReturnPct: realised, excessReturnPct: realised - 2 },
    },
  };
}

test('context learning produces evidence-ready regime cohorts only with adequate diversity', () => {
  const records = Array.from({ length: 24 }, (_, i) => row(i));
  const result = buildMinbeisDecisionContextLearning(records, { minimumSample: 20, minimumDistinctDates: 5, minimumDistinctInstruments: 5 });
  const cohort = result.cohorts.regime.find((x) => x.key === 'RISK_ON');
  assert.equal(cohort.evidenceReady, true);
  assert.equal(cohort.sampleSize, 24);
  assert.equal(cohort.positiveDecisionAlignedRatePct, 100);
  assert.equal(result.automaticPolicyMutationAllowed, false);
});

test('defensive decision is aligned with falling price, not treated as a buy', () => {
  const records = Array.from({ length: 20 }, (_, i) => row(i, 'WATCH', -8, 'RISK_OFF', 'MACRO'));
  const result = buildMinbeisDecisionContextLearning(records, { minimumSample: 20, minimumDistinctDates: 5, minimumDistinctInstruments: 5 });
  const cohort = result.cohorts.action.find((x) => x.key === 'WATCH');
  assert.equal(cohort.evidenceReady, true);
  assert.equal(cohort.averageDecisionAlignedReturnPct, 8);
  assert.equal(cohort.positiveDecisionAlignedRatePct, 100);
});

test('small cohorts remain descriptive but blocked from evidence-ready status', () => {
  const result = buildMinbeisDecisionContextLearning([row(1), row(2)], { minimumSample: 20 });
  const cohort = result.cohorts.regime[0];
  assert.equal(cohort.evidenceReady, false);
  assert.ok(cohort.blockers.includes('COHORT_SAMPLE_TOO_SMALL'));
});
