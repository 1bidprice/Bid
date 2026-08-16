import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertV1827DatasetIntegrityReady,
  runV1827HistoricalPredictiveSkillResearchJob,
} from './run-cross-sectional-regime-walk-forward-research-v1827.js';
import {
  HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_CONTRACT,
  HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_MINIMUM_LOADED_INSTRUMENTS,
  buildHistoricalResearchValidationUniverse,
  summarizeHistoricalResearchValidationUniverse,
} from '../src/historical-research-validation-universe.js';

export const V1828_STABLE_COHORT_PROOF_CONTRACT = 'HISTORICAL_RESEARCH_STABLE_COHORT_PROOF_V1';
export const V1828_STABLE_COHORT_INTEGRITY_CONTRACT = 'HISTORICAL_RESEARCH_STABLE_COHORT_INTEGRITY_V1';

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

export function buildV1828StableCohortIntegrity(artifact = {}, validationUniverse = {}) {
  const source = artifact?.sourceCohortSummary || {};
  const expansion = source?.universeExpansion || {};
  const coverage = artifact?.universeCoverage || {};
  const configuredInstrumentCount = count(validationUniverse.configuredInstrumentCount);
  const minimumLoadedInstrumentCount = count(
    validationUniverse.minimumLoadedInstrumentCount
      ?? HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_MINIMUM_LOADED_INSTRUMENTS,
  );
  const seedCompanyCount = count(expansion.seedCompanyCount);
  const eventDiscoveredCompanyCount = count(expansion.eventDiscoveredCompanyCount);
  const broadScreenCompanyCount = count(expansion.broadScreenCompanyCount);
  const analysedCompanyCount = count(expansion.analysedCompanyCount);
  const loadedHistoricalSeriesCount = count(coverage.loadedHistoricalSeriesCount);
  const loadedBenchmarkSeriesCount = count(coverage.loadedBenchmarkSeriesCount);
  const eligibleInstrumentCount = count(coverage.eligibleInstrumentCount);
  const selectedInstrumentCount = count(coverage.selectedInstrumentCount);
  const eligibleWithBenchmarkCount = count(coverage.eligibleWithBenchmarkCount);
  const eligibleWithoutBenchmarkCount = count(coverage.eligibleWithoutBenchmarkCount);
  const blockers = [];

  if (validationUniverse.contract !== HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_CONTRACT) {
    blockers.push('STABLE_VALIDATION_UNIVERSE_CONTRACT_MISSING');
  }
  if (configuredInstrumentCount < minimumLoadedInstrumentCount) {
    blockers.push('STABLE_VALIDATION_UNIVERSE_CONFIGURED_TOO_SMALL');
  }
  if (count(validationUniverse.uniqueCompanyCount) !== configuredInstrumentCount
      || count(validationUniverse.uniqueListingCount) !== configuredInstrumentCount
      || count(validationUniverse.canonicalIdentityReadyCount) !== configuredInstrumentCount) {
    blockers.push('STABLE_VALIDATION_UNIVERSE_IDENTITY_NOT_UNIQUE');
  }
  if (validationUniverse.marketDomain !== 'US_EQUITY'
      || validationUniverse.benchmarkFamily !== 'SPY'
      || count(validationUniverse.usEquityCount) !== configuredInstrumentCount) {
    blockers.push('STABLE_VALIDATION_UNIVERSE_DOMAIN_NOT_HOMOGENEOUS');
  }
  if (validationUniverse.currentNewsDependentSelection !== false
      || validationUniverse.outcomeAwareSelectionAllowed !== false
      || validationUniverse.eventDiscoveryAdditionsAllowed !== false) {
    blockers.push('STABLE_VALIDATION_UNIVERSE_SELECTION_NOT_FROZEN');
  }
  if (seedCompanyCount !== configuredInstrumentCount || analysedCompanyCount !== configuredInstrumentCount) {
    blockers.push('STABLE_VALIDATION_UNIVERSE_RUNTIME_COUNT_MISMATCH');
  }
  if (eventDiscoveredCompanyCount !== 0) blockers.push('EVENT_DISCOVERY_CHANGED_STABLE_VALIDATION_UNIVERSE');
  if (broadScreenCompanyCount !== 0) blockers.push('BROAD_SCREEN_CHANGED_STABLE_VALIDATION_UNIVERSE');
  if (loadedHistoricalSeriesCount < minimumLoadedInstrumentCount) blockers.push('STABLE_VALIDATION_HISTORY_BREADTH_TOO_SMALL');
  if (loadedBenchmarkSeriesCount < minimumLoadedInstrumentCount) blockers.push('STABLE_VALIDATION_BENCHMARK_BREADTH_TOO_SMALL');
  if (eligibleInstrumentCount < minimumLoadedInstrumentCount) blockers.push('STABLE_VALIDATION_ELIGIBLE_BREADTH_TOO_SMALL');
  if (selectedInstrumentCount < minimumLoadedInstrumentCount) blockers.push('STABLE_VALIDATION_SELECTED_BREADTH_TOO_SMALL');
  if (loadedHistoricalSeriesCount !== configuredInstrumentCount) blockers.push('STABLE_VALIDATION_HISTORY_COHORT_INCOMPLETE');
  if (loadedBenchmarkSeriesCount !== configuredInstrumentCount) blockers.push('STABLE_VALIDATION_BENCHMARK_COHORT_INCOMPLETE');
  if (eligibleInstrumentCount !== configuredInstrumentCount) blockers.push('STABLE_VALIDATION_ELIGIBLE_COHORT_INCOMPLETE');
  if (selectedInstrumentCount !== configuredInstrumentCount) blockers.push('STABLE_VALIDATION_SELECTED_COHORT_INCOMPLETE');
  if (eligibleWithBenchmarkCount !== configuredInstrumentCount || eligibleWithoutBenchmarkCount !== 0) {
    blockers.push('STABLE_VALIDATION_BENCHMARK_LINEAGE_INCOMPLETE');
  }

  const ready = blockers.length === 0;
  return {
    contract: V1828_STABLE_COHORT_INTEGRITY_CONTRACT,
    status: ready ? 'STABLE_RESEARCH_COHORT_INTEGRITY_READY' : 'STABLE_RESEARCH_COHORT_INTEGRITY_BLOCKED',
    ready,
    configuredInstrumentCount,
    minimumLoadedInstrumentCount,
    seedCompanyCount,
    eventDiscoveredCompanyCount,
    broadScreenCompanyCount,
    analysedCompanyCount,
    loadedHistoricalSeriesCount,
    loadedBenchmarkSeriesCount,
    eligibleInstrumentCount,
    selectedInstrumentCount,
    eligibleWithBenchmarkCount,
    eligibleWithoutBenchmarkCount,
    blockers,
    marketDomain: 'US_EQUITY',
    benchmarkFamily: 'SPY',
    currentNewsDependentSelection: false,
    outcomeAwareSelectionAllowed: false,
    eventDiscoveryAdditionsAllowed: false,
    broadOpportunityAdditionsAllowed: false,
    crossMarketValidationIncluded: false,
    athensDomainValidated: false,
    athensDomainStatus: 'SEPARATE_DOMAIN_PROOF_REQUIRED',
    survivorshipBiasControlled: false,
    survivorshipBiasStatus: 'REQUIRES_POINT_IN_TIME_UNIVERSE_BEFORE_PRODUCTION_PROMOTION',
    rawCompanyRecordsIncluded: false,
    rawHistoricalCandlesIncluded: false,
    historicalResearchOnly: true,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

export function assertV1828StableCohortIntegrityReady(integrity = {}) {
  if (integrity?.contract !== V1828_STABLE_COHORT_INTEGRITY_CONTRACT || integrity?.ready !== true) {
    const blockers = Array.isArray(integrity?.blockers) && integrity.blockers.length
      ? integrity.blockers.join(',')
      : 'UNKNOWN_STABLE_COHORT_FAILURE';
    throw new Error(`v1828 stable research cohort blocked: ${blockers}`);
  }
  return true;
}

export async function runV1828StableCohortPredictiveSkillResearchJob(input = {}) {
  const runBase = input.runV1827 || runV1827HistoricalPredictiveSkillResearchJob;
  const validationUniverse = input.validationUniverse || buildHistoricalResearchValidationUniverse();
  const validationUniverseSummary = summarizeHistoricalResearchValidationUniverse(validationUniverse);
  const { runV1827: _ignoredRunV1827, validationUniverse: _ignoredValidationUniverse, ...baseInput } = input;
  const artifact = await runBase({
    ...baseInput,
    autonomousOptions: {
      ...(baseInput.autonomousOptions || {}),
      universe: validationUniverse,
      minimumScore: 101,
      enableBroadOpportunityScan: false,
      enableAthensDiscovery: false,
      collectTrustedNews: false,
      documentLimit: 0,
    },
  });
  const stableCohortIntegrity = buildV1828StableCohortIntegrity(artifact, validationUniverseSummary);

  return {
    ...artifact,
    stableCohortProofContract: V1828_STABLE_COHORT_PROOF_CONTRACT,
    validationUniverse: validationUniverseSummary,
    stableCohortIntegrity,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1828-stable-cohort-predictive-skill-research.json');
  const result = await runV1828StableCohortPredictiveSkillResearchJob({
    maximumInstrumentCount: process.env.HISTORICAL_RESEARCH_MAX_INSTRUMENTS,
    sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`Wrote v1828 stable-cohort research artifact to ${outputPath}`);
  console.log(`Stable validation universe: ${result.validationUniverse.configuredInstrumentCount} configured across ${result.validationUniverse.sectorCount} sectors`);
  console.log(`Stable cohort runtime: histories=${result.stableCohortIntegrity.loadedHistoricalSeriesCount}, benchmarks=${result.stableCohortIntegrity.loadedBenchmarkSeriesCount}, eligible=${result.stableCohortIntegrity.eligibleInstrumentCount}, selected=${result.stableCohortIntegrity.selectedInstrumentCount}`);
  console.log(`Stable cohort integrity: ${result.stableCohortIntegrity.status}`);
  console.log(`Historical records: ${result.telemetry?.forecastHistoricalWalkForwardGeneratedRecordCount || 0}`);
  console.log(`Evaluation-ready groups: ${result.predictiveSkillSummary?.evaluationReadyGroupCount || 0}`);
  console.log(`Predictive-skill-ready groups: ${result.predictiveSkillSummary?.predictiveSkillReadyGroupCount || 0}`);
  console.log(`Adaptive predictive-ready groups: ${result.adaptivePriorShrunkCandidateSummary?.predictiveReadyGroupCount || 0}/${result.adaptivePriorShrunkCandidateSummary?.groupCount || 0}`);
  assertV1828StableCohortIntegrityReady(result.stableCohortIntegrity);
  assertV1827DatasetIntegrityReady(result.datasetIntegrity);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
