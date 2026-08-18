import test from 'node:test';
import assert from 'node:assert/strict';
import {
  V1829_EXISTING_STACK_FALSIFICATION_PROOF_CONTRACT,
  assertV1829FalsificationIntegrityReady,
  runV1829ExistingStackFalsificationResearchJob,
} from '../scripts/run-cross-sectional-regime-walk-forward-research-v1829.js';

function group(skill = -2) {
  return {
    historicalPatternPolicyVersion: 'pattern-v1',
    historicalMarketFactorPolicyVersion: 'market-v1',
    assetClass: 'EQUITY',
    horizon: 'week1',
    regimeKey: 'RISK_ON|BULL_TREND|LOW_VOLATILITY|POSITIVE_MOMENTUM',
    sampleSize: 300,
    positiveCount: 170,
    negativeCount: 130,
    baselinePatternMetrics: { brierScore: 0.27, logLoss: 0.75, expectedCalibrationError: 0.12, skillVsBaseRatePct: -8, baseRate: 0.566667 },
    ensembleMetrics: { brierScore: 0.25, logLoss: 0.69, expectedCalibrationError: 0.04, skillVsBaseRatePct: skill, baseRate: 0.566667 },
    brierImprovementVsRawPatternPct: 4,
    logLossImprovementVsRawPatternPct: 2,
    chronologicalStability: { blocks: [1, 2, 3].map((block) => ({ block, sampleSize: 100, ensembleSkillVsBaseRatePct: -1, brierImprovementVsRawPatternPct: 2, logLossImprovementVsRawPatternPct: 1 })) },
    thresholds: { minimumEvaluationSample: 200, minimumClassCount: 40, minimumSkillPct: 5, maximumEce: 0.08, minimumBrierImprovementPct: 3, minimumLogLossImprovementPct: 0, chronologicalBlockCount: 3, minimumChronologicalBlockSample: 20 },
  };
}

function candidate(modelVariant) {
  return {
    modelVariant,
    status: 'HISTORICAL_MARKET_STACK_PREDICTIVE_NOT_READY',
    sourceRecordCount: 500,
    predictionCount: 300,
    groups: [group()],
    automaticModelPromotionEnabled: false,
    decisionImpact: 'NONE',
  };
}

function artifact() {
  const scalar = candidate('SCALAR_MARKET_FACTOR');
  scalar.domainSeparatedCandidate = candidate('DOMAIN_SEPARATED_MARKET_FACTOR');
  scalar.priorShrunkCandidate = candidate('PRIOR_SHRUNK_SCALAR_MARKET_FACTOR');
  scalar.adaptivePriorShrunkCandidate = candidate('ADAPTIVE_PRIOR_SHRUNK_SCALAR_MARKET_FACTOR');
  return {
    sourceCommit: 'test-sha',
    researchStatus: { research: { historicalMarketStackResearch: scalar } },
    stableCohortIntegrity: { status: 'STABLE_RESEARCH_COHORT_INTEGRITY_READY', ready: true, loadedHistoricalSeriesCount: 16, loadedBenchmarkSeriesCount: 16, configuredInstrumentCount: 16 },
    datasetIntegrity: { status: 'HISTORICAL_PREDICTIVE_DATASET_INTEGRITY_READY', ready: true, generatedRecordCount: 500, validRegimeRecordCount: 500 },
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

test('v1829 adds falsification evidence without granting model-selection authority', async () => {
  const result = await runV1829ExistingStackFalsificationResearchJob({ runV1828: async () => artifact() });
  assert.equal(result.existingStackFalsificationProofContract, V1829_EXISTING_STACK_FALSIFICATION_PROOF_CONTRACT);
  assert.equal(result.existingStackFalsification.status, 'NO_EXISTING_STACK_VARIANT_MEETS_PREDECLARED_PREDICTIVE_STANDARD');
  assert.equal(result.existingStackFalsification.lineageVerified, true);
  assert.equal(result.existingStackFalsification.variantCount, 4);
  assert.equal(result.existingStackFalsification.winnerSelectionAllowed, false);
  assert.equal(result.existingStackFalsification.sameDatasetPromotionAllowed, false);
  assert.equal(assertV1829FalsificationIntegrityReady(result.existingStackFalsification), true);
});

test('v1829 integrity rejects any same-dataset winner selection authority', () => {
  const falsification = {
    contract: 'HISTORICAL_MARKET_EXISTING_STACK_FALSIFICATION_V1',
    lineageVerified: true,
    variantCount: 4,
    diagnosticOnly: true,
    winnerSelectionAllowed: true,
    sameDatasetModelSelectionAllowed: false,
    sameDatasetPromotionAllowed: false,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
  assert.throws(() => assertV1829FalsificationIntegrityReady(falsification), /WINNER_SELECTION_ENABLED/);
});
