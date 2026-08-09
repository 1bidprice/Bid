import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMobileIntelligenceFeed } from '../src/mobile-intelligence-feed.js';

const generatedAt = '2026-08-10T14:00:00.000Z';

function strictAction(marketAction, nonHolderAction) {
  return {
    status: 'FINAL',
    marketAction,
    holderAction: 'HOLD',
    nonHolderAction,
    urgency: marketAction === 'BUY_NOW' ? 'IMMEDIATE' : 'NONE',
    confidenceScore: 90,
    dataQualityScore: 90,
    execution: {
      automaticBrokerOrder: false,
      requiresUserExecution: true,
    },
  };
}

function purchaseDecision(overrides = {}) {
  return {
    instrumentId: 'company:alpha',
    companyId: 'company:alpha',
    dossierId: 'dossier:alpha',
    displayName: 'Alpha Opportunity',
    symbol: 'ALFA',
    assetClass: 'EQUITY',
    tier: 'SUPER_OPPORTUNITY_CANDIDATE',
    opportunityScore: 91,
    opportunityConfidenceScore: 93,
    status: 'BUY_CONFIRMED',
    statusLabel: 'ΑΓΟΡΑ ΕΠΙΒΕΒΑΙΩΘΗΚΕ',
    buyNowEligible: true,
    strictAction: strictAction('BUY_NOW', 'BUY_NOW'),
    whyNotBuyNow: [],
    nextGate: 'USER_EXECUTION_ONLY',
    automaticBrokerOrder: false,
    ...overrides,
  };
}

function report(decisions) {
  return {
    generatedAt,
    policyVersion: '2026-08-09.1',
    researchDossiers: [],
    discovery: {
      sourcePolicy: { selector: 'DETERMINISTIC_SOURCE_GOVERNOR' },
      shortlist: [{
        discoveryId: 'disc:noise',
        companyId: 'company:noise',
        companyName: 'Noise Discovery',
        symbol: 'NOISE',
        exchange: 'NYSE',
        discoveryScore: 99,
        status: 'DISCOVERED',
        reasons: ['EVENT'],
        latestEventAt: generatedAt,
        events: [],
        isExistingFocusCompany: false,
      }],
    },
    opportunityPurchaseReconciliation: {
      decisions,
      counts: {
        BUY_CONFIRMED: decisions.filter((item) => item.status === 'BUY_CONFIRMED').length,
        WAIT_FOR_ENTRY_CONFIRMATION: decisions.filter((item) => item.status === 'WAIT_FOR_ENTRY_CONFIRMATION').length,
        REJECTED: decisions.filter((item) => item.status === 'REJECTED').length,
        BLOCKED: decisions.filter((item) => item.status === 'BLOCKED').length,
        NO_DEEP_DOSSIER: decisions.filter((item) => item.status === 'NO_DEEP_DOSSIER').length,
      },
    },
  };
}

test('mobile feed exposes confirmed, waiting and rejected opportunity purchase states separately', () => {
  const confirmed = purchaseDecision();
  const waiting = purchaseDecision({
    instrumentId: 'company:wait',
    companyId: 'company:wait',
    dossierId: 'dossier:wait',
    displayName: 'Wait Opportunity',
    symbol: 'WAIT',
    tier: 'HIGH_PRIORITY_CANDIDATE',
    opportunityScore: 80,
    status: 'WAIT_FOR_ENTRY_CONFIRMATION',
    statusLabel: 'ΠΕΡΙΜΕΝΕ — ΔΕΝ ΕΠΙΒΕΒΑΙΩΘΗΚΕ ΑΚΟΜΗ ΕΙΣΟΔΟΣ',
    buyNowEligible: false,
    strictAction: strictAction('WATCH', 'DO_NOT_BUY'),
    whyNotBuyNow: ['BUY_SETUP_NOT_CONFIRMED'],
    nextGate: 'RECHECK_STRICT_BUY_GATES',
  });
  const rejected = purchaseDecision({
    instrumentId: 'company:reject',
    companyId: 'company:reject',
    dossierId: 'dossier:reject',
    displayName: 'Rejected Opportunity',
    symbol: 'NOPE',
    tier: 'HIGH_PRIORITY_CANDIDATE',
    opportunityScore: 79,
    status: 'REJECTED',
    statusLabel: 'ΑΠΟΡΡΙΦΘΗΚΕ ΓΙΑ ΑΓΟΡΑ',
    buyNowEligible: false,
    strictAction: strictAction('AVOID', 'AVOID'),
    whyNotBuyNow: ['SEVERE_RISK_CONFIGURATION'],
    nextGate: 'NEW_EVIDENCE_OR_MATERIAL_CHANGE',
  });

  const feed = buildMobileIntelligenceFeed(report([confirmed, waiting, rejected]), { generatedAt });

  assert.equal(feed.summary.opportunityCandidateCount, 3);
  assert.equal(feed.summary.confirmedBuyOpportunityCount, 1);
  assert.equal(feed.summary.waitingEntryOpportunityCount, 1);
  assert.equal(feed.summary.rejectedOpportunityCount, 1);
  assert.equal(feed.confirmedBuyOpportunities.length, 1);
  assert.equal(feed.waitingEntryOpportunities.length, 1);
  assert.equal(feed.rejectedOpportunities.length, 1);
  assert.equal(feed.confirmedBuyOpportunities[0].buyNowEligible, true);
  assert.equal(feed.confirmedBuyOpportunities[0].strictAction.marketAction, 'BUY_NOW');
  assert.equal(feed.confirmedBuyOpportunities[0].automaticBrokerOrder, false);
  assert.equal(feed.waitingEntryOpportunities[0].buyNowEligible, false);
  assert.ok(feed.waitingEntryOpportunities[0].whyNotBuyNow.includes('BUY_SETUP_NOT_CONFIRMED'));
  assert.match(feed.today.headline, /ευκαιρία αγοράς επιβεβαιώθηκε/);
  assert.equal(feed.today.primaryItem.instrumentId, 'company:alpha');
  assert.match(feed.disclosure, /High\/Super Opportunity δεν σημαίνει αγορά/);
});

test('waiting opportunity becomes today primary item when no BUY is confirmed', () => {
  const waiting = purchaseDecision({
    instrumentId: 'company:wait',
    companyId: 'company:wait',
    dossierId: 'dossier:wait',
    displayName: 'Wait Opportunity',
    symbol: 'WAIT',
    tier: 'HIGH_PRIORITY_CANDIDATE',
    opportunityScore: 81,
    status: 'WAIT_FOR_ENTRY_CONFIRMATION',
    statusLabel: 'ΠΕΡΙΜΕΝΕ — ΔΕΝ ΕΠΙΒΕΒΑΙΩΘΗΚΕ ΑΚΟΜΗ ΕΙΣΟΔΟΣ',
    buyNowEligible: false,
    strictAction: strictAction('WATCH', 'DO_NOT_BUY'),
    whyNotBuyNow: ['BUY_SETUP_NOT_CONFIRMED'],
    nextGate: 'RECHECK_STRICT_BUY_GATES',
  });

  const feed = buildMobileIntelligenceFeed(report([waiting]), { generatedAt });
  assert.equal(feed.summary.confirmedBuyOpportunityCount, 0);
  assert.equal(feed.summary.waitingEntryOpportunityCount, 1);
  assert.match(feed.today.headline, /ισχυρή ευκαιρία υπό αναμονή επιβεβαίωσης εισόδου/);
  assert.equal(feed.today.primaryItem.instrumentId, 'company:wait');
});
