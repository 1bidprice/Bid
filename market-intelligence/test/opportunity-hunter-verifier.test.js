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
  };
}

test('hunter verifier accepts a valid broad-market-screen -> opportunity -> deep-verification chain', () => {
  const result = verifyOpportunityHunterReport(validReport());
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.marketStageContractActive, true);
  assert.equal(result.marketScreenScorable, 8);
  assert.equal(result.superOpportunityCount, 1);
  assert.equal(result.highPriorityCount, 1);
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
