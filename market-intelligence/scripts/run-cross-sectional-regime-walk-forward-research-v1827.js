import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runV1826HistoricalResearchJob } from './run-cross-sectional-regime-walk-forward-research-v1826.js';
import { buildHistoricalPredictiveSkillSummary } from '../src/forecast-historical-predictive-skill.js';
import { verifyHistoricalMarketDomainStackCandidate } from '../src/forecast-historical-market-domain-stack-candidate-safety.js';
import { verifyHistoricalMarketPriorShrunkStackCandidate } from '../src/forecast-historical-market-prior-shrunk-stack-candidate-safety.js';

export const V1827_PREDICTIVE_SKILL_ARTIFACT_CONTRACT = 'HISTORICAL_PREDICTIVE_SKILL_ARTIFACT_V1';
export const V1827_DATASET_INTEGRITY_CONTRACT = 'HISTORICAL_PREDICTIVE_DATASET_INTEGRITY_V1';

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

export function buildV1827DatasetIntegrity(artifact = {}) {
  const telemetry = artifact?.telemetry || {};
  const generatedRecordCount = count(telemetry.forecastHistoricalWalkForwardGeneratedRecordCount);
  const validRegimeRecordCount = count(telemetry.forecastHistoricalWalkForwardValidRegimeRecordCount);
  const regimeUnavailableRecordCount = Math.max(0, generatedRecordCount - validRegimeRecordCount);
  const blockers = [];
  if (generatedRecordCount === 0) blockers.push('HISTORICAL_PREDICTIVE_DATASET_EMPTY');
  if (validRegimeRecordCount !== generatedRecordCount) blockers.push('HISTORICAL_REGIME_COVERAGE_INCOMPLETE');
  const ready = blockers.length === 0;

  return {
    contract: V1827_DATASET_INTEGRITY_CONTRACT,
    status: ready ? 'HISTORICAL_PREDICTIVE_DATASET_INTEGRITY_READY' : 'HISTORICAL_PREDICTIVE_DATASET_INTEGRITY_BLOCKED',
    ready,
    generatedRecordCount,
    validRegimeRecordCount,
    regimeUnavailableRecordCount,
    regimeCoveragePct: generatedRecordCount > 0
      ? Number(((validRegimeRecordCount / generatedRecordCount) * 100).toFixed(4))
      : 0,
    requiresCompleteHistoricalRegimeCoverage: true,
    blockers,
    rawHistoricalRecordsIncluded: false,
    rawHistoricalCandlesIncluded: false,
    historicalResearchOnly: true,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

function blockPredictiveSummary(summary, datasetIntegrity) {
  if (datasetIntegrity.ready) {
    return { ...summary, datasetIntegrityReady: true };
  }
  return {
    ...summary,
    status: 'PREDICTIVE_SKILL_EVALUATION_BLOCKED_BY_DATASET_INTEGRITY',
    datasetIntegrityReady: false,
    diagnosticGroupCount: summary.groupCount,
    groupCount: 0,
    evaluationReadyGroupCount: 0,
    predictiveSkillReadyGroupCount: 0,
    predictiveSkillNotReadyGroupCount: 0,
    notEvaluableGroupCount: 0,
    blockerCounts: [{ code: 'HISTORICAL_DATASET_INTEGRITY_NOT_READY', groupCount: 1 }],
    groups: [],
  };
}

export function assertV1827DatasetIntegrityReady(datasetIntegrity = {}) {
  if (datasetIntegrity?.contract !== V1827_DATASET_INTEGRITY_CONTRACT || datasetIntegrity?.ready !== true) {
    const blockers = Array.isArray(datasetIntegrity?.blockers) && datasetIntegrity.blockers.length
      ? datasetIntegrity.blockers.join(',')
      : 'UNKNOWN_DATASET_INTEGRITY_FAILURE';
    throw new Error(`v1827 predictive dataset integrity blocked: ${blockers}`);
  }
  if (datasetIntegrity.validRegimeRecordCount !== datasetIntegrity.generatedRecordCount
      || datasetIntegrity.regimeUnavailableRecordCount !== 0
      || datasetIntegrity.regimeCoveragePct !== 100) {
    throw new Error('v1827 predictive dataset integrity inconsistent');
  }
  return true;
}

export async function runV1827HistoricalPredictiveSkillResearchJob(input = {}) {
  const runBase = input.runV1826 || runV1826HistoricalResearchJob;
  const { runV1826: _ignored, ...baseInput } = input;
  const artifact = await runBase(baseInput);
  const research = artifact?.researchStatus?.research || null;
  const groups = Array.isArray(research?.groups) ? research.groups : [];
  const datasetIntegrity = buildV1827DatasetIntegrity(artifact);
  const predictiveSkillSummary = blockPredictiveSummary(
    buildHistoricalPredictiveSkillSummary(groups),
    datasetIntegrity,
  );
  const sourceRecordCount = count(research?.validRegimeRecordCount);
  const marketStackResearch = research?.historicalMarketStackResearch || null;
  const domainSeparatedCandidate = marketStackResearch?.domainSeparatedCandidate || null;
  const priorShrunkCandidate = marketStackResearch?.priorShrunkCandidate || null;
  const domainCandidateSafety = verifyHistoricalMarketDomainStackCandidate(domainSeparatedCandidate, {
    sourceRecordCount,
  });
  const priorShrunkCandidateSafety = verifyHistoricalMarketPriorShrunkStackCandidate(priorShrunkCandidate, {
    sourceRecordCount,
  });

  return {
    ...artifact,
    predictiveSkillArtifactContract: V1827_PREDICTIVE_SKILL_ARTIFACT_CONTRACT,
    evaluationReadinessMeaning: 'SUFFICIENT_FOR_EVALUATION_NOT_PREDICTIVE_SKILL',
    datasetIntegrity,
    predictiveSkillSummary,
    domainCandidateSafety,
    priorShrunkCandidateSafety,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1827-historical-predictive-skill-research.json');
  const result = await runV1827HistoricalPredictiveSkillResearchJob({
    maximumInstrumentCount: process.env.HISTORICAL_RESEARCH_MAX_INSTRUMENTS,
    sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`Wrote v1827 predictive-skill research artifact to ${outputPath}`);
  console.log(`Dataset integrity: ${result.datasetIntegrity.status} (${result.datasetIntegrity.validRegimeRecordCount}/${result.datasetIntegrity.generatedRecordCount})`);
  console.log(`Evaluation-ready groups: ${result.predictiveSkillSummary.evaluationReadyGroupCount}`);
  console.log(`Predictive-skill-ready groups: ${result.predictiveSkillSummary.predictiveSkillReadyGroupCount}`);
  const marketStack = result?.researchStatus?.research?.historicalMarketStackResearch || null;
  if (marketStack) {
    console.log(`Historical market stack source records: ${marketStack.sourceRecordCount}`);
    console.log(`Historical market stack OOS predictions: ${marketStack.predictionCount}`);
    console.log(`Historical market stack predictive-ready groups: ${marketStack.predictiveReadyGroupCount}/${marketStack.groupCount}`);
    const domain = marketStack.domainSeparatedCandidate || null;
    if (domain) {
      console.log(`Historical domain stack OOS predictions: ${domain.predictionCount}`);
      console.log(`Historical domain stack predictive-ready groups: ${domain.predictiveReadyGroupCount}/${domain.groupCount}`);
      console.log(`Historical domain stack safety: ${result.domainCandidateSafety.status}`);
    }
    const priorShrunk = marketStack.priorShrunkCandidate || null;
    if (priorShrunk) {
      console.log(`Historical prior-shrunk stack OOS predictions: ${priorShrunk.predictionCount}`);
      console.log(`Historical prior-shrunk stack predictive-ready groups: ${priorShrunk.predictiveReadyGroupCount}/${priorShrunk.groupCount}`);
      console.log(`Historical prior-shrunk stack safety: ${result.priorShrunkCandidateSafety.status}`);
    }
  }
  if (result.predictiveSkillSummary.blockerCounts.length) {
    console.log(`Predictive blockers: ${result.predictiveSkillSummary.blockerCounts.map((item) => `${item.code}=${item.groupCount}`).join(', ')}`);
  }
  assertV1827DatasetIntegrityReady(result.datasetIntegrity);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
