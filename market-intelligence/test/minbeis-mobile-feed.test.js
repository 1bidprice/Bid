import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMobileIntelligenceFeed } from '../src/mobile-intelligence-feed.js';

test('mobile feed attaches canonical MINBEIS decision to confirmed purchase opportunity', () => {
  const generatedAt = '2026-09-21T20:00:00.000Z';
  const report = {
    generatedAt,
    researchDossiers: [{
      dossierId: 'D-STM',
      companyId: 'company:stm',
      companyName: 'STMicroelectronics',
      listing: { symbol: 'STM', exchange: 'NYSE' },
      status: 'PUBLISHED',
      proposedAction: 'CONSIDER_BUY',
      category: 'VALUE_REPRICING',
      generatedAt,
      evidence: [],
      readiness: { blockers: [] },
      finalAction: {
        status: 'FINAL',
        policyVersion: 'fixture',
        marketAction: 'BUY_NOW',
        holderAction: 'HOLD',
        nonHolderAction: 'BUY_NOW',
        urgency: 'IMMEDIATE',
        confidenceScore: 82,
        dataQualityScore: 80,
        blockers: [],
      },
    }],
    opportunityPurchaseReconciliation: {
      decisions: [{
        instrumentId: 'company:stm',
        companyId: 'company:stm',
        dossierId: 'D-STM',
        displayName: 'STMicroelectronics',
        symbol: 'STM',
        assetClass: 'EQUITY',
        tier: 'HIGH_PRIORITY_CANDIDATE',
        opportunityScore: 82,
        status: 'BUY_CONFIRMED',
        statusLabel: 'ΑΓΟΡΑ ΕΠΙΒΕΒΑΙΩΘΗΚΕ',
        buyNowEligible: true,
        strictAction: 'BUY_NOW',
      }],
    },
    operationalHealth: {
      status: 'OPERATIONAL',
      marketDataStatus: 'OPERATIONAL',
      fundamentalsStatus: 'OPERATIONAL',
      decisionEngineStatus: 'READY',
    },
  };

  const feed = buildMobileIntelligenceFeed(report, { generatedAt });
  assert.equal(feed.opportunityPurchaseDecisions.length, 1);
  assert.equal(feed.opportunityPurchaseDecisions[0].minbeisDecision.action, 'BUY_PROBE');
  assert.equal(feed.opportunityPurchaseDecisions[0].minbeisDecision.allocationPct, 0.5);
  assert.equal(feed.opportunityPurchaseDecisions[0].minbeisDecision.humanApprovalRequired, true);
  assert.equal(feed.opportunityPurchaseDecisions[0].minbeisDecision.automaticBrokerOrder, false);
  assert.equal(feed.summary.minbeisProbeCount, 1);
  assert.equal(feed.summary.minbeisStarterCount, 0);
});


test('non-holder decision is gated by strict purchase reconciliation and research direction is not a buy instruction', () => {
  const generatedAt = '2026-10-05T15:00:00.000Z';
  const report = {
    generatedAt,
    researchDossiers: [{
      dossierId: 'D-SNX',
      companyId: 'company:snx',
      companyName: 'TD SYNNEX Corporation',
      listing: { symbol: 'SNX', exchange: 'NYSE' },
      status: 'PUBLISHED',
      proposedAction: 'CONSIDER_BUY',
      category: 'FUNDAMENTAL_QUALITY',
      generatedAt,
      evidence: [],
      readiness: { blockers: [] },
      finalAction: {
        status: 'FINAL',
        policyVersion: 'fixture',
        marketAction: 'BUY_NOW',
        holderAction: 'HOLD',
        nonHolderAction: 'BUY_NOW',
        urgency: 'IMMEDIATE',
        confidenceScore: 90,
        dataQualityScore: 90,
        blockers: [],
        risk: {
          riskScore: 32,
          fundamentalFlags: ['NEGATIVE_FREE_CASH_FLOW'],
          marketFlags: [],
        },
      },
    }],
    opportunityPurchaseReconciliation: { decisions: [] },
  };

  const feed = buildMobileIntelligenceFeed(report, { generatedAt });
  const item = feed.published[0];
  assert.equal(item.actionLabel, 'Θετική κατεύθυνση έρευνας');
  assert.equal(item.nonHolderDecision.action, 'NO_BUY');
  assert.equal(item.nonHolderDecision.reason, 'BUY_NOW_REQUIRES_CONFIRMED_PURCHASE_RECONCILIATION');
  assert.equal(item.minbeisAssessment.classification, 'CONFIRMATION_REQUIRED');
  assert.notEqual(item.minbeisAssessment.classification, 'TRAP');
});
