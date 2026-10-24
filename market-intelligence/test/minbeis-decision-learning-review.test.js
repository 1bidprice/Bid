import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMinbeisDecisionLearningReview, summarizeMinbeisDecisionLearningReviews } from '../src/minbeis-decision-learning-review.js';

function record(overrides = {}) {
  return {
    decisionId: 'minbeis:test',
    action: 'BUY_PROBE',
    confidenceScore: 65,
    dataQualityScore: 62,
    contextSnapshot: {
      decision: { confidenceScore: 65, dataQualityScore: 62, blockers: ['TEST_BLOCKER'] },
      research: { marketRegimeSnapshot: { regime: 'RISK_OFF' }, catalystEventTypes: ['EARNINGS'] },
    },
    simpleBaselineSnapshot: { status: 'READY', action: 'NO_TRADE' },
    horizons: {
      '30': {
        status: 'MATURED',
        realisedReturnPct: -12,
        excessReturnPct: -8,
        maxAdverseExcursionPct: -18,
        maxFavorableExcursionPct: 2,
      },
    },
    ...overrides,
  };
}

test('adverse BUY outcome enters review queue without claiming causality', () => {
  const review = buildMinbeisDecisionLearningReview(record());
  assert.equal(review.status, 'REVIEW_REQUIRED');
  assert.equal(review.reviewRequired, true);
  assert.equal(review.causalityEstablished, false);
  assert.equal(review.humanReviewRequired, true);
  assert.ok(review.reviewSignals.includes('BUY_NEGATIVE_RETURN_REVIEW'));
  assert.ok(review.reviewSignals.includes('BUY_BENCHMARK_UNDERPERFORMANCE_REVIEW'));
  assert.ok(review.candidateAttributions.includes('LOW_CONFIDENCE_AT_DECISION'));
  assert.ok(review.candidateAttributions.includes('LOW_DATA_QUALITY_AT_DECISION'));
  assert.ok(review.candidateAttributions.includes('MINBEIS_BASELINE_DISAGREEMENT'));
});

test('strong post-decision upside after NO_BUY is flagged as missed-upside review', () => {
  const review = buildMinbeisDecisionLearningReview(record({
    action: 'NO_BUY',
    horizons: { '30': { status: 'MATURED', realisedReturnPct: 15, excessReturnPct: 9, maxAdverseExcursionPct: -2, maxFavorableExcursionPct: 17 } },
  }));
  assert.deepEqual(review.reviewSignals, ['MISSED_UPSIDE_REVIEW']);
});

test('summary never authorizes automatic production mutation', () => {
  const summary = summarizeMinbeisDecisionLearningReviews([record()]);
  assert.equal(summary.reviewRequiredCount, 1);
  assert.equal(summary.automaticModelMutationAllowed, false);
  assert.equal(summary.promotionRequiresGovernedValidation, true);
});
