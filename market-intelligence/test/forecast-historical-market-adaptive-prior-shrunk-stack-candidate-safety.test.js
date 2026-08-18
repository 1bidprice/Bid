import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoricalMarketAdaptivePriorShrunkStackResearch } from '../src/forecast-historical-market-stacked-ensemble-research.js';
import { verifyHistoricalMarketAdaptivePriorShrunkStackCandidate } from '../src/forecast-historical-market-adaptive-prior-shrunk-stack-candidate-safety.js';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function candidate() { return buildHistoricalMarketAdaptivePriorShrunkStackResearch([]); }

function notReadyGroup() {
  return {
    modelVariant: 'ADAPTIVE_PRIOR_SHRUNK_SCALAR_MARKET_FACTOR',
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

test('adaptive candidate safety accepts canonical research-only state', () => {
  const value = candidate();
  const proof = verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(value, { sourceRecordCount: 0 });
  assert.equal(proof.status, 'VERIFIED');
  assert.deepEqual(proof.adaptiveSupportFloorGrid, value.adaptiveSupportFloorGrid);
  assert.equal(proof.adaptiveSelectionReadyPredictionCount, 0);
  assert.equal(proof.adaptiveSelectionWarmupPredictionCount, 0);
});

test('adaptive candidate safety rejects authority and raw export tampering', () => {
  const authority = clone(candidate());
  authority.decisionIntegrationEnabled = true;
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(authority), /forbidden authority/);

  const rawPredictions = clone(candidate());
  rawPredictions.rawPredictionsIncluded = true;
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(rawPredictions), /raw predictions forbidden/);

  const rawHistory = clone(candidate());
  rawHistory.rawHistoricalRecordsIncluded = true;
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(rawHistory), /raw records forbidden/);
});

test('adaptive candidate safety rejects support-grid and chronology tampering', () => {
  const grid = clone(candidate());
  grid.adaptiveSupportFloorGrid = [60, 120, 240, 360];
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(grid), /support-floor grid invalid/);

  const chronology = clone(candidate());
  chronology.methodology.adaptiveSelectionRule = 'INVALID';
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(chronology), /anti-leak selection rule invalid/);

  const prior = clone(candidate());
  prior.methodology.priorShrinkageRule = 'INVALID';
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(prior), /prior shrinkage anti-leak rule invalid/);
});

test('adaptive candidate safety rejects weakened scientific thresholds', () => {
  const value = clone(candidate());
  value.groupCount = 1;
  value.predictiveReadyGroupCount = 0;
  value.predictiveNotReadyGroupCount = 1;
  value.groups = [notReadyGroup()];
  value.groups[0].thresholds.minimumSkillPct = 4;
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(value), /skill threshold too weak/);
});

test('adaptive candidate safety rejects objective, tie-break and support count tampering', () => {
  const objective = clone(candidate());
  objective.methodology.adaptiveSelectionObjective = 'LOG_LOSS';
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(objective), /selection objective invalid/);

  const tieBreak = clone(candidate());
  tieBreak.methodology.adaptiveTieBreak = 'INVALID';
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(tieBreak), /tie-break invalid/);

  const counts = clone(candidate());
  counts.sourceRecordCount = 1;
  counts.eligibleRecordCount = 1;
  counts.rejectedRecordCount = 0;
  counts.predictionCount = 1;
  counts.modelFitCount = 1;
  counts.adaptiveSelectionReadyPredictionCount = 0;
  counts.adaptiveSelectionWarmupPredictionCount = 1;
  counts.adaptiveSupportFloorSelectionCounts = [];
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(counts), /support-floor selection counts mismatch/);
});

test('adaptive candidate safety rejects source-lineage mismatches', () => {
  const source = candidate();
  source.sourceRecordCount = 1;
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(source, { sourceRecordCount: 0 }), /source record count mismatch/);
});
