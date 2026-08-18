import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildProspectiveHoldoutCaptureV2,
  buildProspectiveHoldoutProtocolV2,
  protocolV2Fingerprint,
  verifyProspectiveHoldoutCaptureV2,
} from '../src/forecast-prospective-holdout-protocol-v2.js';
import { runV1835V2FirstCapture } from './run-prospective-holdout-v2-first-capture-v1835.js';

export const V1836_V2_SESSION_CAPTURE_CONTRACT = 'PROSPECTIVE_UNSEEN_HOLDOUT_V2_CHAINED_SESSION_CAPTURE_V1';
export const V1836_V2_SESSION_CAPTURE_VERSION = '2026-08-17.1';

export function extractV2ChainHead(previous = {}) {
  if (previous?.contract === V1836_V2_SESSION_CAPTURE_CONTRACT) {
    return {
      hash: previous.chainHeadCaptureHash || null,
      sessionDate: previous.chainHeadSessionDate || null,
      sequence: Number(previous.captureSequence || 0),
      holdoutId: previous.holdoutId || null,
    };
  }
  if (previous?.contract === 'PROSPECTIVE_UNSEEN_HOLDOUT_V2_FIRST_CAPTURE_PROOF_V1') {
    return {
      hash: previous?.capture?.contentHash || null,
      sessionDate: previous?.completedSessionDate || null,
      sequence: previous?.capture?.contentHash ? 1 : 0,
      holdoutId: previous?.holdoutId || null,
    };
  }
  return { hash: null, sessionDate: null, sequence: 0, holdoutId: null };
}

export function assertV1836V2SessionCaptureReady(proof = {}) {
  const blockers = [];
  if (proof?.contract !== V1836_V2_SESSION_CAPTURE_CONTRACT) blockers.push('V1836_CONTRACT_CHANGED');
  if (!proof?.chainHeadCaptureHash || !proof?.chainHeadSessionDate || Number(proof?.captureSequence) < 1) blockers.push('V1836_CHAIN_HEAD_MISSING');
  if (proof?.status === 'NEW_V2_SESSION_CAPTURE_VERIFIED') {
    if (proof?.captureCreated !== true || proof?.captureVerification?.verified !== true) blockers.push('V1836_NEW_CAPTURE_NOT_VERIFIED');
    if (proof?.capture?.previousCaptureHash !== proof?.previousChainHeadCaptureHash) blockers.push('V1836_PREVIOUS_HASH_LINK_BROKEN');
    if (proof?.capture?.contentHash !== proof?.chainHeadCaptureHash) blockers.push('V1836_CHAIN_HEAD_NOT_NEW_CAPTURE');
    if (proof?.captureSequence !== proof?.previousCaptureSequence + 1) blockers.push('V1836_CAPTURE_SEQUENCE_INVALID');
  } else if (proof?.status === 'NO_NEW_COMPLETED_SESSION') {
    if (proof?.captureCreated !== false || proof?.capture !== null) blockers.push('V1836_DUPLICATE_SESSION_CREATED_CAPTURE');
    if (proof?.chainHeadCaptureHash !== proof?.previousChainHeadCaptureHash || proof?.captureSequence !== proof?.previousCaptureSequence) blockers.push('V1836_NOOP_CHANGED_CHAIN_HEAD');
  } else blockers.push('V1836_STATUS_INVALID');
  if (proof?.performancePeeked !== false || proof?.outcomeFieldsIncluded !== false || proof?.historicalBackfillAllowed !== false) blockers.push('V1836_PREOUTCOME_BOUNDARY_BROKEN');
  if (proof?.automaticModelPromotionEnabled !== false || proof?.decisionIntegrationEnabled !== false || proof?.forecastMayInfluenceFinalAction !== false || proof?.brokerExecutionEligible !== false || proof?.decisionImpact !== 'NONE') blockers.push('V1836_AUTHORITY_BOUNDARY_BROKEN');
  const unique = [...new Set(blockers)];
  if (unique.length) throw new Error(`v1836 v2 chained capture blocked: ${unique.join(',')}`);
  return true;
}

export async function runV1836V2SessionCapture(input = {}) {
  const protocol = buildProspectiveHoldoutProtocolV2();
  const previousHead = extractV2ChainHead(input.previousProof || {});
  if (!previousHead.hash || !previousHead.sessionDate || previousHead.sequence < 1) throw new Error('v1836 requires a verified v2 chain head');
  if (previousHead.holdoutId !== protocol.holdoutId) throw new Error('v1836 prior chain belongs to a different holdout');

  const candidate = await runV1835V2FirstCapture({
    sourceCommit: input.sourceCommit || null,
    capturedAt: input.capturedAt,
    fetchImpl: input.fetchImpl,
  });
  const candidateSessionDate = candidate.completedSessionDate;
  const common = {
    format: 'investor-control-prospective-unseen-holdout-v2-session-capture',
    version: 1,
    policyVersion: V1836_V2_SESSION_CAPTURE_VERSION,
    contract: V1836_V2_SESSION_CAPTURE_CONTRACT,
    sourceCommit: input.sourceCommit || null,
    holdoutId: protocol.holdoutId,
    protocolContract: protocol.contract,
    protocolFingerprint: protocolV2Fingerprint(protocol),
    checkedAt: candidate.capturedAt,
    candidateCompletedSessionDate: candidateSessionDate,
    previousChainHeadSessionDate: previousHead.sessionDate,
    previousChainHeadCaptureHash: previousHead.hash,
    previousCaptureSequence: previousHead.sequence,
    operationalSummary: {
      fiveYearHistoryReadyCount: candidate.marketDataSummary.fiveYearHistoryReadyCount,
      fiveYearBenchmarkReadyCount: candidate.marketDataSummary.fiveYearBenchmarkReadyCount,
      sessionAlignedInstrumentCount: candidate.marketDataSummary.sessionAlignedInstrumentCount,
      targetReadyCount: candidate.targetSummary.readyTargetCount,
      targetCount: candidate.targetSummary.targetCount,
      availableForecastCount: candidate.availableForecastCount,
      withheldForecastCount: candidate.withheldForecastCount,
      evaluationLineageComplete: candidate.targetSummary.rawPatternBaselineCapturedInEverySlot === true
        && candidate.targetSummary.regimeKeyCapturedInEverySlot === true
        && candidate.targetSummary.targetFeatureFingerprintCapturedInEverySlot === true,
    },
    holdoutStarted: true,
    holdoutContinues: true,
    historicalBackfillAllowed: false,
    performancePeeked: false,
    outcomeFieldsIncluded: false,
    evaluationGateOpened: false,
    prospectiveResearchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };

  if (!(candidateSessionDate > previousHead.sessionDate)) {
    const proof = {
      ...common,
      status: 'NO_NEW_COMPLETED_SESSION',
      captureCreated: false,
      capture: null,
      captureVerification: null,
      chainHeadCaptureHash: previousHead.hash,
      chainHeadSessionDate: previousHead.sessionDate,
      captureSequence: previousHead.sequence,
      operationalSummary: { ...common.operationalSummary, duplicateCompletedSessionPrevented: true },
    };
    assertV1836V2SessionCaptureReady(proof);
    return proof;
  }

  const capture = buildProspectiveHoldoutCaptureV2({
    protocol,
    capturedAt: candidate.capturedAt,
    sourceDataAsOf: candidate.sourceDataAsOf,
    previousCaptureHash: previousHead.hash,
    slots: candidate.capture.slots,
  });
  const captureVerification = verifyProspectiveHoldoutCaptureV2(capture, protocol);
  if (!captureVerification.verified) throw new Error(`v1836 v2 capture verification failed: ${(captureVerification.blockers || []).join(',')}`);
  const proof = {
    ...common,
    status: 'NEW_V2_SESSION_CAPTURE_VERIFIED',
    captureCreated: true,
    capture,
    captureVerification,
    chainHeadCaptureHash: capture.contentHash,
    chainHeadSessionDate: candidateSessionDate,
    captureSequence: previousHead.sequence + 1,
    operationalSummary: { ...common.operationalSummary, duplicateCompletedSessionPrevented: false },
  };
  assertV1836V2SessionCaptureReady(proof);
  return proof;
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1836-v2-session-capture.json');
  const previousPath = process.env.PREVIOUS_V2_CAPTURE_PROOF_PATH || process.argv[3];
  if (!previousPath) throw new Error('PREVIOUS_V2_CAPTURE_PROOF_PATH is required');
  const previousProof = JSON.parse(await readFile(path.resolve(process.cwd(), previousPath), 'utf8'));
  const proof = await runV1836V2SessionCapture({ previousProof, sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT || null });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  console.log(`Wrote v1836 v2 session capture to ${outputPath}`);
  console.log(`Status: ${proof.status}`);
  console.log(`Session: ${proof.candidateCompletedSessionDate}; sequence: ${proof.captureSequence}; created: ${proof.captureCreated}`);
  console.log(`Chain head: ${proof.chainHeadCaptureHash}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) main().catch((error) => { console.error(error); process.exitCode = 1; });
