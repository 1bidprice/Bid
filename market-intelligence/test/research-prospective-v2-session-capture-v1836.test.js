import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertV1836V2SessionCaptureReady,
  extractV2ChainHead,
  V1836_V2_SESSION_CAPTURE_CONTRACT,
} from '../scripts/run-prospective-holdout-v2-session-capture-v1836.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

test('v1836 extracts v2 first-capture chain head', () => {
  assert.deepEqual(extractV2ChainHead({
    contract: 'PROSPECTIVE_UNSEEN_HOLDOUT_V2_FIRST_CAPTURE_PROOF_V1',
    holdoutId: 'investor-control-us-equity-unseen-holdout-2026q3-v2',
    completedSessionDate: '2026-08-14',
    capture: { contentHash: A },
  }), {
    hash: A,
    sessionDate: '2026-08-14',
    sequence: 1,
    holdoutId: 'investor-control-us-equity-unseen-holdout-2026q3-v2',
  });
});

test('v1836 no-op cannot mutate v2 chain head', () => {
  const proof = {
    contract: V1836_V2_SESSION_CAPTURE_CONTRACT,
    status: 'NO_NEW_COMPLETED_SESSION',
    previousChainHeadCaptureHash: A,
    previousCaptureSequence: 1,
    captureCreated: false,
    capture: null,
    chainHeadCaptureHash: A,
    chainHeadSessionDate: '2026-08-14',
    captureSequence: 1,
    performancePeeked: false,
    outcomeFieldsIncluded: false,
    historicalBackfillAllowed: false,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
  assert.equal(assertV1836V2SessionCaptureReady(proof), true);
  assert.throws(() => assertV1836V2SessionCaptureReady({ ...proof, chainHeadCaptureHash: B }), /V1836_NOOP_CHANGED_CHAIN_HEAD/);
});

test('v1836 new capture requires exact prior hash link and one-step sequence', () => {
  const proof = {
    contract: V1836_V2_SESSION_CAPTURE_CONTRACT,
    status: 'NEW_V2_SESSION_CAPTURE_VERIFIED',
    previousChainHeadCaptureHash: A,
    previousCaptureSequence: 1,
    captureCreated: true,
    capture: { previousCaptureHash: A, contentHash: B },
    captureVerification: { verified: true },
    chainHeadCaptureHash: B,
    chainHeadSessionDate: '2026-08-17',
    captureSequence: 2,
    performancePeeked: false,
    outcomeFieldsIncluded: false,
    historicalBackfillAllowed: false,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
  assert.equal(assertV1836V2SessionCaptureReady(proof), true);
  assert.throws(() => assertV1836V2SessionCaptureReady({ ...proof, captureSequence: 3 }), /V1836_CAPTURE_SEQUENCE_INVALID/);
  assert.throws(() => assertV1836V2SessionCaptureReady({ ...proof, capture: { ...proof.capture, previousCaptureHash: 'c'.repeat(64) } }), /V1836_PREVIOUS_HASH_LINK_BROKEN/);
});
