import test from 'node:test';
import assert from 'node:assert/strict';
import {
  V1826_HISTORY_DEPTH_CONTRACT,
  V1826_RESEARCH_LOOKBACK_DAYS,
  runV1826HistoricalResearchJob,
} from '../scripts/run-cross-sectional-regime-walk-forward-research-v1826.js';

test('v1826 forces five-year depth only through autonomous research options', async () => {
  let received = null;
  const artifact = await runV1826HistoricalResearchJob({
    autonomousOptions: { lookbackDays: 420, unrelatedOption: true },
    runBase: async (input) => {
      received = input;
      return {
        format: 'base-artifact',
        decisionImpact: 'NONE',
        telemetry: {},
        readinessSummary: { observedMaxima: {} },
      };
    },
  });

  assert.equal(received.autonomousOptions.lookbackDays, V1826_RESEARCH_LOOKBACK_DAYS);
  assert.equal(received.autonomousOptions.unrelatedOption, true);
  assert.equal(artifact.historyDepth.contract, V1826_HISTORY_DEPTH_CONTRACT);
  assert.equal(artifact.historyDepth.lookbackDays, 1825);
  assert.equal(artifact.historyDepth.expectedYahooRange, '5y');
  assert.equal(artifact.historyDepth.normalProductionDefaultChanged, false);
  assert.equal(artifact.historyDepth.qualityValidationChanged, false);
  assert.equal(artifact.historyDepth.statisticalReadinessThresholdsChanged, false);
  assert.equal(artifact.historyDepth.historicalResearchOnly, true);
  assert.equal(artifact.historyDepth.automaticPromotionAllowed, false);
  assert.equal(artifact.historyDepth.decisionImpact, 'NONE');
});

test('v1826 history-depth metadata never grants decision authority', async () => {
  const artifact = await runV1826HistoricalResearchJob({
    runBase: async () => ({
      decisionImpact: 'NONE',
      automaticModelPromotionEnabled: false,
      decisionIntegrationEnabled: false,
      forecastMayInfluenceFinalAction: false,
      brokerExecutionEligible: false,
      telemetry: {},
      readinessSummary: { observedMaxima: {} },
    }),
  });

  assert.equal(artifact.decisionImpact, 'NONE');
  assert.equal(artifact.automaticModelPromotionEnabled, false);
  assert.equal(artifact.decisionIntegrationEnabled, false);
  assert.equal(artifact.forecastMayInfluenceFinalAction, false);
  assert.equal(artifact.brokerExecutionEligible, false);
  assert.equal(artifact.historyDepth.decisionImpact, 'NONE');
});
