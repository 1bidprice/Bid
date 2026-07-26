import test from 'node:test';
import assert from 'node:assert/strict';
import { assessEvidence, rankSignalCandidate } from '../src/rank-signal.js';

const now = '2026-07-27T00:00:00.000Z';

const primaryEvidence = {
  id: 'evidence-sec-1',
  sourceType: 'REGULATORY_FILING',
  sourceName: 'SEC EDGAR',
  sourceUrl: 'https://www.sec.gov/example',
  publishedAt: '2026-07-26T12:00:00.000Z',
  retrievedAt: '2026-07-26T12:01:00.000Z',
  eventAt: '2026-07-26T12:00:00.000Z',
  title: 'Primary filing',
  contentHash: '0123456789abcdef',
  companyIds: ['company-1'],
  claimType: 'FACT',
  reliabilityTier: 1,
  isPrimarySource: true,
  independenceGroup: 'SEC',
  contradictsClaimIds: [],
};

const reliableNews = (id, sourceName, independenceGroup) => ({
  ...primaryEvidence,
  id,
  sourceType: 'FINANCIAL_NEWS',
  sourceName,
  sourceUrl: `https://example.com/${id}`,
  isPrimarySource: false,
  reliabilityTier: 3,
  independenceGroup,
});

test('one primary factual source passes the evidence gate', () => {
  const result = assessEvidence([primaryEvidence], now);
  assert.equal(result.publishable, true);
  assert.equal(result.primaryFactCount, 1);
  assert.ok(result.qualityScore >= 60);
});

test('two independent reliable secondary sources pass the evidence gate', () => {
  const result = assessEvidence(
    [reliableNews('news-a', 'Source A', 'group-a'), reliableNews('news-b', 'Source B', 'group-b')],
    now,
  );
  assert.equal(result.publishable, true);
  assert.equal(result.independentReliableSourceCount, 2);
});

test('one secondary article cannot produce an autonomous recommendation', () => {
  const result = rankSignalCandidate({
    category: 'EVENT_DRIVEN',
    evidence: [reliableNews('news-a', 'Source A', 'group-a')],
    fundamentalsScore: 90,
    catalystScore: 90,
    priceConfirmationScore: 90,
    liquidityScore: 90,
    personalisationScore: 90,
    riskScore: 20,
  }, now);

  assert.equal(result.category, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.suggestedAction, 'WATCH');
  assert.equal(result.status, 'DRAFT');
  assert.ok(result.rankingScore <= 39);
});

test('social-only evidence is blocked', () => {
  const social = {
    ...reliableNews('social-1', 'Social account', 'social-account'),
    sourceType: 'SOCIAL_MEDIA',
    reliabilityTier: 5,
  };
  const result = assessEvidence([social], now);
  assert.equal(result.publishable, false);
  assert.ok(result.blockingReasons.includes('SOCIAL_ONLY'));
});

test('strong verified candidate can be classified as consider buy', () => {
  const result = rankSignalCandidate({
    category: 'VALUE_REPRICING',
    evidence: [primaryEvidence, reliableNews('news-a', 'Source A', 'group-a')],
    fundamentalsScore: 95,
    catalystScore: 90,
    priceConfirmationScore: 88,
    liquidityScore: 92,
    personalisationScore: 80,
    riskScore: 12,
    contradictionPenalty: 0,
    stalenessPenalty: 0,
    hasPosition: false,
  }, now);

  assert.equal(result.category, 'VALUE_REPRICING');
  assert.equal(result.suggestedAction, 'CONSIDER_BUY');
  assert.equal(result.status, 'ACTIVE');
  assert.ok(result.rankingScore >= 74);
  assert.ok(result.confidenceScore >= 70);
});

test('extreme risk overrides an otherwise strong score', () => {
  const result = rankSignalCandidate({
    category: 'SPECULATIVE_CATALYST',
    evidence: [primaryEvidence],
    fundamentalsScore: 90,
    catalystScore: 95,
    priceConfirmationScore: 90,
    liquidityScore: 80,
    personalisationScore: 90,
    riskScore: 95,
    hasPosition: false,
  }, now);

  assert.equal(result.suggestedAction, 'AVOID');
  assert.ok(result.reasons.includes('EXTREME_RISK'));
});
