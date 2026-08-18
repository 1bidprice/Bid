import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrossSectionalRegimeWalkForwardRuntimeStatus } from '../src/forecast-cross-sectional-regime-walk-forward-runtime.js';
import {
  HISTORICAL_RESEARCH_JOB_CONTRACT,
  HISTORICAL_RESEARCH_READINESS_SUMMARY_CONTRACT,
  runCrossSectionalRegimeWalkForwardResearchJob,
  summarizeHistoricalResearchReadiness,
} from '../scripts/run-cross-sectional-regime-walk-forward-research.js';

function safeEnabledStatus() {
  return buildCrossSectionalRegimeWalkForwardRuntimeStatus({
    enabled: true,
    generatedAt: '2026-08-13T00:00:00.000Z',
    researchDossiers: [],
    historicalSeriesByCompany: new Map(),
    benchmarkSeriesByCompany: new Map(),
    maximumInstrumentCount: 24,
  });
}

test('dedicated research job opts in explicitly and returns artifact-only verified output', async () => {
  let received = null;
  const result = await runCrossSectionalRegimeWalkForwardResearchJob({
    startedAt: '2026-08-13T00:00:00.000Z',
    sourceCommit: 'source-sha',
    maximumInstrumentCount: 24,
    runAutonomous: async (options) => {
      received = options;
      return {
        generatedAt: '2026-08-13T00:00:05.000Z',
        forecastCrossSectionalRegimeWalkForwardRuntimeStatus: safeEnabledStatus(),
      };
    },
  });

  assert.equal(received.crossSectionalHistoricalRegimeWalkForwardEnabled, true);
  assert.equal(received.crossSectionalHistoricalRegimeWalkForwardMaxInstruments, 24);
  assert.equal(received.crossSectionalHistoricalRegimeWalkForwardOptions.includeAuditSamples, false);
  assert.equal(result.contract, HISTORICAL_RESEARCH_JOB_CONTRACT);
  assert.equal(result.executionState, 'ENABLED_RESEARCH_ONLY');
  assert.equal(result.verification.status, 'VERIFIED');
  assert.equal(result.sourceCommit, 'source-sha');
  assert.equal(result.readinessSummary.contract, HISTORICAL_RESEARCH_READINESS_SUMMARY_CONTRACT);
  assert.equal(result.readinessSummary.status, 'NO_READY_GROUPS');
  assert.equal(result.readinessSummary.groupCount, 0);
  assert.equal(result.readinessSummary.rawHistoricalRecordsIncluded, false);
  assert.equal(result.publication.artifactOnly, true);
  assert.equal(result.publication.liveFeedWriteAllowed, false);
  assert.equal(result.publication.forecastOutcomeLedgerWriteAllowed, false);
  assert.equal(result.publication.decisionHistoryWriteAllowed, false);
  assert.equal(result.publication.gitPushAllowed, false);
  assert.equal(result.decisionIntegrationEnabled, false);
  assert.equal(result.forecastMayInfluenceFinalAction, false);
  assert.equal(result.brokerExecutionEligible, false);
});

test('readiness summary explains statistical blockers without exporting raw historical records', () => {
  const summary = summarizeHistoricalResearchReadiness({
    research: {
      groups: [
        {
          status: 'HISTORICAL_REGIME_RESEARCH_NOT_READY',
          sampleSize: 60,
          blockers: ['OOS_DISTINCT_FORECAST_DATES_TOO_SMALL', 'OOS_DISTINCT_INSTRUMENTS_TOO_SMALL'],
          sampleIndependence: {
            status: 'INDEPENDENCE_NOT_READY',
            distinctForecastDateCount: 19,
            distinctInstrumentCount: 7,
          },
          outcomeWindowIndependence: {
            status: 'WINDOW_INDEPENDENCE_READY',
            effectiveNonOverlappingWindowCount: 15,
          },
          instrumentConcentration: {
            status: 'INSTRUMENT_DIVERSIFICATION_READY',
            effectiveInstrumentCount: 6.7,
          },
          calibration: { status: 'OOS_METRICS_READY' },
        },
        {
          status: 'HISTORICAL_REGIME_RESEARCH_NOT_READY',
          sampleSize: 44,
          blockers: ['OOS_DISTINCT_FORECAST_DATES_TOO_SMALL'],
          sampleIndependence: {
            status: 'INDEPENDENCE_NOT_READY',
            distinctForecastDateCount: 13,
            distinctInstrumentCount: 8,
          },
          outcomeWindowIndependence: {
            status: 'WINDOW_INDEPENDENCE_NOT_READY',
            effectiveNonOverlappingWindowCount: 11,
          },
          instrumentConcentration: {
            status: 'INSTRUMENT_DIVERSIFICATION_NOT_READY',
            effectiveInstrumentCount: 4,
          },
          calibration: { status: 'INSUFFICIENT_OOS_SAMPLE' },
        },
      ],
    },
  }, {
    minimumDistinctForecastDates: 30,
    minimumDistinctInstruments: 8,
    maximumSingleForecastDateSharePct: 15,
    minimumEffectiveNonOverlappingWindows: 12,
    maximumSingleInstrumentSharePct: 25,
    minimumEffectiveInstrumentCount: 5,
    minimumCalibrationSample: 60,
  });

  assert.equal(summary.contract, HISTORICAL_RESEARCH_READINESS_SUMMARY_CONTRACT);
  assert.equal(summary.status, 'NO_READY_GROUPS');
  assert.equal(summary.groupCount, 2);
  assert.equal(summary.readyGroupCount, 0);
  assert.deepEqual(summary.blockerCounts, [
    { code: 'OOS_DISTINCT_FORECAST_DATES_TOO_SMALL', groupCount: 2 },
    { code: 'OOS_DISTINCT_INSTRUMENTS_TOO_SMALL', groupCount: 1 },
  ]);
  assert.deepEqual(summary.gateReadiness, {
    sampleIndependenceReadyGroupCount: 0,
    outcomeWindowReadyGroupCount: 1,
    instrumentDiversificationReadyGroupCount: 1,
    calibrationReadyGroupCount: 1,
  });
  assert.deepEqual(summary.observedMaxima, {
    sampleSize: 60,
    distinctForecastDates: 19,
    distinctInstruments: 8,
    effectiveNonOverlappingWindows: 15,
    effectiveInstrumentCount: 6.7,
  });
  assert.equal(summary.thresholds.minimumDistinctForecastDates, 30);
  assert.equal(summary.thresholds.minimumDistinctInstruments, 8);
  assert.equal(summary.historicalResearchOnly, true);
  assert.equal(summary.rawHistoricalRecordsIncluded, false);
  assert.equal(summary.automaticModelPromotionEnabled, false);
  assert.equal(summary.decisionIntegrationEnabled, false);
  assert.equal(summary.forecastMayInfluenceFinalAction, false);
  assert.equal(summary.brokerExecutionEligible, false);
  assert.equal(summary.decisionImpact, 'NONE');
});

test('dedicated research job hard-bounds instrument count and cannot silently enable audit samples', async () => {
  let received = null;
  await runCrossSectionalRegimeWalkForwardResearchJob({
    maximumInstrumentCount: 999,
    researchOptions: { includeAuditSamples: true },
    runAutonomous: async (options) => {
      received = options;
      return {
        generatedAt: '2026-08-13T00:00:05.000Z',
        forecastCrossSectionalRegimeWalkForwardRuntimeStatus: safeEnabledStatus(),
      };
    },
  });
  assert.equal(received.crossSectionalHistoricalRegimeWalkForwardMaxInstruments, 40);
  assert.equal(received.crossSectionalHistoricalRegimeWalkForwardOptions.includeAuditSamples, false);
});

test('dedicated research job fails if the autonomous runner does not enter enabled research-only state', async () => {
  await assert.rejects(
    runCrossSectionalRegimeWalkForwardResearchJob({
      runAutonomous: async () => ({
        generatedAt: '2026-08-13T00:00:05.000Z',
        forecastCrossSectionalRegimeWalkForwardRuntimeStatus: buildCrossSectionalRegimeWalkForwardRuntimeStatus({ enabled: false }),
      }),
    }),
    /did not enter ENABLED_RESEARCH_ONLY/,
  );
});

test('artifact metadata never grants live calibration, final-action or broker authority', async () => {
  const result = await runCrossSectionalRegimeWalkForwardResearchJob({
    runAutonomous: async () => ({
      generatedAt: '2026-08-13T00:00:05.000Z',
      forecastCrossSectionalRegimeWalkForwardRuntimeStatus: safeEnabledStatus(),
    }),
  });
  assert.equal(result.automaticModelPromotionEnabled, false);
  assert.equal(result.probabilityCalibrationEnabled, false);
  assert.equal(result.decisionIntegrationEnabled, false);
  assert.equal(result.forecastMayInfluenceFinalAction, false);
  assert.equal(result.brokerExecutionEligible, false);
  assert.equal(result.decisionImpact, 'NONE');
  assert.equal(JSON.stringify(result).includes('BUY_NOW'), false);
  assert.equal(JSON.stringify(result).includes('SELL_NOW'), false);
});
