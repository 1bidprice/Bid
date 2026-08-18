import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMobileIntelligenceFeed } from '../src/mobile-intelligence-feed.js';

const NOW = '2026-07-27T12:00:00.000Z';

function dossier(overrides = {}) {
  return {
    dossierId: 'dossier:company:test:1',
    companyId: 'company:test',
    companyName: 'Test Company',
    listing: { exchange: 'Test Exchange', symbol: 'TEST' },
    generatedAt: NOW,
    status: 'DRAFT_RESEARCH',
    category: 'EVENT_RISK',
    proposedAction: 'CONSIDER_REDUCE',
    timeHorizon: 'WEEKS',
    referencePrice: null,
    thesis: 'A reviewed financing event creates a material risk that remains incomplete until market and independent evidence are available.',
    causalMechanism: 'Financing terms can transfer future value away from existing shareholders.',
    bullCase: 'The financing funds a value-creating milestone.',
    bearCase: 'The company requires repeated dilutive financing.',
    catalysts: [],
    risks: [],
    invalidationCondition: 'The risk thesis changes if funding closes on favourable terms and milestones are achieved.',
    reviewDate: '2026-08-27',
    evidence: [{
      sourceName: 'Issuer IR',
      sourceType: 'ISSUER_IR',
      title: 'Financing event',
      sourceUrl: 'https://issuer.test/event',
      publishedAt: NOW,
      documentStatus: 'REVIEWED_TEXT',
      isPrimarySource: true,
      companyIds: ['company:test'],
    }],
    readiness: {
      publishable: false,
      blockers: ['HISTORICAL_MARKET_METRICS_REQUIRED', 'REVIEWED_INDEPENDENT_CORROBORATION_REQUIRED'],
    },
    ...overrides,
  };
}

test('draft directional research is rendered as WATCH with blockers and one next action', () => {
  const feed = buildMobileIntelligenceFeed({
    generatedAt: NOW,
    researchDossiers: [dossier()],
    diagnostics: [{ code: 'MARKET_HISTORY_NO_DATA' }],
  });
  assert.equal(feed.format, 'investor-control-mobile-intelligence-feed');
  assert.equal(feed.summary.researchCount, 1);
  assert.equal(feed.summary.urgentCount, 1);
  assert.equal(feed.research[0].action, 'WATCH');
  assert.equal(feed.research[0].actionLabel, 'Παρακολούθηση');
  assert.equal(feed.research[0].categoryLabel, 'Σημαντικό επερχόμενο ρίσκο');
  assert.ok(feed.research[0].blockerLabels.includes('Λείπει επαρκές ιστορικό τιμής και όγκου'));
  assert.equal(feed.research[0].nextStep, 'Εύρεση και ανάγνωση ανεξάρτητης αξιόπιστης πηγής');
  assert.deepEqual(feed.research[0].sources[0].companyIds, ['company:test']);
  assert.equal(feed.today.primaryItem.id, dossier().dossierId);
  assert.equal(feed.assistantContext[0].action, 'WATCH');
  assert.equal('sources' in feed.assistantContext[0], false);
});

test('review-ready and published dossiers retain supported actions and separate sections', () => {
  const reviewReady = dossier({
    dossierId: 'dossier:company:ready:1',
    companyId: 'company:ready',
    companyName: 'Ready Company',
    status: 'REVIEW_READY',
    category: 'EVENT_DRIVEN',
    proposedAction: 'CONSIDER_BUY',
    referencePrice: { value: 10, currency: 'EUR', timestamp: NOW, source: 'Market data' },
    readiness: { publishable: true, blockers: [] },
  });
  const published = dossier({
    dossierId: 'dossier:company:published:1',
    companyId: 'company:published',
    companyName: 'Published Company',
    status: 'PUBLISHED',
    category: 'QUALITY_COMPOUNDER',
    proposedAction: 'HOLD',
    referencePrice: { value: 20, currency: 'EUR', timestamp: NOW, source: 'Market data' },
    readiness: { publishable: true, blockers: [] },
  });
  const feed = buildMobileIntelligenceFeed({ generatedAt: NOW, researchDossiers: [reviewReady, published], diagnostics: [] });
  assert.equal(feed.summary.reviewReadyCount, 1);
  assert.equal(feed.summary.publishedCount, 1);
  assert.equal(feed.reviewReady[0].action, 'CONSIDER_BUY');
  assert.equal(feed.reviewReady[0].nextStep, 'Τελικός έλεγχος και απόφαση δημοσίευσης');
  assert.equal(feed.published[0].action, 'HOLD');
  assert.equal(feed.published[0].statusLabel, 'Δημοσιευμένη ανάλυση');
  assert.equal(feed.published[0].nextStep, 'Έλεγχος τεκμηρίωσης');
});

test('a final action tells the user to read the evidence and decide, not to check the dossier afterwards', () => {
  const published = dossier({
    status: 'PUBLISHED',
    category: 'FUNDAMENTAL_QUALITY',
    proposedAction: 'CONSIDER_BUY',
    referencePrice: { value: 20, currency: 'EUR', timestamp: NOW, source: 'Market data' },
    readiness: { publishable: true, blockers: [] },
    finalAction: {
      status: 'FINAL',
      marketAction: 'BUY_NOW',
      marketActionLabel: 'ΑΜΕΣΗ ΑΓΟΡΑ',
      nonHolderAction: 'BUY_NOW',
      nonHolderActionLabel: 'ΑΜΕΣΗ ΑΓΟΡΑ',
      confidenceScore: 84,
      dataQualityScore: 90,
      generatedAt: NOW,
      validUntil: '2026-07-27T14:00:00.000Z',
    },
  });
  const feed = buildMobileIntelligenceFeed({ generatedAt: NOW, researchDossiers: [published], diagnostics: [] });
  assert.equal(feed.published[0].nextStep, 'Ανάγνωση τεκμηρίωσης και δική σου τελική απόφαση');
  assert.notEqual(feed.published[0].nextStep, 'Έλεγχος του πλήρους φακέλου');
});

test('entity mismatch blocker is shown plainly instead of presenting unsupported certainty', () => {
  const blocked = dossier({
    readiness: { publishable: false, blockers: ['EVIDENCE_ENTITY_MISMATCH'] },
  });
  const feed = buildMobileIntelligenceFeed({ generatedAt: NOW, researchDossiers: [blocked], diagnostics: [] });
  assert.ok(feed.research[0].blockerLabels.includes('Εντοπίστηκε πηγή που ανήκει σε άλλη εταιρεία'));
  assert.equal(feed.research[0].nextStep, 'Αφαίρεση των πηγών άλλης εταιρείας και νέα διασταύρωση');
});

test('empty report produces a valid no-op feed rather than invented opportunities', () => {
  const feed = buildMobileIntelligenceFeed({ generatedAt: NOW, researchDossiers: [], diagnostics: [] });
  assert.equal(feed.summary.publishedCount, 0);
  assert.equal(feed.summary.reviewReadyCount, 0);
  assert.equal(feed.summary.researchCount, 0);
  assert.equal(feed.today.primaryItem, null);
  assert.equal(feed.today.headline, 'Δεν υπάρχει ακόμη δημοσιεύσιμη επενδυτική πρόταση');
});
