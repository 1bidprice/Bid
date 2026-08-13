import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runV1826HistoricalResearchJob } from './run-cross-sectional-regime-walk-forward-research-v1826.js';
import { buildHistoricalPredictiveSkillSummary } from '../src/forecast-historical-predictive-skill.js';

export const V1827_PREDICTIVE_SKILL_ARTIFACT_CONTRACT = 'HISTORICAL_PREDICTIVE_SKILL_ARTIFACT_V1';

export async function runV1827HistoricalPredictiveSkillResearchJob(input = {}) {
  const runBase = input.runV1826 || runV1826HistoricalResearchJob;
  const { runV1826: _ignored, ...baseInput } = input;
  const artifact = await runBase(baseInput);
  const groups = Array.isArray(artifact?.researchStatus?.research?.groups)
    ? artifact.researchStatus.research.groups
    : [];
  const predictiveSkillSummary = buildHistoricalPredictiveSkillSummary(groups);

  return {
    ...artifact,
    predictiveSkillArtifactContract: V1827_PREDICTIVE_SKILL_ARTIFACT_CONTRACT,
    evaluationReadinessMeaning: 'SUFFICIENT_FOR_EVALUATION_NOT_PREDICTIVE_SKILL',
    predictiveSkillSummary,
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
  console.log(`Evaluation-ready groups: ${result.predictiveSkillSummary.evaluationReadyGroupCount}`);
  console.log(`Predictive-skill-ready groups: ${result.predictiveSkillSummary.predictiveSkillReadyGroupCount}`);
  if (result.predictiveSkillSummary.blockerCounts.length) {
    console.log(`Predictive blockers: ${result.predictiveSkillSummary.blockerCounts.map((item) => `${item.code}=${item.groupCount}`).join(', ')}`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
