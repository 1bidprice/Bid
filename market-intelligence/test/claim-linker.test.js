import test from 'node:test';
import assert from 'node:assert/strict';
import { linkEvidenceClaims, selectLeadClaim } from '../src/claim-linker.js';

const NOW = '2026-07-27T12:00:00.000Z';

function record(overrides = {}) {
  return {
    id: 'evidence:issuer:1',
    title: 'Company announced share buyback programme',
    rawText: 'The company announced a share buyback programme.',
    sourceType: 'ISSUER_IR',
    sourceName: 'Issuer IR',
    sourceUrl: 'https://issuer.test/buyback',
    contentHash: 'issuer-hash-0123456789',
    companyIds: ['company:test'],
    publishedAt: '2026-07-20T09:00:00.000Z',
    eventAt: '2026-07-20T09:00:00.000Z',
    claimType: 'FACT',
    reliabilityTier: 1,
    isPrimarySource: true,
    independenceGroup: 'issuer',
    supportsClaimIds: [],
    contradictsClaimIds: [],
    document: { reviewed: true, status: 'REVIEWED_TEXT' },
    ...overrides,
  };
}

test('claim linker groups independently reviewed evidence into recommendation-grade claim', () => {
  const claims = linkEvidenceClaims([
    record(),
    record({
      id: 'evidence:wire:2',
      title: 'Independent report confirms company share repurchase',
      rawText: 'Independent reporting confirms the company share buyback.',
      sourceType: 'FINANCIAL_NEWS',
      sourceName: 'Reuters',
      sourceUrl: 'https://reuters.test/buyback',
      contentHash: 'wire-hash-9876543210',
      isPrimarySource: false,
      reliabilityTier: 2,
      independenceGroup: 'publisher:reuters',
    }),
  ], { now: NOW });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].status, 'RECOMMENDATION_GRADE');
  assert.equal(claims[0].recommendationGrade, true);
  assert.equal(claims[0].reviewedSourceGroups.length, 2);
  assert.equal(selectLeadClaim(claims).claimId, claims[0].claimId);
});

test('unreviewed news remains discovery support and cannot upgrade the claim', () => {
  const claims = linkEvidenceClaims([
    record(),
    record({
      id: 'evidence:rss:2',
      title: 'Company share buyback - Reuters',
      sourceType: 'FINANCIAL_NEWS',
      sourceName: 'Reuters',
      sourceUrl: 'https://news.google.test/story',
      contentHash: 'rss-hash-9876543210',
      claimType: 'ESTIMATE',
      isPrimarySource: false,
      reliabilityTier: 2,
      independenceGroup: 'publisher:reuters',
      document: undefined,
    }),
  ], { now: NOW });
  assert.equal(claims[0].status, 'CORROBORATED_DISCOVERY');
  assert.equal(claims[0].recommendationGrade, false);
});

test('contradictory evidence marks the canonical claim as contradicted', () => {
  const claims = linkEvidenceClaims([
    record(),
    record({
      id: 'evidence:contradiction:2',
      sourceType: 'FINANCIAL_NEWS',
      sourceName: 'Independent Wire',
      sourceUrl: 'https://wire.test/correction',
      contentHash: 'correction-hash-123456',
      isPrimarySource: false,
      reliabilityTier: 2,
      independenceGroup: 'wire',
      contradictsClaimIds: ['claim:prior'],
    }),
  ], { now: NOW });
  assert.equal(claims[0].status, 'CONTRADICTED');
  assert.equal(claims[0].recommendationGrade, false);
});
