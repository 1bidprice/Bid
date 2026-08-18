import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoricalMarketStackResearch } from '../src/forecast-historical-market-stacked-ensemble-research.js';
import { verifyHistoricalMarketPriorShrunkStackCandidate } from '../src/forecast-historical-market-prior-shrunk-stack-candidate-safety.js';

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function safeCandidate() {
  return buildHistoricalMarketStackResearch([]).priorShrunkCandidate;
}

function notReadyGroup() {
  return {
    modelVariant: 'PRIOR_SHRUNK_SCALAR_MARKET_FACTOR',
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

test('prior-shrunk candidate safety accepts canonical empty research state', () => {
  const candidate = safeCandidate();
  const proof = verifyHistoricalMarketPriorShrunkStackCandidate(candidate, { sourceRecordCount: 0 });
  assert.equal(proof.status, 'VERIFIED');
  assert.equal(proof.predictiveReadyGroupCount, 0);
});

test('prior-shrunk candidate safety rejects authority and raw export tampering', () => {
  const authority = clone(safeCandidate());
  authority.decisionIntegrationEnabled = true;
  assert.throws(() => verifyHistoricalMarketPriorShrunkStackCandidate(authority), /forbidden authority/);

  const raw = clone(safeCandidate());
  raw.rawPredictionsIncluded = true;
  assert.throws(() => verifyHistoricalMarketPriorShrunkStackCandidate(raw), /raw predictions forbidden/);
});

test('prior-shrunk candidate safety rejects weakened scientific floors and anti-leak shrinkage rule tampering', () => {
  const candidate = candidateWithGroup();
  candidate.groups[0].thresholds.minimumSkillPct = 4;
  assert.throws(() => verifyHistoricalMarketPriorShrunkStackCandidate(candidate), /skill threshold too weak/);

  const lineage = clone(safeCandidate());
  lineage.methodology.priorShrinkageRule = 'USE_ALL_OUTCOMES';
  assert.throws(() => verifyHistoricalMarketPriorShrunkStackCandidate(lineage), /prior shrinkage anti-leak rule invalid/);
});

test('prior-shrunk candidate safety rejects count and source-lineage mismatches', () => {
  const candidate = safeCandidate();
  candidate.sourceRecordCount = 1;
  assert.throws(() => verifyHistoricalMarketPriorShrunkStackCandidate(candidate, { sourceRecordCount: 0 }), /source record count mismatch/);
});
