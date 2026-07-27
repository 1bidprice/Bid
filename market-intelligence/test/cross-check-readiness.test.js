import test from 'node:test';
import assert from 'node:assert/strict';
import { assessIndependentEvidence } from '../src/cross-check.js';
import { evaluateSignalReadiness } from '../src/signal-readiness.js';

const NOW = '2026-07-27T12:00:00.000Z';

function record(overrides = {}) {
  return {
    id: `evidence:${Math.random()}`,
    sourceType: 'ISSUER_IR',
    sourceName: 'Issuer IR',
    sourceUrl: 'https://issuer.test/announcement',
    contentHash: '0123456789abcdef0123456789abcdef',
    claimType: 'FACT',
    reliabilityTier: 1,
    isPrimarySource: true,
    independenceGroup: 'issuer',
    supportsClaimIds: [],
    contradictsClaimIds: [],
    expiresAt: null,
    ...overrides,
  };
}

test('one primary source supports discovery but not an autonomous recommendation', () => {
  const result = assessIndependentEvidence([record()], NOW);
  assert.equal(result.discoveryReady, true);
  assert.equal(result.recommendationReady, false);
  assert.ok(result.blockers.includes('INDEPENDENT_CORROBORATION_REQUIRED'));
});

test('primary evidence plus independent reliable corroboration passes cross-check', () => {
  const result = assessIndependentEvidence([
    record(),
    record({
      id: 'evidence:independent',
      sourceType: 'FINANCIAL_NEWS',
      sourceName: 'Independent wire',
      sourceUrl: 'https://wire.test/story',
      contentHash: 'fedcba9876543210fedcba9876543210',
      isPrimarySource: false,
      reliabilityTier: 2,
      independenceGroup: 'wire',
    }),
  ], NOW);
  assert.equal(result.independentGroupCount, 2);
  assert.equal(result.recommendationReady, true);
});

test('explicit contradiction blocks recommendation readiness', () => {
  const result = assessIndependentEvidence([
    record({ contradictsClaimIds: ['claim:1'] }),
    record({
      id: 'evidence:independent',
      sourceType: 'FINANCIAL_NEWS',
      sourceName: 'Independent wire',
      sourceUrl: 'https://wire.test/story',
      contentHash: 'fedcba9876543210fedcba9876543210',
      isPrimarySource: false,
      reliabilityTier: 2,
      independenceGroup: 'wire',
    }),
  ], NOW);
  assert.equal(result.recommendationReady, false);
  assert.ok(result.blockers.includes('UNRESOLVED_CONTRADICTION'));
});

test('signal readiness requires documents, metrics, cross-check, thesis, risks and invalidation', () => {
  const blocked = evaluateSignalReadiness({
    evidence: { document: { reviewed: true } },
    fundamentals: { metricsReady: true },
    marketMetrics: { readiness: { marketMetricsReady: true } },
    crossCheck: { recommendationReady: false },
    thesis: 'A'.repeat(100),
    invalidationCondition: 'Revenue guidance is withdrawn.',
    risks: ['Execution risk', 'Funding risk'],
  });
  assert.equal(blocked.publishable, false);
  assert.deepEqual(blocked.blockers, ['INDEPENDENT_CROSS_CHECK_REQUIRED']);

  const ready = evaluateSignalReadiness({
    evidence: { document: { reviewed: true } },
    fundamentals: { metricsReady: true },
    marketMetrics: { readiness: { marketMetricsReady: true } },
    crossCheck: { recommendationReady: true },
    thesis: 'Verified operating improvement and valuation support create a measurable asymmetric setup.'.repeat(2),
    invalidationCondition: 'The thesis is invalidated if verified revenue and liquidity deteriorate materially.',
    risks: ['Execution risk', 'Financing risk'],
  });
  assert.equal(ready.publishable, true);
  assert.equal(ready.stage, 'RECOMMENDATION_READY');
});
