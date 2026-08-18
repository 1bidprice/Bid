import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMobileIntelligenceFeed } from '../src/mobile-intelligence-feed.js';

const NOW = '2026-08-18T17:44:01.566Z';

function dossier(overrides = {}) {
  return {
    dossierId: 'dossier:company:test:integrity',
    companyId: 'company:test',
    companyName: 'Integrity Test Co',
    listing: { symbol: 'SAFE', exchange: 'Nasdaq', mic: 'XNAS' },
    generatedAt: NOW,
    status: 'REVIEW_READY',
    category: 'FUNDAMENTAL_QUALITY',
    proposedAction: 'CONSIDER_BUY',
    timeHorizon: 'MONTHS',
    referencePrice: { value: 10, currency: 'USD', timestamp: NOW, source: 'Verified feed' },
    thesis: 'Synthetic integrity regression dossier used only to prove that a blocked final action cannot be presented to the user as a buy recommendation.',
    causalMechanism: 'A missing listing verification must stop the decision layer before any purchase instruction reaches the mobile user.',
    bullCase: 'Not applicable to the integrity assertion.',
    bearCase: 'Not applicable to the integrity assertion.',
    catalysts: [],
    risks: [],
    invalidationCondition: 'The integrity blocker is removed only after listing verification.',
    reviewDate: '2026-09-18',
    evidence: [{ sourceName: 'Test', sourceType: 'TEST', title: 'Test evidence', sourceUrl: 'https://example.test', publishedAt: NOW, companyIds: ['company:test'] }],
    readiness: { publishable: true, blockers: [] },
    finalAction: {
      status: 'BLOCKED',
      marketAction: 'WATCH',
      marketActionLabel: 'ΠΑΡΑΚΟΛΟΥΘΗΣΗ',
      holderAction: 'WATCH',
      nonHolderAction: 'WATCH',
      confidenceScore: 79,
      confidenceMeaning: 'POLICY_COMPLETENESS_HEURISTIC_NOT_PROBABILITY',
      dataQualityScore: 79,
      blockers: ['ACTIVE_LISTING_NOT_VERIFIED'],
      generatedAt: NOW,
      validUntil: '2026-08-19T17:44:01.566Z',
    },
    ...overrides,
  };
}

test('blocked final action overrides a draft buy intent everywhere in the mobile card', () => {
  const feed = buildMobileIntelligenceFeed({ generatedAt: NOW, researchDossiers: [dossier()], diagnostics: [] });
  const item = feed.reviewReady[0];
  assert.equal(item.action, 'WATCH');
  assert.equal(item.actionLabel, 'Παρακολούθηση');
  assert.ok(item.blockers.includes('ACTIVE_LISTING_NOT_VERIFIED'));
  assert.ok(item.blockerLabels.includes('Δεν έχει επιβεβαιωθεί ότι η μετοχή διαπραγματεύεται ακόμη ενεργά'));
  assert.equal(item.nextStep, 'Επιβεβαίωση ότι η μετοχή διαπραγματεύεται ακόμη ενεργά');
  assert.equal(item.finalAction.status, 'BLOCKED');
  assert.equal(item.finalAction.marketAction, 'WATCH');
});

test('cross-company blocker is surfaced as WATCH rather than a probable buy', () => {
  const feed = buildMobileIntelligenceFeed({
    generatedAt: NOW,
    researchDossiers: [dossier({
      finalAction: {
        ...dossier().finalAction,
        blockers: ['EVIDENCE_ENTITY_MISMATCH'],
      },
    })],
    diagnostics: [],
  });
  const item = feed.reviewReady[0];
  assert.equal(item.action, 'WATCH');
  assert.ok(item.blockerLabels.includes('Εντοπίστηκε πηγή που ανήκει σε άλλη εταιρεία'));
  assert.equal(item.nextStep, 'Αφαίρεση των πηγών άλλης εταιρείας και νέα διασταύρωση');
});
