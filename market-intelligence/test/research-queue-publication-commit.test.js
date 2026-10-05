import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchQueueKvBulk } from '../src/research-queue-publication-commit.js';

function plan(overrides = {}) {
  return {
    format: 'minbeis-research-queue-completion-plan',
    version: 1,
    mutationAuthority: 'TRUSTED_PUBLISHER_ONLY',
    publicMutationEndpoint: false,
    updateCount: 1,
    updates: [{
      key: 'research:NVDA.US',
      symbol: 'NVDA.US',
      previousStatus: 'QUEUED',
      nextStatus: 'COMPLETED',
      value: {
        format: 'minbeis-research-queue-record',
        version: 1,
        symbol: 'NVDA.US',
        status: 'COMPLETED',
        completionSource: 'CANONICAL_RESEARCH_DOSSIER',
        privacy: {
          storesSymbolOnly: true,
          storesPortfolioData: false,
          storesClientIdentity: false,
        },
      },
    }],
    ...overrides,
  };
}

const published = {
  researchDossiers: [{
    listing: { symbol: 'NVDA', mic: 'XNAS' },
    referencePrice: { appSymbol: 'NVDA.US' },
  }],
};

test('trusted completion produces a Cloudflare-ready key/value payload only after canonical publication', () => {
  const bulk = buildResearchQueueKvBulk(plan(), published);
  assert.equal(bulk.updateCount, 1);
  assert.equal(bulk.items[0].key, 'research:NVDA.US');
  assert.equal(JSON.parse(bulk.items[0].value).status, 'COMPLETED');
});

test('completion cannot precede publication of the exact market-qualified instrument', () => {
  assert.throws(
    () => buildResearchQueueKvBulk(plan(), {
      researchDossiers: [{ listing: { symbol: 'NVDA' }, referencePrice: { appSymbol: 'NVDA.GR' } }],
    }),
    /precede canonical publication/,
  );
});

test('public or weakened mutation authority is rejected', () => {
  assert.throws(
    () => buildResearchQueueKvBulk(plan({ mutationAuthority: 'PUBLIC_CLIENT' }), published),
    /trusted mutation authority/,
  );
});

test('completion payload rejects any portfolio or client identity storage', () => {
  const unsafe = plan();
  unsafe.updates[0].value.privacy.storesPortfolioData = true;
  assert.throws(() => buildResearchQueueKvBulk(unsafe, published), /privacy invariant/);
});
