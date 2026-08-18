import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_CONTRACT,
  HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_MINIMUM_LOADED_INSTRUMENTS,
  buildHistoricalResearchValidationUniverse,
  summarizeHistoricalResearchValidationUniverse,
} from '../src/historical-research-validation-universe.js';
import {
  V1828_STABLE_COHORT_INTEGRITY_CONTRACT,
  assertV1828StableCohortIntegrityReady,
  buildV1828StableCohortIntegrity,
  runV1828StableCohortPredictiveSkillResearchJob,
} from '../scripts/run-cross-sectional-regime-walk-forward-research-v1828.js';

function artifactWithBreadth(count = 16, overrides = {}) {
  return {
    executionState: 'ENABLED_RESEARCH_ONLY',
    sourceCohortSummary: {
      universeExpansion: {
        seedCompanyCount: count,
        eventDiscoveredCompanyCount: 0,
        broadScreenCompanyCount: 0,
        analysedCompanyCount: count,
        ...(overrides.universeExpansion || {}),
      },
    },
    universeCoverage: {
      loadedHistoricalSeriesCount: count,
      loadedBenchmarkSeriesCount: count,
      eligibleInstrumentCount: count,
      selectedInstrumentCount: count,
      eligibleWithBenchmarkCount: count,
      eligibleWithoutBenchmarkCount: 0,
      ...(overrides.universeCoverage || {}),
    },
    telemetry: {
      forecastHistoricalWalkForwardGeneratedRecordCount: 5000,
      forecastHistoricalWalkForwardValidRegimeRecordCount: 5000,
    },
    predictiveSkillSummary: {
      evaluationReadyGroupCount: 0,
      predictiveSkillReadyGroupCount: 0,
    },
    adaptivePriorShrunkCandidateSummary: {
      predictiveReadyGroupCount: 0,
      groupCount: 0,
    },
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

test('stable validation universe is predeclared, diverse, US-domain and canonically unique', () => {
  const universe = buildHistoricalResearchValidationUniverse();
  const summary = summarizeHistoricalResearchValidationUniverse(universe);

  assert.equal(summary.contract, HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_CONTRACT);
  assert.equal(summary.configuredInstrumentCount, 16);
  assert.equal(summary.uniqueCompanyCount, 16);
  assert.equal(summary.uniqueListingCount, 16);
  assert.equal(summary.canonicalIdentityReadyCount, 16);
  assert.equal(summary.usEquityCount, 16);
  assert.ok(summary.sectorCount >= 10);
  assert.equal(summary.marketDomain, 'US_EQUITY');
  assert.equal(summary.benchmarkFamily, 'SPY');
  assert.equal(summary.minimumLoadedInstrumentCount, HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_MINIMUM_LOADED_INSTRUMENTS);
  assert.equal(summary.currentNewsDependentSelection, false);
  assert.equal(summary.outcomeAwareSelectionAllowed, false);
  assert.equal(summary.eventDiscoveryAdditionsAllowed, false);
  assert.equal(summary.crossMarketValidationIncluded, false);
  assert.equal(summary.athensDomainValidated, false);
  assert.equal(summary.athensDomainStatus, 'SEPARATE_DOMAIN_PROOF_REQUIRED');
  assert.equal(summary.normalProductionDefaultChanged, false);
  assert.equal(summary.statisticalReadinessThresholdsChanged, false);
  assert.equal(summary.historicalResearchOnly, true);
  assert.equal(summary.automaticModelPromotionAllowed, false);
  assert.equal(summary.decisionImpact, 'NONE');
});

test('v1828 injects the stable US universe and disables transient additions and evidence collection', async () => {
  let received = null;
  const result = await runV1828StableCohortPredictiveSkillResearchJob({
    runV1827: async (options) => {
      received = options;
      return artifactWithBreadth(16);
    },
  });

  assert.equal(Array.isArray(received.autonomousOptions.universe), true);
  assert.equal(received.autonomousOptions.universe.length, 16);
  assert.equal(received.autonomousOptions.minimumScore, 101);
  assert.equal(received.autonomousOptions.enableBroadOpportunityScan, false);
  assert.equal(received.autonomousOptions.enableAthensDiscovery, false);
  assert.equal(received.autonomousOptions.collectTrustedNews, false);
  assert.equal(received.autonomousOptions.documentLimit, 0);
  assert.equal(result.validationUniverse.configuredInstrumentCount, 16);
  assert.equal(result.stableCohortIntegrity.contract, V1828_STABLE_COHORT_INTEGRITY_CONTRACT);
  assert.equal(result.stableCohortIntegrity.status, 'STABLE_RESEARCH_COHORT_INTEGRITY_READY');
  assert.equal(result.stableCohortIntegrity.ready, true);
  assert.equal(result.stableCohortIntegrity.eventDiscoveredCompanyCount, 0);
  assert.equal(result.stableCohortIntegrity.broadScreenCompanyCount, 0);
  assert.equal(result.stableCohortIntegrity.loadedHistoricalSeriesCount, 16);
  assert.equal(result.stableCohortIntegrity.loadedBenchmarkSeriesCount, 16);
  assert.equal(result.stableCohortIntegrity.eligibleWithBenchmarkCount, 16);
  assert.equal(result.stableCohortIntegrity.eligibleWithoutBenchmarkCount, 0);
  assert.equal(result.stableCohortIntegrity.marketDomain, 'US_EQUITY');
  assert.equal(result.stableCohortIntegrity.benchmarkFamily, 'SPY');
  assert.equal(result.stableCohortIntegrity.athensDomainValidated, false);
  assert.equal(result.stableCohortIntegrity.survivorshipBiasControlled, false);
  assert.equal(result.stableCohortIntegrity.automaticModelPromotionEnabled, false);
  assert.equal(result.stableCohortIntegrity.decisionIntegrationEnabled, false);
  assert.equal(result.stableCohortIntegrity.forecastMayInfluenceFinalAction, false);
  assert.equal(result.stableCohortIntegrity.brokerExecutionEligible, false);
  assert.equal(result.stableCohortIntegrity.decisionImpact, 'NONE');
  assert.equal(assertV1828StableCohortIntegrityReady(result.stableCohortIntegrity), true);
});

test('v1828 fails cohort integrity when transient event discovery changes the universe', () => {
  const universeSummary = summarizeHistoricalResearchValidationUniverse(buildHistoricalResearchValidationUniverse());
  const integrity = buildV1828StableCohortIntegrity(
    artifactWithBreadth(17, {
      universeExpansion: {
        seedCompanyCount: 16,
        eventDiscoveredCompanyCount: 1,
        analysedCompanyCount: 17,
      },
    }),
    universeSummary,
  );

  assert.equal(integrity.ready, false);
  assert.ok(integrity.blockers.includes('STABLE_VALIDATION_UNIVERSE_RUNTIME_COUNT_MISMATCH'));
  assert.ok(integrity.blockers.includes('EVENT_DISCOVERY_CHANGED_STABLE_VALIDATION_UNIVERSE'));
  assert.throws(() => assertV1828StableCohortIntegrityReady(integrity), /stable research cohort blocked/);
});

test('v1828 fails cohort integrity when validated market breadth falls below twelve instruments', () => {
  const universeSummary = summarizeHistoricalResearchValidationUniverse(buildHistoricalResearchValidationUniverse());
  const integrity = buildV1828StableCohortIntegrity(
    artifactWithBreadth(16, {
      universeCoverage: {
        loadedHistoricalSeriesCount: 11,
        loadedBenchmarkSeriesCount: 11,
        eligibleInstrumentCount: 11,
        selectedInstrumentCount: 11,
        eligibleWithBenchmarkCount: 11,
        eligibleWithoutBenchmarkCount: 5,
      },
    }),
    universeSummary,
  );

  assert.equal(integrity.ready, false);
  assert.ok(integrity.blockers.includes('STABLE_VALIDATION_HISTORY_BREADTH_TOO_SMALL'));
  assert.ok(integrity.blockers.includes('STABLE_VALIDATION_BENCHMARK_BREADTH_TOO_SMALL'));
  assert.ok(integrity.blockers.includes('STABLE_VALIDATION_ELIGIBLE_BREADTH_TOO_SMALL'));
  assert.ok(integrity.blockers.includes('STABLE_VALIDATION_SELECTED_BREADTH_TOO_SMALL'));
  assert.ok(integrity.blockers.includes('STABLE_VALIDATION_BENCHMARK_LINEAGE_INCOMPLETE'));
  assert.throws(() => assertV1828StableCohortIntegrityReady(integrity), /stable research cohort blocked/);
});

test('v1828 requires complete benchmark lineage even when breadth remains above the minimum floor', () => {
  const universeSummary = summarizeHistoricalResearchValidationUniverse(buildHistoricalResearchValidationUniverse());
  const integrity = buildV1828StableCohortIntegrity(
    artifactWithBreadth(16, {
      universeCoverage: {
        loadedBenchmarkSeriesCount: 15,
        eligibleWithBenchmarkCount: 15,
        eligibleWithoutBenchmarkCount: 1,
      },
    }),
    universeSummary,
  );

  assert.equal(integrity.ready, false);
  assert.ok(integrity.blockers.includes('STABLE_VALIDATION_BENCHMARK_COHORT_INCOMPLETE'));
  assert.ok(integrity.blockers.includes('STABLE_VALIDATION_BENCHMARK_LINEAGE_INCOMPLETE'));
  assert.throws(() => assertV1828StableCohortIntegrityReady(integrity), /stable research cohort blocked/);
});
