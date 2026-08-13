import test from 'node:test';
import assert from 'node:assert/strict';
import { runV1827HistoricalPredictiveSkillResearchJob } from '../scripts/run-cross-sectional-regime-walk-forward-research-v1827.js';

const group = (skill) => ({
  assetClass: 'EQUITY',
  horizon: 'week1',
  regimeKey: 'RISK_ON|BULL|LOW_VOL|POSITIVE_MOMENTUM',
  status: 'HISTORICAL_REGIME_RESEARCH_READY',
  calibration: {
    status: 'OOS_METRICS_READY',
    sampleSize: 265,
    skillVsBaseRatePct: skill,
    expectedCalibrationError: 0.075,
  },
});

const base = (skill) => ({
  executionState: 'ENABLED_RESEARCH_ONLY',
  historyDepth: { lookbackDays: 1825, expectedYahooRange: '5y' },
  readinessSummary: { readyGroupCount: 1, thresholds: { minimumDistinctForecastDates: 30 } },
  researchStatus: { research: { groups: [group(skill)] } },
  publication: { artifactOnly: true, liveFeedWriteAllowed: false },
  automaticModelPromotionEnabled: false,
  decisionIntegrationEnabled: false,
  forecastMayInfluenceFinalAction: false,
  brokerExecutionEligible: false,
  decisionImpact: 'NONE',
});

test('v1827 separates evaluation readiness from predictive skill', async () => {
  const result = await runV1827HistoricalPredictiveSkillResearchJob({ runV1826: async () => base(-1.58) });
  assert.equal(result.readinessSummary.readyGroupCount, 1);
  assert.equal(result.predictiveSkillSummary.evaluationReadyGroupCount, 1);
  assert.equal(result.predictiveSkillSummary.predictiveSkillReadyGroupCount, 0);
  assert.ok(result.predictiveSkillSummary.blockerCounts.some((item) => item.code === 'INSUFFICIENT_PROBABILISTIC_SKILL'));
  assert.equal(result.historyDepth.lookbackDays, 1825);
  assert.equal(result.readinessSummary.thresholds.minimumDistinctForecastDates, 30);
});

test('v1827 remains authority-free even when predictive skill passes', async () => {
  const result = await runV1827HistoricalPredictiveSkillResearchJob({ runV1826: async () => base(6.5) });
  assert.equal(result.predictiveSkillSummary.predictiveSkillReadyGroupCount, 1);
  assert.equal(result.predictiveSkillSummary.automaticModelPromotionEnabled, false);
  assert.equal(result.predictiveSkillSummary.forecastMayInfluenceFinalAction, false);
  assert.equal(result.predictiveSkillSummary.brokerExecutionEligible, false);
  assert.equal(result.automaticModelPromotionEnabled, false);
  assert.equal(result.decisionIntegrationEnabled, false);
  assert.equal(result.forecastMayInfluenceFinalAction, false);
  assert.equal(result.brokerExecutionEligible, false);
  assert.equal(result.decisionImpact, 'NONE');
});
