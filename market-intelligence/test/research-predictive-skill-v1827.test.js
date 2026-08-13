import test from 'node:test';
import assert from 'node:assert/strict';
import {
  V1827_DATASET_INTEGRITY_CONTRACT,
  assertV1827DatasetIntegrityReady,
  runV1827HistoricalPredictiveSkillResearchJob,
} from '../scripts/run-cross-sectional-regime-walk-forward-research-v1827.js';

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

const base = (skill, options = {}) => {
  const generatedRecordCount = options.generatedRecordCount ?? 265;
  const validRegimeRecordCount = options.validRegimeRecordCount ?? generatedRecordCount;
  return {
    executionState: 'ENABLED_RESEARCH_ONLY',
    historyDepth: { lookbackDays: 1825, expectedYahooRange: '5y' },
    readinessSummary: { readyGroupCount: 1, thresholds: { minimumDistinctForecastDates: 30 } },
    researchStatus: { research: { groups: [group(skill)] } },
    telemetry: {
      forecastHistoricalWalkForwardGeneratedRecordCount: generatedRecordCount,
      forecastHistoricalWalkForwardValidRegimeRecordCount: validRegimeRecordCount,
    },
    publication: { artifactOnly: true, liveFeedWriteAllowed: false },
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
};

test('v1827 separates evaluation readiness from predictive skill', async () => {
  const result = await runV1827HistoricalPredictiveSkillResearchJob({ runV1826: async () => base(-1.58) });
  assert.equal(result.datasetIntegrity.contract, V1827_DATASET_INTEGRITY_CONTRACT);
  assert.equal(result.datasetIntegrity.ready, true);
  assert.equal(result.datasetIntegrity.regimeCoveragePct, 100);
  assert.equal(result.predictiveSkillSummary.datasetIntegrityReady, true);
  assert.equal(result.readinessSummary.readyGroupCount, 1);
  assert.equal(result.predictiveSkillSummary.evaluationReadyGroupCount, 1);
  assert.equal(result.predictiveSkillSummary.predictiveSkillReadyGroupCount, 0);
  assert.ok(result.predictiveSkillSummary.blockerCounts.some((item) => item.code === 'INSUFFICIENT_PROBABILISTIC_SKILL'));
  assert.equal(result.historyDepth.lookbackDays, 1825);
  assert.equal(result.readinessSummary.thresholds.minimumDistinctForecastDates, 30);
});

test('v1827 remains authority-free even when predictive skill passes', async () => {
  const result = await runV1827HistoricalPredictiveSkillResearchJob({ runV1826: async () => base(6.5) });
  assert.equal(result.datasetIntegrity.ready, true);
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

test('v1827 blocks predictive evaluation when historical regime coverage is incomplete', async () => {
  const result = await runV1827HistoricalPredictiveSkillResearchJob({
    runV1826: async () => base(8.5, { generatedRecordCount: 2601, validRegimeRecordCount: 338 }),
  });

  assert.equal(result.datasetIntegrity.contract, V1827_DATASET_INTEGRITY_CONTRACT);
  assert.equal(result.datasetIntegrity.status, 'HISTORICAL_PREDICTIVE_DATASET_INTEGRITY_BLOCKED');
  assert.equal(result.datasetIntegrity.ready, false);
  assert.equal(result.datasetIntegrity.generatedRecordCount, 2601);
  assert.equal(result.datasetIntegrity.validRegimeRecordCount, 338);
  assert.equal(result.datasetIntegrity.regimeUnavailableRecordCount, 2263);
  assert.ok(result.datasetIntegrity.regimeCoveragePct < 100);
  assert.ok(result.datasetIntegrity.blockers.includes('HISTORICAL_REGIME_COVERAGE_INCOMPLETE'));
  assert.equal(result.predictiveSkillSummary.status, 'PREDICTIVE_SKILL_EVALUATION_BLOCKED_BY_DATASET_INTEGRITY');
  assert.equal(result.predictiveSkillSummary.datasetIntegrityReady, false);
  assert.equal(result.predictiveSkillSummary.predictiveSkillReadyGroupCount, 0);
  assert.equal(result.predictiveSkillSummary.evaluationReadyGroupCount, 0);
  assert.deepEqual(result.predictiveSkillSummary.groups, []);
  assert.equal(result.predictiveSkillSummary.blockerCounts[0]?.code, 'HISTORICAL_DATASET_INTEGRITY_NOT_READY');
  assert.equal(result.datasetIntegrity.rawHistoricalRecordsIncluded, false);
  assert.equal(result.datasetIntegrity.rawHistoricalCandlesIncluded, false);
  assert.equal(result.datasetIntegrity.decisionIntegrationEnabled, false);
  assert.equal(result.datasetIntegrity.forecastMayInfluenceFinalAction, false);
  assert.equal(result.datasetIntegrity.brokerExecutionEligible, false);
  assert.equal(result.datasetIntegrity.decisionImpact, 'NONE');
  assert.throws(() => assertV1827DatasetIntegrityReady(result.datasetIntegrity), /dataset integrity blocked/);
});

test('v1827 permits predictive evaluation only when every generated forecast has valid historical regime lineage', async () => {
  const result = await runV1827HistoricalPredictiveSkillResearchJob({
    runV1826: async () => base(6.5, { generatedRecordCount: 2603, validRegimeRecordCount: 2603 }),
  });

  assert.equal(result.datasetIntegrity.status, 'HISTORICAL_PREDICTIVE_DATASET_INTEGRITY_READY');
  assert.equal(result.datasetIntegrity.ready, true);
  assert.equal(result.datasetIntegrity.regimeUnavailableRecordCount, 0);
  assert.equal(result.datasetIntegrity.regimeCoveragePct, 100);
  assert.equal(result.predictiveSkillSummary.datasetIntegrityReady, true);
  assert.equal(result.predictiveSkillSummary.predictiveSkillReadyGroupCount, 1);
  assert.equal(assertV1827DatasetIntegrityReady(result.datasetIntegrity), true);
});
