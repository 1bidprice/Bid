import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORICAL_MARKET_EXISTING_STACK_FALSIFICATION_CONTRACT,
  buildHistoricalMarketExistingStackFalsification,
} from '../src/forecast-historical-market-existing-stack-falsification.js';

function group({ skill = -2, ece = 0.04, brierImprovement = 4, logLossImprovement = 2, blockSkills = [-1, -1, -1] } = {}) {
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
    ensembleMetrics: { brierScore: 0.25, logLoss: 0.69, expectedCalibrationError: ece, skillVsBaseRatePct: skill, baseRate: 0.566667 },
    brierImprovementVsRawPatternPct: brierImprovement,
    logLossImprovementVsRawPatternPct: logLossImprovement,
    eceImprovementVsRawPattern: 0.08,
    chronologicalStability: {
      blocks: blockSkills.map((blockSkill, index) => ({
        block: index + 1,
        sampleSize: 100,
        ensembleSkillVsBaseRatePct: blockSkill,
        brierImprovementVsRawPatternPct: 2,
        logLossImprovementVsRawPatternPct: 1,
      })),
    },
    thresholds: {
      minimumEvaluationSample: 200,
      minimumClassCount: 40,
      minimumSkillPct: 5,
      maximumEce: 0.08,
      minimumBrierImprovementPct: 3,
      minimumLogLossImprovementPct: 0,
      chronologicalBlockCount: 3,
      minimumChronologicalBlockSample: 20,
    },
  };
}

function candidate(modelVariant, groupValue) {
  return {
    modelVariant,
    status: 'HISTORICAL_MARKET_STACK_PREDICTIVE_NOT_READY',
    sourceRecordCount: 500,
    predictionCount: 300,
    groups: [groupValue],
    automaticModelPromotionEnabled: false,
    decisionImpact: 'NONE',
  };
}

function stack(overrides = {}) {
  const scalarGroup = overrides.scalarGroup || group();
  return {
    ...candidate('SCALAR_MARKET_FACTOR', scalarGroup),
    domainSeparatedCandidate: candidate('DOMAIN_SEPARATED_MARKET_FACTOR', overrides.domainGroup || group()),
    priorShrunkCandidate: candidate('PRIOR_SHRUNK_SCALAR_MARKET_FACTOR', overrides.priorGroup || group()),
    adaptivePriorShrunkCandidate: candidate('ADAPTIVE_PRIOR_SHRUNK_SCALAR_MARKET_FACTOR', overrides.adaptiveGroup || group()),
  };
}

test('falsification records no existing variant meeting the standard without selecting a winner', () => {
  const result = buildHistoricalMarketExistingStackFalsification(stack());
  assert.equal(result.contract, HISTORICAL_MARKET_EXISTING_STACK_FALSIFICATION_CONTRACT);
  assert.equal(result.status, 'NO_EXISTING_STACK_VARIANT_MEETS_PREDECLARED_PREDICTIVE_STANDARD');
  assert.equal(result.lineageVerified, true);
  assert.equal(result.variantCount, 4);
  assert.equal(result.strictSignalVariantCount, 0);
  assert.equal(result.winnerSelectionAllowed, false);
  assert.equal(result.sameDatasetModelSelectionAllowed, false);
  assert.equal(result.sameDatasetPromotionAllowed, false);
  assert.equal(result.automaticModelPromotionEnabled, false);
  assert.equal(result.decisionIntegrationEnabled, false);
  assert.equal(result.forecastMayInfluenceFinalAction, false);
  assert.equal(result.brokerExecutionEligible, false);
  assert.equal(result.decisionImpact, 'NONE');
});

test('a diagnostic signal requires a new unseen holdout and still cannot be promoted', () => {
  const passing = group({ skill: 6, ece: 0.03, brierImprovement: 5, logLossImprovement: 3, blockSkills: [1, 2, 1] });
  const result = buildHistoricalMarketExistingStackFalsification(stack({ adaptiveGroup: passing }));
  assert.equal(result.status, 'EXISTING_STACK_SIGNAL_REQUIRES_NEW_UNSEEN_HOLDOUT');
  assert.equal(result.strictSignalVariantCount, 1);
  const adaptive = result.variantSummaries.find((item) => item.modelVariant === 'ADAPTIVE_PRIOR_SHRUNK_SCALAR_MARKET_FACTOR');
  assert.equal(adaptive.strictSignalGroupCount, 1);
  assert.equal(adaptive.winnerSelectionAllowed, false);
  assert.equal(adaptive.sameDatasetPromotionAllowed, false);
  assert.match(result.nextValidationRule, /NEW_UNSEEN/);
});

test('lineage mismatch fails closed', () => {
  const mismatched = group();
  mismatched.sampleSize = 299;
  const result = buildHistoricalMarketExistingStackFalsification(stack({ domainGroup: mismatched }));
  assert.equal(result.status, 'EXISTING_STACK_FALSIFICATION_INTEGRITY_BLOCKED');
  assert.equal(result.lineageVerified, false);
  assert.ok(result.blockers.some((code) => code.startsWith('MODEL_VARIANT_SAMPLE_MISMATCH:DOMAIN_SEPARATED_MARKET_FACTOR')));
});

test('baseline mismatch fails closed', () => {
  const mismatched = group();
  mismatched.baselinePatternMetrics = { ...mismatched.baselinePatternMetrics, brierScore: 0.28 };
  const result = buildHistoricalMarketExistingStackFalsification(stack({ priorGroup: mismatched }));
  assert.equal(result.lineageVerified, false);
  assert.ok(result.blockers.some((code) => code.includes('MODEL_VARIANT_BASELINE_MISMATCH:PRIOR_SHRUNK_SCALAR_MARKET_FACTOR')));
});

test('authority tampering fails falsification integrity', () => {
  const input = stack();
  input.adaptivePriorShrunkCandidate.automaticModelPromotionEnabled = true;
  const result = buildHistoricalMarketExistingStackFalsification(input);
  assert.equal(result.lineageVerified, false);
  assert.ok(result.blockers.includes('MODEL_VARIANT_AUTHORITY_CHANGED:ADAPTIVE_PRIOR_SHRUNK_SCALAR_MARKET_FACTOR'));
});
