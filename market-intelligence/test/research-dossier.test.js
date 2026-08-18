import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchDossier, publishResearchDossier } from '../src/research-dossier.js';

const NOW = '2026-07-27T14:00:00.000Z';
const COMPANY = {
  companyId: 'company:test',
  legalName: 'Test Company plc',
  displayName: 'Test Company',
  primaryListing: { exchange: 'Test Exchange', symbol: 'TEST', mic: 'XTST' },
};

function evidence(overrides = {}) {
  return {
    id: 'evidence:issuer:1',
    sourceType: 'ISSUER_IR',
    sourceName: 'Issuer IR',
    sourceUrl: 'https://issuer.test/report',
    publishedAt: NOW,
    contentHash: '0123456789abcdef0123456789abcdef',
    independenceGroup: 'issuer',
    reliabilityTier: 1,
    isPrimarySource: true,
    claimType: 'FACT',
    contradictsClaimIds: [],
    supportsClaimIds: [],
    document: { reviewed: true, status: 'REVIEWED_TEXT' },
    ...overrides,
  };
}

function completeInput() {
  return {
    company: COMPANY,
    generatedAt: NOW,
    category: 'EVENT_DRIVEN',
    proposedAction: 'CONSIDER_BUY',
    timeHorizon: 'MONTHS',
    evidence: [
      evidence(),
      evidence({
        id: 'evidence:wire:2',
        sourceType: 'FINANCIAL_NEWS',
        sourceName: 'Independent Wire',
        sourceUrl: 'https://wire.test/story',
        contentHash: 'fedcba9876543210fedcba9876543210',
        independenceGroup: 'wire',
        reliabilityTier: 2,
        isPrimarySource: false,
      }),
    ],
    fundamentals: { metricsReady: true },
    historicalMarketMetrics: {
      latestClose: 12.5,
      latestTimestamp: 1_752_000_000,
      currency: 'EUR',
      readiness: { marketMetricsReady: true },
    },
    fundamentalRisk: { metricsReady: true, riskScore: 45, flags: ['EXECUTION_RISK'] },
    thesis: 'Verified revenue growth, improving cash generation and price confirmation create a measurable event-driven opportunity with defined downside controls.',
    causalMechanism: 'The verified catalyst should improve expected cash generation and cause investors to reassess the company valuation.',
    catalysts: [{
      text: 'A verified commercial contract begins contributing revenue during the review period.',
      evidenceIds: ['evidence:issuer:1'],
      confidence: 0.9,
    }],
    bullCase: 'Execution exceeds the verified base case, margins expand and the market assigns a higher valuation multiple.',
    bearCase: 'Execution is delayed, costs rise and the expected revenue contribution fails to appear in reported results.',
    risks: [
      { text: 'Execution may be delayed.', evidenceIds: ['evidence:issuer:1'], confidence: 0.8 },
      { text: 'Valuation may already reflect the catalyst.', evidenceIds: ['evidence:wire:2'], confidence: 0.7, inference: true },
    ],
    invalidationCondition: 'The thesis is invalidated if the verified contract is cancelled or the expected revenue is absent at the next review.',
    reviewDate: '2026-10-27',
  };
}

test('incomplete dossier stays draft and cannot leak a buy action', () => {
  const dossier = buildResearchDossier({
    company: COMPANY,
    generatedAt: NOW,
    category: 'EVENT_DRIVEN',
    proposedAction: 'CONSIDER_BUY',
    evidence: [evidence()],
    fundamentals: { metricsReady: false },
    historicalMarketMetrics: { readiness: { marketMetricsReady: false } },
  });
  assert.equal(dossier.status, 'DRAFT_RESEARCH');
  assert.equal(dossier.proposedAction, 'WATCH');
  assert.equal(dossier.readiness.publishable, false);
  assert.ok(dossier.readiness.blockers.includes('INDEPENDENT_CROSS_CHECK_REQUIRED'));
  assert.ok(dossier.readiness.blockers.includes('THESIS_REQUIRED'));
  assert.throws(() => publishResearchDossier(dossier), /not publishable/);
});

test('complete evidence-backed dossier becomes review ready before explicit publication', () => {
  const dossier = buildResearchDossier(completeInput());
  assert.equal(dossier.readiness.publishable, true, JSON.stringify(dossier.readiness, null, 2));
  assert.equal(dossier.status, 'REVIEW_READY');
  assert.equal(dossier.proposedAction, 'CONSIDER_BUY');
  assert.equal(dossier.evidence.length, 2);
  assert.equal(dossier.referencePrice.value, 12.5);

  const published = publishResearchDossier(dossier);
  assert.equal(published.status, 'PUBLISHED');
});
