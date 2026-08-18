import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoricalMarketStackResearch } from '../src/forecast-historical-market-stacked-ensemble-research.js';
import { verifyHistoricalMarketDomainStackCandidate } from '../src/forecast-historical-market-domain-stack-candidate-safety.js';

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function safeCandidate() {
  return buildHistoricalMarketStackResearch([]).domainSeparatedCandidate;
}

function notReadyGroup() {
  return {
    modelVariant: 'DOMAIN_SEPARATED_MARKET_FACTOR',
    status: 'HISTORICAL_MARKET_STACK_PREDICTIVE_NOT_READY',
    thresholds: {
      minimumEvaluationSample: 200,
      minimumClassCount: 40,
      minimumSkillPct: 5,
      maximumEce: 0.08,
      minimumBrierImprovementPct: 3,
      minimumLogLossImprovementPct: 0,
      minimumEceImprovement: -0.01,
      minimumDistinctForecastDates: 40,
      minimumDistinctInstruments: 10,
      maximumSingleForecastDateSharePct: 10,
      minimumEffectiveNonOverlappingWindows: 12,
      maximumSingleInstrumentSharePct: 25,
      minimumEffectiveInstrumentCount: 6,
      chronologicalBlockCount: 3,
      minimumChronologicalBlockSample: 20,
    },
    blockers: ['HISTORICAL_MARKET_STACK_PREDICTION_SAMPLE_TOO_SMALL'],
    taxonomyHistoricalBackfillAllowed: false,
    taxonomyPromotionEligible: false,
    historicalResearchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

function candidateWithGroup() {
  const candidate = clone(safeCandidate());
  candidate.groupCount = 1;
  candidate.predictiveReadyGroupCount = 0;
  candidate.predictiveNotReadyGroupCount = 1;
  candidate.groups = [notReadyGroup()];
  return candidate;
}

test('domain candidate safety accepts canonical empty research state', () => {
  const candidate = safeCandidate();
  const proof = verifyHistoricalMarketDomainStackCandidate(candidate, { sourceRecordCount: 0 });
  assert.equal(proof.status, 'VERIFIED');
  assert.equal(proof.predictiveReadyGroupCount, 0);
});

test('domain candidate safety rejects authority and raw export tampering', () => {
  const authority = clone(safeCandidate());
  authority.decisionIntegrationEnabled = true;
  assert.throws(() => verifyHistoricalMarketDomainStackCandidate(authority), /forbidden authority/);

  const raw = clone(safeCandidate());
  raw.rawPredictionsIncluded = true;
  assert.throws(() => verifyHistoricalMarketDomainStackCandidate(raw), /raw predictions forbidden/);
});

test('domain candidate safety independently rejects weakened scientific floors', () => {
  const candidate = candidateWithGroup();
  candidate.groups[0].thresholds.minimumSkillPct = 4;
  assert.throws(() => verifyHistoricalMarketDomainStackCandidate(candidate), /skill threshold too weak/);
});

test('domain candidate safety rejects count and source-lineage mismatches', () => {
  const candidate = safeCandidate();
  candidate.sourceRecordCount = 1;
  assert.throws(() => verifyHistoricalMarketDomainStackCandidate(candidate, { sourceRecordCount: 0 }), /source record count mismatch/);
});
