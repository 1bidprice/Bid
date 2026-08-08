import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewDecision, publishApprovedResearch } from '../src/publication-pipeline.js';

const GENERATED = '2026-07-27T10:00:00.000Z';
const REVIEWED = '2026-07-27T11:00:00.000Z';

function dossier(overrides = {}) {
  return {
    dossierId: 'dossier:company:test:12345678901234567890',
    version: 2,
    companyId: 'company:test',
    companyName: 'Test Company',
    listing: { exchange: 'Test Exchange', symbol: 'TEST', mic: 'XTST' },
    generatedAt: GENERATED,
    status: 'REVIEW_READY',
    category: 'EVENT_DRIVEN',
    proposedAction: 'CONSIDER_BUY',
    timeHorizon: 'MONTHS',
    referencePrice: {
      value: 12.5,
      currency: 'EUR',
      timestamp: '2026-07-27T09:30:00.000Z',
      source: 'Historical market series',
    },
    thesis: 'Verified operating improvement, independent corroboration and market confirmation create a measurable event-driven opportunity with controlled downside.',
    causalMechanism: 'The verified event improves expected cash generation and can cause a rational reassessment of enterprise value.',
    catalysts: [{ text: 'The verified catalyst is scheduled during the review period.', evidenceIds: ['evidence:1'], confidence: 0.9, inference: false }],
    bullCase: 'Execution exceeds the verified base case and the market assigns a higher valuation to improved cash generation.',
    bearCase: 'Execution is delayed, costs rise and the expected cash generation does not appear in reported results.',
    risks: [
      { text: 'Execution may be delayed.', evidenceIds: ['evidence:1'], confidence: 0.8, inference: true },
      { text: 'Valuation may already reflect the catalyst.', evidenceIds: ['evidence:2'], confidence: 0.7, inference: true },
    ],
    invalidationCondition: 'Invalidate the thesis if the verified catalyst is cancelled or the expected financial effect is absent.',
    evidence: [
      { evidenceId: 'evidence:1', sourceName: 'Issuer', sourceType: 'ISSUER_IR', sourceUrl: 'https://issuer.test/1', title: 'Issuer event', publishedAt: GENERATED, independenceGroup: 'issuer', isPrimarySource: true, documentStatus: 'REVIEWED_TEXT' },
      { evidenceId: 'evidence:2', sourceName: 'Reuters', sourceType: 'FINANCIAL_NEWS', sourceUrl: 'https://reuters.test/2', title: 'Independent confirmation', publishedAt: GENERATED, independenceGroup: 'publisher:reuters', isPrimarySource: false, documentStatus: 'REVIEWED_NEWS' },
    ],
    metrics: { crossCheck: { recommendationReady: true } },
    readiness: { publishable: true, blockers: [] },
    reviewDate: '2026-10-27',
    disclosure: 'System-generated research assessment based on cited evidence. It is not a guarantee of outcome and does not execute orders.',
    ...overrides,
  };
}

test('identified approval publishes a review-ready dossier into Opportunities and outcome tracking', () => {
  const decision = createReviewDecision({
    dossierId: dossier().dossierId,
    reviewer: 'Nikos',
    decision: 'approve',
    reviewedAt: REVIEWED,
    notes: 'Evidence, metrics and invalidation checked.',
  });
  const result = publishApprovedResearch([dossier()], [decision], { generatedAt: REVIEWED });
  assert.equal(result.publishedCount, 1);
  assert.equal(result.publishedDossiers[0].status, 'PUBLISHED');
  assert.equal(result.opportunitiesFeed.itemCount, 1);
  assert.equal(result.opportunitiesFeed.items[0].action, 'CONSIDER_BUY');
  assert.equal(result.outcomeRecords.length, 1);
  assert.equal(result.outcomeRecords[0].status, 'OPEN');
  assert.equal(result.audit[0].reviewId, decision.reviewId);
});

test('draft, rejected or stale research cannot enter the production feed', () => {
  const id = dossier().dossierId;
  const rejectedDecision = createReviewDecision({ dossierId: id, reviewer: 'Nikos', decision: 'REJECT', reviewedAt: REVIEWED });
  const rejected = publishApprovedResearch([dossier()], [rejectedDecision], { generatedAt: REVIEWED });
  assert.equal(rejected.publishedCount, 0);
  assert.ok(rejected.rejected[0].blockers.includes('APPROVAL_REQUIRED'));

  const approved = createReviewDecision({ dossierId: id, reviewer: 'Nikos', decision: 'APPROVE', reviewedAt: REVIEWED });
  const draft = publishApprovedResearch([
    dossier({ status: 'DRAFT_RESEARCH', proposedAction: 'WATCH', readiness: { publishable: false, blockers: ['FUNDAMENTALS_REQUIRED'] } }),
  ], [approved], { generatedAt: REVIEWED });
  assert.ok(draft.rejected[0].blockers.includes('DOSSIER_NOT_REVIEW_READY'));
  assert.ok(draft.rejected[0].blockers.includes('DOSSIER_NOT_PUBLISHABLE'));

  const staleReview = '2026-08-05T12:00:00.000Z';
  const staleDecision = createReviewDecision({ dossierId: id, reviewer: 'Nikos', decision: 'APPROVE', reviewedAt: staleReview });
  const stale = publishApprovedResearch([dossier()], [staleDecision], {
    generatedAt: staleReview,
    maxReferencePriceAgeHours: 48,
    maxDossierAgeHours: 48,
  });
  assert.equal(stale.publishedCount, 0);
  assert.ok(stale.rejected[0].blockers.includes('REFERENCE_PRICE_STALE_FOR_PUBLICATION'));
  assert.ok(stale.rejected[0].blockers.includes('DOSSIER_STALE_FOR_PUBLICATION'));
});

test('review decisions require a known decision and identified reviewer', () => {
  assert.throws(() => createReviewDecision({ dossierId: 'dossier:test', reviewer: 'N', decision: 'APPROVE' }), /identified reviewer/);
  assert.throws(() => createReviewDecision({ dossierId: 'dossier:test', reviewer: 'Nikos', decision: 'MAYBE' }), /APPROVE, REJECT or DEFER/);
});
