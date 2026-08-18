import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOpportunityHunterReport } from '../scripts/verify-opportunity-hunter-output.js';

function validReport() {
  return {
    universeExpansion: {
      broadScreenCompanyCount: 1,
      opportunityScannedInstrumentCount: 2,
      opportunityScorableInstrumentCount: 2,
    },
    broadOpportunityScan: {
      marketScreenStatus: 'ACTIVE',
      marketScreenPolicyVersion: '2026-08-09.1',
      marketScreenInputCount: 10,
      marketScreenScorableCount: 8,
      marketScreenEligibleCount: 5,
      candidates: [{
        instrumentId: 'eq:alpha',
        companyId: 'sec-cik:1',
        broadScreen: {
          finalActionEligible: false,
          marketScreen: {
            score: 88,
            finalActionEligible: false,
            severeMarketRisk: false,
          },
        },
      }],
      specializedQuarantineCount: 1,
      specializedQuarantine: [{
        instrumentId: 'eq:bank',
        companyId: 'sec-cik:2',
        reason: 'SPECIALIZED_MODEL_REQUIRES_DEDICATED_OPPORTUNITY_LANE',
        model: { specializedModelRequired: true, type: 'FINANCIAL_INSTITUTION' },
      }],
    },
    opportunityUniverse: {
      uniqueInstrumentCount: 2,
      scorableInstrumentCount: 2,
      ranking: {
        scannedCount: 2,
        rankedCount: 2,
        superOpportunityCount: 1,
        highPriorityCount: 1,
        items: [
          {
            rank: 1,
            instrumentId: 'eq:alpha',
            tier: 'SUPER_OPPORTUNITY_CANDIDATE',
            opportunityScore: 91,
            factorCoverageScore: 92,
            evidenceQualityScore: 90,
            executionQualityScore: 80,
            contradictionCount: 0,
            severeRiskFlags: [],
            peerSampleSize: 8,
            discoveryAction: 'DEEP_VERIFY_NOW',
            finalActionEligible: false,
          },
          {
            rank: 2,
            instrumentId: 'bond:beta',
            tier: 'HIGH_PRIORITY_CANDIDATE',
            opportunityScore: 80,
            factorCoverageScore: 82,
            evidenceQualityScore: 75,
            executionQualityScore: 70,
            contradictionCount: 0,
            severeRiskFlags: [],
            discoveryAction: 'DEEP_VERIFY',
            finalActionEligible: false,
          },
        ],
      },
    },
    opportunityDeepVerificationQueue: [
      {
        rank: 1,
        instrumentId: 'eq:alpha',
        tier: 'SUPER_OPPORTUNITY_CANDIDATE',
        opportunityScore: 91,
        action: 'DEEP_VERIFY_NOW',
        finalActionEligible: false,
        nextGate: 'FULL_VERIFICATION_AND_FINAL_ACTION_POLICY',
      },
      {
        rank: 2,
        instrumentId: 'bond:beta',
        tier: 'HIGH_PRIORITY_CANDIDATE',
        opportunityScore: 80,
        action: 'DEEP_VERIFY',
        finalActionEligible: false,
        nextGate: 'FULL_VERIFICATION_AND_FINAL_ACTION_POLICY',
      },
    ],
    opportunityPurchaseReconciliation: {
      format: 'investor-control-opportunity-purchase-reconciliation',
      version: 1,
      candidateCount: 2,
      counts: {
        BUY_CONFIRMED: 1,
        WAIT_FOR_ENTRY_CONFIRMATION: 1,
        REJECTED: 0,
        BLOCKED: 0,
        NO_DEEP_DOSSIER: 0,
      },
      decisions: [
        {
          instrumentId: 'eq:alpha',
          tier: 'SUPER_OPPORTUNITY_CANDIDATE',
          opportunityScore: 91,
          status: 'BUY_CONFIRMED',
          buyNowEligible: true,
          strictAction: {
            status: 'FINAL',
            marketAction: 'BUY_NOW',
            nonHolderAction: 'BUY_NOW',
            holderAction: 'HOLD',
            execution: {
              automaticBrokerOrder: false,
              requiresUserExecution: true,
            },
          },
          nextGate: 'USER_EXECUTION_ONLY',
          automaticBrokerOrder: false,
        },
        {
          instrumentId: 'bond:beta',
          tier: 'HIGH_PRIORITY_CANDIDATE',
          opportunityScore: 80,
          status: 'WAIT_FOR_ENTRY_CONFIRMATION',
          buyNowEligible: false,
          strictAction: {
            status: 'FINAL',
            marketAction: 'WATCH',
            nonHolderAction: 'DO_NOT_BUY',
            holderAction: 'HOLD',
            execution: {
              automaticBrokerOrder: false,
              requiresUserExecution: true,
            },
          },
          nextGate: 'RECHECK_STRICT_BUY_GATES',
          automaticBrokerOrder: false,
        },
      ],
    },
  };
}

test('hunter verifier accepts a valid broad-market-screen -> opportunity -> strict purchase reconciliation chain', () => {
  const result = verifyOpportunityHunterReport(validReport());
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.marketStageContractActive, true);
  assert.equal(result.marketScreenScorable, 8);
  assert.equal(result.superOpportunityCount, 1);
  assert.equal(result.highPriorityCount, 1);
  assert.equal(result.confirmedBuyCount, 1);
  assert.equal(result.waitingEntryCount, 1);
  assert.equal(result.deepVerificationQueueCount, 2);
});

test('hunter verifier rejects broad, market-stage or ranked opportunity leakage into final-action eligibility', () => {
  const broadLeak = validReport();
  broadLeak.broadOpportunityScan.candidates[0].broadScreen.finalActionEligible = true;
  assert.throws(() => verifyOpportunityHunterReport(broadLeak), /broad candidate can become final action/);

  const marketLeak = validReport();
  marketLeak.broadOpportunityScan.candidates[0].broadScreen.marketScreen.finalActionEligible = true;
  assert.throws(() => verifyOpportunityHunterReport(marketLeak), /market screen can become final action/);

  const superLeak = validReport();
  superLeak.opportunityUniverse.ranking.items[0].finalActionEligible = true;
  assert.throws(() => verifyOpportunityHunterReport(superLeak), /opportunity score bypassed final-action gate/);
});

test('hunter verifier rejects market-stage bypass, severe market risk, specialized leakage and weak super classification', () => {
  const missingMarket = validReport();
  delete missingMarket.broadOpportunityScan.candidates[0].broadScreen.marketScreen;
  assert.throws(() => verifyOpportunityHunterReport(missingMarket), /broad candidate bypassed market screen/);

  const severeMarket = validReport();
  severeMarket.broadOpportunityScan.candidates[0].broadScreen.marketScreen.severeMarketRisk = true;
  assert.throws(() => verifyOpportunityHunterReport(severeMarket), /severe market-risk candidate leaked into deep lane/);

  const specializedLeak = validReport();
  specializedLeak.broadOpportunityScan.specializedQuarantine[0].instrumentId = 'eq:alpha';
  assert.throws(() => verifyOpportunityHunterReport(specializedLeak), /specialized candidate leaked into generic broad lane/);

  const weakSuper = validReport();
  weakSuper.opportunityUniverse.ranking.items[0].peerSampleSize = 3;
  assert.throws(() => verifyOpportunityHunterReport(weakSuper), /super peer sample too small/);
});

test('BUY_CONFIRMED is rejected unless the same strict policy produced FINAL BUY_NOW for a non-holder', () => {
  const noStrictBuy = validReport();
  noStrictBuy.opportunityPurchaseReconciliation.decisions[0].strictAction.marketAction = 'WATCH';
  assert.throws(() => verifyOpportunityHunterReport(noStrictBuy), /BUY_CONFIRMED lacks BUY_NOW marketAction/);

  const noNonHolderBuy = validReport();
  noNonHolderBuy.opportunityPurchaseReconciliation.decisions[0].strictAction.nonHolderAction = 'DO_NOT_BUY';
  assert.throws(() => verifyOpportunityHunterReport(noNonHolderBuy), /BUY_CONFIRMED lacks BUY_NOW nonHolderAction/);

  const notFinal = validReport();
  notFinal.opportunityPurchaseReconciliation.decisions[0].strictAction.status = 'BLOCKED';
  assert.throws(() => verifyOpportunityHunterReport(notFinal), /BUY_CONFIRMED lacks FINAL strict action/);
});

test('purchase reconciliation can never enable automatic trading or mark WAIT as buy-now eligible', () => {
  const autoTrade = validReport();
  autoTrade.opportunityPurchaseReconciliation.decisions[0].strictAction.execution.automaticBrokerOrder = true;
  assert.throws(() => verifyOpportunityHunterReport(autoTrade), /BUY_CONFIRMED enabled automatic order/);

  const waitLeak = validReport();
  waitLeak.opportunityPurchaseReconciliation.decisions[1].buyNowEligible = true;
  assert.throws(() => verifyOpportunityHunterReport(waitLeak), /non-confirmed purchase decision is buyNowEligible/);
});

test('purchase reconciliation must match the ranked opportunity identity, tier and score exactly', () => {
  const tierMismatch = validReport();
  tierMismatch.opportunityPurchaseReconciliation.decisions[0].tier = 'HIGH_PRIORITY_CANDIDATE';
  assert.throws(() => verifyOpportunityHunterReport(tierMismatch), /purchase decision tier mismatch/);

  const scoreMismatch = validReport();
  scoreMismatch.opportunityPurchaseReconciliation.decisions[0].opportunityScore = 90;
  assert.throws(() => verifyOpportunityHunterReport(scoreMismatch), /purchase decision score mismatch/);
});
