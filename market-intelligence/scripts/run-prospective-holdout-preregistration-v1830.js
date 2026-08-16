import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PROSPECTIVE_HOLDOUT_MODEL_FREEZE_SOURCE_COMMIT,
  PROSPECTIVE_HOLDOUT_PROTOCOL_CONTRACT,
  buildProspectiveHoldoutProtocol,
  protocolFingerprint,
} from '../src/forecast-prospective-holdout-protocol.js';

export const V1830_PROSPECTIVE_HOLDOUT_PREREGISTRATION_PROOF_CONTRACT = 'PROSPECTIVE_UNSEEN_HOLDOUT_PREREGISTRATION_PROOF_V1';

export function buildV1830ProspectiveHoldoutPreregistration(input = {}) {
  const protocol = input.protocol || buildProspectiveHoldoutProtocol();
  const blockers = [];
  if (protocol.contract !== PROSPECTIVE_HOLDOUT_PROTOCOL_CONTRACT) blockers.push('PROSPECTIVE_HOLDOUT_PROTOCOL_CONTRACT_CHANGED');
  if (protocol.modelFreeze?.sourceCommit !== PROSPECTIVE_HOLDOUT_MODEL_FREEZE_SOURCE_COMMIT) blockers.push('PROSPECTIVE_HOLDOUT_MODEL_FREEZE_CHANGED');
  if (protocol.modelFreeze?.sourceProofVerdict !== 'NO_EXISTING_STACK_VARIANT_MEETS_PREDECLARED_PREDICTIVE_STANDARD') blockers.push('PROSPECTIVE_HOLDOUT_FALSIFICATION_VERDICT_CHANGED');
  if (protocol.universeFreeze?.instrumentCount !== 16 || protocol.universeFreeze?.marketDomain !== 'US_EQUITY' || protocol.universeFreeze?.benchmarkFamily !== 'SPY') blockers.push('PROSPECTIVE_HOLDOUT_UNIVERSE_FREEZE_CHANGED');
  if (protocol.horizons?.length !== 2 || protocol.captureProtocol?.expectedSlotCountPerCapture !== 128) blockers.push('PROSPECTIVE_HOLDOUT_SLOT_MATRIX_CHANGED');
  if (protocol.evaluationProtocol?.minimumEvaluationSamplePerGroup !== 200
      || protocol.evaluationProtocol?.minimumClassCountPerGroup !== 40
      || protocol.evaluationProtocol?.minimumSkillPctVsBaseRate !== 5
      || protocol.evaluationProtocol?.maximumExpectedCalibrationError !== 0.08
      || protocol.evaluationProtocol?.minimumBrierImprovementPctVsRawPattern !== 3
      || protocol.evaluationProtocol?.minimumDistinctForecastDates !== 40
      || protocol.evaluationProtocol?.minimumDistinctInstruments !== 10
      || protocol.evaluationProtocol?.chronologicalBlockCount !== 3
      || protocol.evaluationProtocol?.thresholdWeakeningAllowed !== false) blockers.push('PROSPECTIVE_HOLDOUT_EVALUATION_STANDARD_CHANGED');
  if (protocol.historicalBackfillAllowed !== false
      || protocol.modelFreeze?.specificationChangeAllowedInsideHoldout !== false
      || protocol.modelFreeze?.variantRemovalAllowedInsideHoldout !== false
      || protocol.modelFreeze?.postHocWinnerSelectionAllowed !== false
      || protocol.evaluationProtocol?.performancePeekingBeforeGateAllowed !== false
      || protocol.evaluationProtocol?.earlyStoppingForPositivePerformanceAllowed !== false) blockers.push('PROSPECTIVE_HOLDOUT_ANTI_P_HACKING_GUARD_CHANGED');
  if (protocol.prospectiveResearchOnly !== true
      || protocol.automaticModelPromotionEnabled !== false
      || protocol.decisionIntegrationEnabled !== false
      || protocol.forecastMayInfluenceFinalAction !== false
      || protocol.finalActionEligible !== false
      || protocol.brokerExecutionEligible !== false
      || protocol.decisionImpact !== 'NONE') blockers.push('PROSPECTIVE_HOLDOUT_AUTHORITY_BOUNDARY_CHANGED');

  const uniqueBlockers = [...new Set(blockers)];
  return {
    format: 'investor-control-prospective-holdout-preregistration-proof',
    version: 1,
    contract: V1830_PROSPECTIVE_HOLDOUT_PREREGISTRATION_PROOF_CONTRACT,
    status: uniqueBlockers.length ? 'PROSPECTIVE_HOLDOUT_PREREGISTRATION_BLOCKED' : 'PROSPECTIVE_HOLDOUT_PREREGISTRATION_VERIFIED',
    verified: uniqueBlockers.length === 0,
    sourceCommit: input.sourceCommit || null,
    modelFreezeSourceCommit: protocol.modelFreeze.sourceCommit,
    holdoutId: protocol.holdoutId,
    protocolFingerprint: protocolFingerprint(protocol),
    expectedSlotCountPerCapture: protocol.captureProtocol.expectedSlotCountPerCapture,
    protocol,
    blockers: uniqueBlockers,
    holdoutStarted: false,
    firstCaptureCreated: false,
    historicalBackfillAllowed: false,
    prospectiveResearchOnly: true,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

export function assertV1830ProspectiveHoldoutPreregistrationReady(proof = {}) {
  if (proof?.contract !== V1830_PROSPECTIVE_HOLDOUT_PREREGISTRATION_PROOF_CONTRACT || proof?.verified !== true) {
    throw new Error(`v1830 prospective holdout preregistration blocked: ${(proof?.blockers || []).join(',') || 'UNKNOWN'}`);
  }
  return true;
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1830-prospective-holdout-preregistration.json');
  const proof = buildV1830ProspectiveHoldoutPreregistration({
    sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT || null,
  });
  assertV1830ProspectiveHoldoutPreregistrationReady(proof);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  console.log(`Wrote v1830 prospective holdout preregistration to ${outputPath}`);
  console.log(`Holdout: ${proof.holdoutId}`);
  console.log(`Model freeze: ${proof.modelFreezeSourceCommit}`);
  console.log(`Protocol fingerprint: ${proof.protocolFingerprint}`);
  console.log(`Expected forecast slots per capture: ${proof.expectedSlotCountPerCapture}`);
  console.log('Holdout has NOT started; first post-protocol verified capture starts it.');
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
