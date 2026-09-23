import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMinbeisAssessment } from '../src/minbeis-assessment.js';

function dossier(finalAction = {}, overrides = {}) {
  return {
    finalAction: {
      status: 'FINAL',
      marketAction: 'WATCH',
      reasons: [],
      blockers: [],
      risk: { fundamentalFlags: [], marketFlags: [] },
      confidenceScore: 80,
      dataQualityScore: 90,
      ...finalAction,
    },
    invalidationCondition: 'Close below support',
    ...overrides,
  };
}

test('strict confirmed BUY becomes SETUP but has no decision authority', () => {
  const result = buildMinbeisAssessment(
    dossier({ marketAction: 'BUY_NOW' }),
    { status: 'BUY_CONFIRMED', buyNowEligible: true },
  );
  assert.equal(result.classification, 'SETUP');
  assert.equal(result.decisionImpact, 'NONE');
  assert.equal(result.finalActionEligible, false);
});

test('BUY_NOW without strict purchase confirmation remains CONFIRMATION_REQUIRED', () => {
  const result = buildMinbeisAssessment(dossier({ marketAction: 'BUY_NOW' }), null);
  assert.equal(result.classification, 'CONFIRMATION_REQUIRED');
});

test('verified severe risk becomes TRAP', () => {
  const result = buildMinbeisAssessment(dossier({
    marketAction: 'AVOID',
    reasons: ['SEVERE_RISK_CONFIGURATION'],
    risk: { fundamentalFlags: ['SEVERE_DILUTION'], marketFlags: [] },
  }));
  assert.equal(result.classification, 'TRAP');
});

test('watch and hold states remain NO_TRADE for new entry', () => {
  assert.equal(buildMinbeisAssessment(dossier({ marketAction: 'WATCH' })).classification, 'NO_TRADE');
  assert.equal(buildMinbeisAssessment(dossier({ marketAction: 'HOLD' })).classification, 'NO_TRADE');
});

test('blocked canonical decision becomes CONFIRMATION_REQUIRED and preserves blockers in explanation', () => {
  const result = buildMinbeisAssessment(dossier({
    status: 'BLOCKED',
    marketAction: 'WATCH',
    blockers: ['REFERENCE_PRICE_TIMESTAMP_NOT_VERIFIED'],
  }));
  assert.equal(result.classification, 'CONFIRMATION_REQUIRED');
  assert.ok(result.explanation.whyNow.includes('REFERENCE_PRICE_TIMESTAMP_NOT_VERIFIED'));
});
