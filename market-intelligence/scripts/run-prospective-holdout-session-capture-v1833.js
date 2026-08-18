import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildProspectiveHoldoutCapture,
  buildProspectiveHoldoutProtocol,
  protocolFingerprint,
  verifyProspectiveHoldoutCapture,
} from '../src/forecast-prospective-holdout-protocol.js';
import { runV1832FirstProspectiveCapture } from './run-prospective-holdout-first-capture-v1832.js';

export const V1833_SESSION_CAPTURE_CONTRACT = 'PROSPECTIVE_UNSEEN_HOLDOUT_CHAINED_SESSION_CAPTURE_V1';
export const V1833_SESSION_CAPTURE_VERSION = '2026-08-17.1';

function isoDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

export function extractProspectiveChainHead(previous = {}) {
  if (previous?.contract === V1833_SESSION_CAPTURE_CONTRACT) {
    return {
      hash: previous.chainHeadCaptureHash || null,
      sessionDate: previous.chainHeadSessionDate || null,
      sequence: Number(previous.captureSequence || 0),
      holdoutId: previous.holdoutId || null,
    };
  }
  if (previous?.contract === 'PROSPECTIVE_UNSEEN_HOLDOUT_FIRST_CAPTURE_PROOF_V1') {
    return {
      hash: previous?.capture?.contentHash || null,
      sessionDate: previous?.operationalGate?.commonBenchmarkCompletedSessionDate || isoDate(previous?.sourceDataAsOf),
      sequence: previous?.capture?.contentHash ? 1 : 0,
      holdoutId: previous?.holdoutId || null,
    };
  }
  return { hash: null, sessionDate: null, sequence: 0, holdoutId: null };
}

export function assertV1833SessionCaptureProof(proof = {}) {
  const blockers = [];
  if (proof?.contract !== V1833_SESSION_CAPTURE_CONTRACT) blockers.push('V1833_CONTRACT_CHANGED');
  if (!proof?.chainHeadCaptureHash || !proof?.chainHeadSessionDate || Number(proof?.captureSequence) < 1) blockers.push('V1833_CHAIN_HEAD_MISSING');
  if (proof?.status === 'NEW_SESSION_CAPTURE_VERIFIED') {
    if (proof?.captureCreated !== true || proof?.captureVerification?.verified !== true) blockers.push('V1833_NEW_CAPTURE_NOT_VERIFIED');
    if (proof?.capture?.previousCaptureHash !== proof?.previousChainHeadCaptureHash) blockers.push('V1833_PREVIOUS_HASH_LINK_BROKEN');
    if (proof?.chainHeadCaptureHash !== proof?.capture?.contentHash) blockers.push('V1833_CHAIN_HEAD_NOT_NEW_CAPTURE');
    if (proof?.captureSequence !== proof?.previousCaptureSequence + 1) blockers.push('V1833_CAPTURE_SEQUENCE_INVALID');
  } else if (proof?.status === 'NO_NEW_COMPLETED_SESSION') {
    if (proof?.captureCreated !== false) blockers.push('V1833_DUPLICATE_SESSION_CREATED_CAPTURE');
    if (proof?.chainHeadCaptureHash !== proof?.previousChainHeadCaptureHash || proof?.captureSequence !== proof?.previousCaptureSequence) blockers.push('V1833_NOOP_CHANGED_CHAIN_HEAD');
  } else {
    blockers.push('V1833_STATUS_INVALID');
  }
  if (proof?.historicalBackfillAllowed !== false || proof?.performancePeeked !== false || proof?.outcomeFieldsIncluded !== false) blockers.push('V1833_PREOUTCOME_BOUNDARY_BROKEN');
  if (proof?.automaticModelPromotionEnabled !== false
      || proof?.decisionIntegrationEnabled !== false
      || proof?.forecastMayInfluenceFinalAction !== false
      || proof?.finalActionEligible !== false
      || proof?.brokerExecutionEligible !== false
      || proof?.decisionImpact !== 'NONE') blockers.push('V1833_AUTHORITY_BOUNDARY_BROKEN');
  const unique = [...new Set(blockers)];
  if (unique.length) throw new Error(`v1833 chained session capture blocked: ${unique.join(',')}`);
  return true;
}

export async function runV1833SessionCapture(input = {}) {
  const previous = input.previousProof || {};
  const previousHead = extractProspectiveChainHead(previous);
  const protocol = buildProspectiveHoldoutProtocol();
  if (!previousHead.hash || !previousHead.sessionDate || previousHead.sequence < 1) {
    throw new Error('v1833 requires a verified prior prospective capture chain head');
  }
  if (previousHead.holdoutId && previousHead.holdoutId !== protocol.holdoutId) {
    throw new Error('v1833 prior capture belongs to a different holdout');
  }

  const capturedAt = new Date(input.capturedAt || Date.now()).toISOString();
  const candidate = await runV1832FirstProspectiveCapture({
    sourceCommit: input.sourceCommit || null,
    capturedAt,
    finnhubToken: input.finnhubToken,
    fetchImpl: input.fetchImpl,
  });
  if (candidate?.operationalGate?.ready !== true || candidate?.captureVerification?.verified !== true) {
    const blockers = candidate?.operationalGate?.blockers || ['V1833_CANDIDATE_CAPTURE_NOT_READY'];
    throw new Error(`v1833 current-session candidate blocked: ${blockers.join(',')}`);
  }

  const candidateSessionDate = candidate.operationalGate.commonBenchmarkCompletedSessionDate;
  const isNewSession = candidateSessionDate > previousHead.sessionDate;
  if (!isNewSession) {
    const proof = {
      format: 'investor-control-prospective-unseen-holdout-session-capture',
      version: 1,
      policyVersion: V1833_SESSION_CAPTURE_VERSION,
      contract: V1833_SESSION_CAPTURE_CONTRACT,
      status: 'NO_NEW_COMPLETED_SESSION',
      sourceCommit: input.sourceCommit || null,
      holdoutId: protocol.holdoutId,
      protocolContract: protocol.contract,
      protocolFingerprint: protocolFingerprint(protocol),
      checkedAt: capturedAt,
      candidateCompletedSessionDate: candidateSessionDate,
      previousChainHeadSessionDate: previousHead.sessionDate,
      previousChainHeadCaptureHash: previousHead.hash,
      previousCaptureSequence: previousHead.sequence,
      captureCreated: false,
      capture: null,
      captureVerification: null,
      chainHeadCaptureHash: previousHead.hash,
      chainHeadSessionDate: previousHead.sessionDate,
      captureSequence: previousHead.sequence,
      operationalSummary: {
        configuredInstrumentCount: candidate.marketDataSummary.configuredInstrumentCount,
        fiveYearHistoryReadyCount: candidate.marketDataSummary.fiveYearHistoryReadyCount,
        fiveYearBenchmarkReadyCount: candidate.marketDataSummary.fiveYearBenchmarkReadyCount,
        targetReadyCount: candidate.targetSummary.readyTargetCount,
        targetCount: candidate.targetSummary.targetCount,
        availableForecastCount: candidate.operationalGate.availableForecastCount,
        withheldForecastCount: candidate.operationalGate.withheldForecastCount,
        duplicateCompletedSessionPrevented: true,
      },
      holdoutStarted: true,
      holdoutContinues: true,
      historicalBackfillAllowed: false,
      performancePeeked: false,
      outcomeFieldsIncluded: false,
      prospectiveResearchOnly: true,
      automaticModelPromotionEnabled: false,
      probabilityCalibrationEnabled: false,
      decisionIntegrationEnabled: false,
      forecastMayInfluenceFinalAction: false,
      finalActionEligible: false,
      brokerExecutionEligible: false,
      decisionImpact: 'NONE',
    };
    assertV1833SessionCaptureProof(proof);
    return proof;
  }

  const capture = buildProspectiveHoldoutCapture({
    protocol,
    capturedAt: candidate.capturedAt,
    sourceDataAsOf: candidate.sourceDataAsOf,
    previousCaptureHash: previousHead.hash,
    slots: candidate.capture.slots,
  });
  const captureVerification = verifyProspectiveHoldoutCapture(capture, protocol);
  if (!captureVerification.verified) {
    throw new Error(`v1833 chained capture verification failed: ${(captureVerification.blockers || []).join(',')}`);
  }

  const proof = {
    format: 'investor-control-prospective-unseen-holdout-session-capture',
    version: 1,
    policyVersion: V1833_SESSION_CAPTURE_VERSION,
    contract: V1833_SESSION_CAPTURE_CONTRACT,
    status: 'NEW_SESSION_CAPTURE_VERIFIED',
    sourceCommit: input.sourceCommit || null,
    holdoutId: protocol.holdoutId,
    protocolContract: protocol.contract,
    protocolFingerprint: protocolFingerprint(protocol),
    capturedAt: candidate.capturedAt,
    sourceDataAsOf: candidate.sourceDataAsOf,
    candidateCompletedSessionDate: candidateSessionDate,
    previousChainHeadSessionDate: previousHead.sessionDate,
    previousChainHeadCaptureHash: previousHead.hash,
    previousCaptureSequence: previousHead.sequence,
    captureCreated: true,
    capture,
    captureVerification,
    chainHeadCaptureHash: capture.contentHash,
    chainHeadSessionDate: candidateSessionDate,
    captureSequence: previousHead.sequence + 1,
    operationalSummary: {
      configuredInstrumentCount: candidate.marketDataSummary.configuredInstrumentCount,
      fiveYearHistoryReadyCount: candidate.marketDataSummary.fiveYearHistoryReadyCount,
      fiveYearBenchmarkReadyCount: candidate.marketDataSummary.fiveYearBenchmarkReadyCount,
      trainingRecordCount: candidate.trainingCorpusSummary.generatedRecordCount,
      trainingRegimeCoveragePct: candidate.trainingCorpusSummary.regimeCoveragePct,
      targetReadyCount: candidate.targetSummary.readyTargetCount,
      targetCount: candidate.targetSummary.targetCount,
      availableForecastCount: candidate.operationalGate.availableForecastCount,
      withheldForecastCount: candidate.operationalGate.withheldForecastCount,
      duplicateCompletedSessionPrevented: false,
    },
    holdoutStarted: true,
    holdoutContinues: true,
    historicalBackfillAllowed: false,
    performancePeeked: false,
    outcomeFieldsIncluded: false,
    prospectiveResearchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
  assertV1833SessionCaptureProof(proof);
  return proof;
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1833-session-capture.json');
  const previousPath = process.env.PREVIOUS_PROSPECTIVE_CAPTURE_PROOF_PATH || process.argv[3];
  if (!previousPath) throw new Error('PREVIOUS_PROSPECTIVE_CAPTURE_PROOF_PATH is required');
  const previousProof = JSON.parse(await readFile(path.resolve(process.cwd(), previousPath), 'utf8'));
  const proof = await runV1833SessionCapture({
    previousProof,
    sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT || null,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  console.log(`Wrote v1833 session capture proof to ${outputPath}`);
  console.log(`Status: ${proof.status}`);
  console.log(`Completed session: ${proof.candidateCompletedSessionDate}`);
  console.log(`Capture sequence: ${proof.captureSequence}`);
  console.log(`Chain head: ${proof.chainHeadCaptureHash}`);
  console.log(`Capture created: ${proof.captureCreated}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
