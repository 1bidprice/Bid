import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchQueueCompletionPlan } from '../src/research-queue-completion.js';

test('queued symbol becomes COMPLETED only after canonical dossier exists', () => {
  const plan = buildResearchQueueCompletionPlan({
    records: [{
      symbol: 'NVDA.US',
      status: 'QUEUED',
      firstRequestedAt: '2026-09-20T10:00:00Z',
      privacy: { storesSymbolOnly: true, storesPortfolioData: false, storesClientIdentity: false },
    }],
  }, {
    generatedAt: '2026-09-25T12:00:00Z',
    researchDossiers: [{ listing: { symbol: 'NVDA' } }],
  });
  assert.equal(plan.updateCount, 1);
  assert.equal(plan.updates[0].key, 'research:NVDA.US');
  assert.equal(plan.updates[0].value.status, 'COMPLETED');
  assert.equal(plan.updates[0].value.completionSource, 'CANONICAL_RESEARCH_DOSSIER');
  assert.equal(plan.updates[0].value.privacy.storesPortfolioData, false);
  assert.equal(plan.updates[0].value.privacy.storesClientIdentity, false);
});

test('queue remains QUEUED if canonical dossier is absent', () => {
  const plan = buildResearchQueueCompletionPlan({
    records: [{ symbol: 'NVDA.US', status: 'QUEUED' }],
  }, {
    generatedAt: '2026-09-25T12:00:00Z',
    researchDossiers: [{ listing: { symbol: 'SPCE' } }],
  });
  assert.equal(plan.updateCount, 0);
  assert.equal(plan.untouched[0].reason, 'CANONICAL_DOSSIER_NOT_PRESENT');
});

test('completion plan never grants public mutation authority', () => {
  const plan = buildResearchQueueCompletionPlan([], { researchDossiers: [] });
  assert.equal(plan.mutationAuthority, 'TRUSTED_PUBLISHER_ONLY');
  assert.equal(plan.publicMutationEndpoint, false);
});
