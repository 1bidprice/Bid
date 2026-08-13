import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORECAST_HISTORICAL_PREDICTIVE_SKILL_CONTRACT,
  buildHistoricalPredictiveSkillSummary,
  evaluateHistoricalPredictiveSkillGate,
} from '../src/forecast-historical-predictive-skill.js';

function group(overrides = {}) {
  return {
    historicalPatternPolicyVersion: 'pattern-v1',
    assetClass: 'EQUITY',
    horizon: 'week1',
    regimeKey: 'RISK_ON|BULL_TREND|LOW_VOLATILITY|POSITIVE_MOMENTUM',
    status: 'HISTORICAL_REGIME_RESEARCH_READY',
    calibration: {
      status: 'OOS_METRICS_READY',
      sampleSize: 240,
      skillVsBaseRatePct: 6.5,
      expectedCalibrationError: 0.07,
    },
    ...overrides,
  };
}

test('evaluation-ready historical group with negative skill is not predictive-skill ready', () => {
  const result = evaluateHistoricalPredictiveSkillGate(group({
    calibration: {
      status: 'OOS_METRICS_READY',
      sampleSize: 240,
      skillVsBaseRatePct: -1.58,
      expectedCalibrationError: 0.07,
    },
  }));

  assert.equal(result.contract, FORECAST_HISTORICAL_PREDICTIVE_SKILL_CONTRACT);
  assert.equal(result.historicalEvaluationStatus, 'HISTORICAL_REGIME_RESEARCH_READY');
  assert.equal(result.status, 'HISTORICAL_PREDICTIVE_SKILL_NOT_READY');
  assert.ok(result.blockers.includes('INSUFFICIENT_PROBABILISTIC_SKILL'));
  assert.equal(result.thresholds.minimumSample, 200);
  assert.equal(result.thresholds.minimumSkillPct, 5);
  assert.equal(result.thresholds.maximumEce, 0.08);
  assert.equal(result.forecastMayInfluenceFinalAction, false);
  assert.equal(result.brokerExecutionEligible, false);
  assert.equal(result.decisionImpact, 'NONE');
});

test('canonical skill and calibration thresholds can mark research skill ready without granting authority', () => {
  const result = evaluateHistoricalPredictiveSkillGate(group());

  assert.equal(result.status, 'HISTORICAL_PREDICTIVE_SKILL_READY');
  assert.deepEqual(result.blockers, []);
  assert.equal(result.historicalResearchOnly, true);
  assert.equal(result.automaticModelPromotionEnabled, false);
  assert.equal(result.probabilityCalibrationEnabled, false);
  assert.equal(result.decisionIntegrationEnabled, false);
  assert.equal(result.forecastMayInfluenceFinalAction, false);
  assert.equal(result.finalActionEligible, false);
  assert.equal(result.brokerExecutionEligible, false);
  assert.equal(result.decisionImpact, 'NONE');
});

test('strong calibration metrics cannot bypass historical evaluation readiness', () => {
  const result = evaluateHistoricalPredictiveSkillGate(group({
    status: 'HISTORICAL_REGIME_RESEARCH_NOT_READY',
  }));

  assert.equal(result.status, 'HISTORICAL_PREDICTIVE_SKILL_NOT_EVALUABLE');
  assert.ok(result.blockers.includes('HISTORICAL_EVALUATION_NOT_READY'));
  assert.equal(result.forecastMayInfluenceFinalAction, false);
});

test('historical predictive skill summary separates evaluable, skilled and unskilled groups', () => {
  const summary = buildHistoricalPredictiveSkillSummary([
    group(),
    group({
      horizon: 'month1',
      calibration: {
        status: 'OOS_METRICS_READY',
        sampleSize: 220,
        skillVsBaseRatePct: -4,
        expectedCalibrationError: 0.12,
      },
    }),
    group({
      regimeKey: 'RISK_OFF|BEAR_TREND|HIGH_VOLATILITY|NEGATIVE_MOMENTUM',
      status: 'HISTORICAL_REGIME_RESEARCH_NOT_READY',
      calibration: {
        status: 'INSUFFICIENT_OOS_HISTORY',
        sampleSize: 40,
        skillVsBaseRatePct: null,
        expectedCalibrationError: null,
      },
    }),
  ]);

  assert.equal(summary.groupCount, 3);
  assert.equal(summary.evaluationReadyGroupCount, 2);
  assert.equal(summary.predictiveSkillReadyGroupCount, 1);
  assert.equal(summary.predictiveSkillNotReadyGroupCount, 1);
  assert.equal(summary.notEvaluableGroupCount, 1);
  assert.equal(summary.status, 'PREDICTIVE_SKILL_READY_GROUPS_EXIST');
  assert.ok(summary.blockerCounts.some((item) => item.code === 'INSUFFICIENT_PROBABILISTIC_SKILL'));
  assert.ok(summary.blockerCounts.some((item) => item.code === 'CALIBRATION_ERROR_TOO_HIGH'));
  assert.equal(summary.rawHistoricalRecordsIncluded, false);
  assert.equal(summary.rawHistoricalCandlesIncluded, false);
  assert.equal(summary.automaticModelPromotionEnabled, false);
  assert.equal(summary.forecastMayInfluenceFinalAction, false);
  assert.equal(summary.brokerExecutionEligible, false);
});
