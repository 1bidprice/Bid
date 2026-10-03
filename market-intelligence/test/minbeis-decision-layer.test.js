import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMinbeisDecision, MINBEIS_ACTIONS } from '../src/minbeis-decision-layer.js';

function finalAction(overrides = {}) {
  return {
    status: 'FINAL',
    policyVersion: 'test',
    holderAction: 'HOLD',
    nonHolderAction: 'BUY_NOW',
    confidenceScore: 82,
    dataQualityScore: 80,
    blockers: [],
    ...overrides,
  };
}

test('blocked or missing final action can never become a buy', () => {
  assert.equal(buildMinbeisDecision({ finalAction: null }).action, MINBEIS_ACTIONS.NO_BUY);
  assert.equal(
    buildMinbeisDecision({ finalAction: finalAction({ status: 'BLOCKED' }) }).action,
    MINBEIS_ACTIONS.NO_BUY,
  );
});

test('BUY_NOW without confirmed purchase reconciliation remains NO_BUY', () => {
  const result = buildMinbeisDecision({ finalAction: finalAction() });
  assert.equal(result.action, MINBEIS_ACTIONS.NO_BUY);
  assert.equal(result.allocationPct, 0);
});

test('confirmed strict buy becomes BUY_PROBE by default', () => {
  const result = buildMinbeisDecision({
    finalAction: finalAction(),
    opportunityPurchase: {
      status: 'BUY_CONFIRMED',
      buyNowEligible: true,
      opportunityScore: 82,
    },
  });
  assert.equal(result.action, MINBEIS_ACTIONS.BUY_PROBE);
  assert.equal(result.allocationPct, 0.5);
  assert.equal(result.humanApprovalRequired, true);
  assert.equal(result.automaticBrokerOrder, false);
});

test('exceptionally strong confirmed buy can become BUY_STARTER, never BUY_CORE in v1', () => {
  const result = buildMinbeisDecision({
    finalAction: finalAction({ confidenceScore: 90, dataQualityScore: 92 }),
    opportunityPurchase: {
      status: 'BUY_CONFIRMED',
      buyNowEligible: true,
      opportunityScore: 91,
    },
  });
  assert.equal(result.action, MINBEIS_ACTIONS.BUY_STARTER);
  assert.equal(result.allocationPct, 1.0);
  assert.notEqual(result.action, MINBEIS_ACTIONS.BUY_CORE);
});

test('holder SELL_NOW maps to REDUCE and never opens a new position', () => {
  const result = buildMinbeisDecision({
    finalAction: finalAction({ holderAction: 'SELL_NOW' }),
    hasPosition: true,
  });
  assert.equal(result.action, MINBEIS_ACTIONS.REDUCE);
  assert.equal(result.allocationPct, 0);
});
