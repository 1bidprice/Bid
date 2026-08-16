import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertV1828StableCohortIntegrityReady,
  runV1828StableCohortPredictiveSkillResearchJob,
} from './run-cross-sectional-regime-walk-forward-research-v1828.js';
import { assertV1827DatasetIntegrityReady } from './run-cross-sectional-regime-walk-forward-research-v1827.js';
import {
  HISTORICAL_MARKET_EXISTING_STACK_FALSIFICATION_CONTRACT,
  buildHistoricalMarketExistingStackFalsification,
} from '../src/forecast-historical-market-existing-stack-falsification.js';

export const V1829_EXISTING_STACK_FALSIFICATION_PROOF_CONTRACT = 'HISTORICAL_MARKET_EXISTING_STACK_FALSIFICATION_PROOF_V1';

export function assertV1829FalsificationIntegrityReady(falsification = {}) {
  const blockers = [];
  if (falsification?.contract !== HISTORICAL_MARKET_EXISTING_STACK_FALSIFICATION_CONTRACT) blockers.push('FALSIFICATION_CONTRACT_CHANGED');
  if (falsification?.lineageVerified !== true) blockers.push('FALSIFICATION_LINEAGE_NOT_VERIFIED');
  if (Number(falsification?.variantCount || 0) !== 4) blockers.push('FALSIFICATION_VARIANT_COUNT_CHANGED');
  if (falsification?.diagnosticOnly !== true) blockers.push('FALSIFICATION_NOT_DIAGNOSTIC_ONLY');
  if (falsification?.winnerSelectionAllowed !== false) blockers.push('FALSIFICATION_WINNER_SELECTION_ENABLED');
  if (falsification?.sameDatasetModelSelectionAllowed !== false) blockers.push('SAME_DATASET_MODEL_SELECTION_ENABLED');
  if (falsification?.sameDatasetPromotionAllowed !== false) blockers.push('SAME_DATASET_PROMOTION_ENABLED');
  if (falsification?.automaticModelPromotionEnabled !== false) blockers.push('FALSIFICATION_AUTOMATIC_PROMOTION_ENABLED');
  if (falsification?.decisionIntegrationEnabled !== false) blockers.push('FALSIFICATION_DECISION_INTEGRATION_ENABLED');
  if (falsification?.forecastMayInfluenceFinalAction !== false) blockers.push('FALSIFICATION_FINAL_ACTION_INFLUENCE_ENABLED');
  if (falsification?.brokerExecutionEligible !== false) blockers.push('FALSIFICATION_BROKER_AUTHORITY_ENABLED');
  if (falsification?.decisionImpact !== 'NONE') blockers.push('FALSIFICATION_DECISION_IMPACT_CHANGED');
  if (blockers.length) throw new Error(`v1829 falsification integrity blocked: ${blockers.join(',')}`);
  return true;
}

export async function runV1829ExistingStackFalsificationResearchJob(input = {}) {
  const runBase = input.runV1828 || runV1828StableCohortPredictiveSkillResearchJob;
  const { runV1828: _ignoredRunV1828, ...baseInput } = input;
  const artifact = await runBase(baseInput);
  const stackResearch = artifact?.researchStatus?.research?.historicalMarketStackResearch || null;
  const existingStackFalsification = buildHistoricalMarketExistingStackFalsification(stackResearch || {});

  return {
    ...artifact,
    existingStackFalsificationProofContract: V1829_EXISTING_STACK_FALSIFICATION_PROOF_CONTRACT,
    existingStackFalsification,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1829-existing-stack-falsification-research.json');
  const result = await runV1829ExistingStackFalsificationResearchJob({
    maximumInstrumentCount: process.env.HISTORICAL_RESEARCH_MAX_INSTRUMENTS,
    sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  assertV1828StableCohortIntegrityReady(result.stableCohortIntegrity);
  assertV1827DatasetIntegrityReady(result.datasetIntegrity);
  assertV1829FalsificationIntegrityReady(result.existingStackFalsification);

  console.log(`Wrote v1829 existing-stack falsification artifact to ${outputPath}`);
  console.log(`Source commit: ${result.sourceCommit || 'UNKNOWN'}`);
  console.log(`Stable cohort: ${result.stableCohortIntegrity.loadedHistoricalSeriesCount}/${result.stableCohortIntegrity.configuredInstrumentCount} histories, ${result.stableCohortIntegrity.loadedBenchmarkSeriesCount}/${result.stableCohortIntegrity.configuredInstrumentCount} benchmarks`);
  console.log(`Dataset integrity: ${result.datasetIntegrity.status} (${result.datasetIntegrity.validRegimeRecordCount}/${result.datasetIntegrity.generatedRecordCount})`);
  console.log(`Falsification verdict: ${result.existingStackFalsification.status}`);
  for (const summary of result.existingStackFalsification.variantSummaries || []) {
    console.log(`${summary.modelVariant}: evaluable=${summary.evaluableGroupCount}, positive-skill=${summary.positiveSkillGroupCount}, >=5%-skill=${summary.promotionSkillGroupCount}, chrono-non-regressing=${summary.chronologicalNonRegressingGroupCount}, strict-signal=${summary.strictSignalGroupCount}, weighted-skill=${summary.sampleWeightedSkillVsBaseRatePct}`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
