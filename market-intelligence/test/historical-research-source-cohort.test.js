import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORICAL_RESEARCH_SOURCE_COHORT_CONTRACT,
  summarizeHistoricalResearchSourceCohort,
} from '../scripts/run-cross-sectional-regime-walk-forward-research.js';

test('source cohort summary traces upstream counts without exporting company records', () => {
  const summary = summarizeHistoricalResearchSourceCohort({
    universeExpansion: {
      seedCompanyCount: 2,
      eventDiscoveredCompanyCount: 5,
      broadScreenCompanyCount: 1,
      analysedCompanyCount: 8,
      opportunityScannedInstrumentCount: 100,
      opportunityScorableInstrumentCount: 12,
    },
    discovery: {
      registryCompanyCount: 1000,
      secRegistryCompanyCount: 900,
      athensActiveIssuerCount: 100,
      candidateCount: 12,
      deepAnalysisCompanyCount: 5,
      unresolvedIdentityCount: 1,
    },
    broadOpportunityScan: {
      enabled: true,
      directoryEligibleCount: 6000,
      candidates: [{ companyId: 'company:broad' }],
    },
    longHistoryResearchSummary: {
      enabled: true,
      eligibleDossierCount: 8,
      selectedCount: 8,
      attemptedCount: 8,
      readyCount: 8,
      rejectedCount: 0,
      skippedByLimit: 0,
      skippedNoCanonicalCount: 0,
      skippedNonIndependentCount: 0,
      independentOverlapAttemptedCount: 1,
      independentOverlapReadyCount: 1,
      independentOverlapRejectedCount: 0,
      minimumOverlapSessions: 40,
      minimumObservations: 1260,
    },
    researchDossiers: Array.from({ length: 8 }, (_, index) => ({ companyId: `company:${index}` })),
  }, {
    eligibleInstrumentCount: 8,
    selectedInstrumentCount: 8,
    universeCoverage: {
      dossierCount: 8,
      loadedHistoricalSeriesCount: 8,
    },
  });

  assert.equal(summary.contract, HISTORICAL_RESEARCH_SOURCE_COHORT_CONTRACT);
  assert.equal(summary.universeExpansion.seedCompanyCount, 2);
  assert.equal(summary.universeExpansion.analysedCompanyCount, 8);
  assert.equal(summary.discovery.deepAnalysisCompanyCount, 5);
  assert.equal(summary.broadOpportunity.candidateCount, 1);
  assert.equal(summary.longHistory.eligibleDossierCount, 8);
  assert.equal(summary.longHistory.selectedCount, 8);
  assert.equal(summary.longHistory.skippedByLimit, 0);
  assert.equal(summary.finalResearchDossierCount, 8);
  assert.equal(summary.walkForwardDossierCount, 8);
  assert.equal(summary.walkForwardLoadedHistoryCount, 8);
  assert.equal(summary.walkForwardEligibleInstrumentCount, 8);
  assert.equal(summary.walkForwardSelectedInstrumentCount, 8);
  assert.equal(summary.rawCompanyRecordsIncluded, false);
  assert.equal(summary.rawHistoricalCandlesIncluded, false);
  assert.equal(summary.selectionRulesChanged, false);
  assert.equal(summary.thresholdsChanged, false);
  assert.equal(summary.historicalResearchOnly, true);
  assert.equal(summary.decisionImpact, 'NONE');
  assert.equal(JSON.stringify(summary).includes('company:0'), false);
});
