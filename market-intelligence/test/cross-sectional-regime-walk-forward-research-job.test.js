import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrossSectionalRegimeWalkForwardRuntimeStatus } from '../src/forecast-cross-sectional-regime-walk-forward-runtime.js';
import {
  HISTORICAL_RESEARCH_JOB_CONTRACT,
  runCrossSectionalRegimeWalkForwardResearchJob,
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
  assert.equal(result.publication.artifactOnly, true);
  assert.equal(result.publication.liveFeedWriteAllowed, false);
  assert.equal(result.publication.forecastOutcomeLedgerWriteAllowed, false);
  assert.equal(result.publication.decisionHistoryWriteAllowed, false);
  assert.equal(result.publication.gitPushAllowed, false);
  assert.equal(result.decisionIntegrationEnabled, false);
  assert.equal(result.forecastMayInfluenceFinalAction, false);
  assert.equal(result.brokerExecutionEligible, false);
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
