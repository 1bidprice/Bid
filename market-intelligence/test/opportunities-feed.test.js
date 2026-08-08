import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpportunitiesFeed } from '../src/opportunities-feed.js';

function dossier(overrides = {}) {
  return {
    dossierId: 'dossier:company:test:1234567890',
    companyId: 'company:test',
    companyName: 'Test Company',
    listing: { exchange: 'Test Exchange', symbol: 'TEST', mic: 'XTST' },
    generatedAt: '2026-07-27T14:00:00.000Z',
    status: 'PUBLISHED',
    category: 'EVENT_DRIVEN',
    proposedAction: 'CONSIDER_BUY',
    timeHorizon: 'MONTHS',
    referencePrice: { value: 12.5, currency: 'EUR', timestamp: '2026-07-27T13:00:00.000Z', source: 'Market source' },
    thesis: 'A sufficiently detailed evidence-backed thesis that explains the verified investment mechanism and expected impact.',
    catalysts: [{ text: 'Verified catalyst', evidenceIds: ['evidence:1'], confidence: 0.9 }],
    risks: [
      { text: 'Execution risk', evidenceIds: ['evidence:1'], confidence: 0.8 },
      { text: 'Valuation risk', evidenceIds: ['evidence:2'], confidence: 0.7 },
    ],
    invalidationCondition: 'The verified catalyst fails before the review date.',
    reviewDate: '2026-10-27',
    evidence: [{}, {}],
    readiness: { publishable: true, blockers: [] },
    disclosure: 'System-generated assessment.',
    ...overrides,
  };
}

test('draft dossier never enters production Opportunities feed', () => {
  const feed = buildOpportunitiesFeed([
    dossier({ status: 'DRAFT_RESEARCH', readiness: { publishable: false, blockers: ['THESIS_REQUIRED'] } }),
  ], { generatedAt: '2026-07-27T15:00:00.000Z' });
  assert.equal(feed.itemCount, 0);
  assert.equal(feed.rejected[0].reason, 'DOSSIER_NOT_PUBLISHED');
});

test('published dossier becomes a localized Opportunities item', () => {
  const feed = buildOpportunitiesFeed([dossier()], { generatedAt: '2026-07-27T15:00:00.000Z' });
  assert.equal(feed.itemCount, 1);
  assert.equal(feed.items[0].categoryLabel, 'Ευκαιρία συγκεκριμένου καταλύτη');
  assert.equal(feed.items[0].actionLabel, 'Πιθανή αγορά');
  assert.equal(feed.items[0].referencePrice.currency, 'EUR');
});

test('review-ready dossiers are visible only in explicit internal-preview mode', () => {
  const reviewReady = dossier({ status: 'REVIEW_READY' });
  assert.equal(buildOpportunitiesFeed([reviewReady]).itemCount, 0);
  assert.equal(buildOpportunitiesFeed([reviewReady], { includeReviewReady: true }).itemCount, 1);
});
