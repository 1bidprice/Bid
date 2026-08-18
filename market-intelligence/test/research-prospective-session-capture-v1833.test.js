import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertV1833SessionCaptureProof,
  extractProspectiveChainHead,
  V1833_SESSION_CAPTURE_CONTRACT,
} from '../scripts/run-prospective-holdout-session-capture-v1833.js';

const FIRST_HASH = 'a'.repeat(64);
const SECOND_HASH = 'b'.repeat(64);

test('v1833 extracts the chain head from the verified v1832 first capture', () => {
  const state = extractProspectiveChainHead({
    contract: 'PROSPECTIVE_UNSEEN_HOLDOUT_FIRST_CAPTURE_PROOF_V1',
    holdoutId: 'investor-control-us-equity-unseen-holdout-2026q3-v1',
    operationalGate: { commonBenchmarkCompletedSessionDate: '2026-08-14' },
    capture: { contentHash: FIRST_HASH },
  });
  assert.deepEqual(state, {
    hash: FIRST_HASH,
    sessionDate: '2026-08-14',
    sequence: 1,
    holdoutId: 'investor-control-us-equity-unseen-holdout-2026q3-v1',
  });
});

test('v1833 no-new-session proof cannot move the capture chain head', () => {
  const proof = {
    contract: V1833_SESSION_CAPTURE_CONTRACT,
    status: 'NO_NEW_COMPLETED_SESSION',
    previousChainHeadCaptureHash: FIRST_HASH,
    previousCaptureSequence: 1,
    captureCreated: false,
    chainHeadCaptureHash: FIRST_HASH,
    chainHeadSessionDate: '2026-08-14',
    captureSequence: 1,
    historicalBackfillAllowed: false,
    performancePeeked: false,
    outcomeFieldsIncluded: false,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
  assert.equal(assertV1833SessionCaptureProof(proof), true);
  assert.throws(() => assertV1833SessionCaptureProof({ ...proof, chainHeadCaptureHash: SECOND_HASH }), /V1833_NOOP_CHANGED_CHAIN_HEAD/);
});

test('v1833 new-session proof requires an exact previous-hash link and monotonic sequence', () => {
  const proof = {
    contract: V1833_SESSION_CAPTURE_CONTRACT,
    status: 'NEW_SESSION_CAPTURE_VERIFIED',
    previousChainHeadCaptureHash: FIRST_HASH,
    previousCaptureSequence: 1,
    captureCreated: true,
    capture: { previousCaptureHash: FIRST_HASH, contentHash: SECOND_HASH },
    captureVerification: { verified: true },
    chainHeadCaptureHash: SECOND_HASH,
    chainHeadSessionDate: '2026-08-17',
    captureSequence: 2,
    historicalBackfillAllowed: false,
    performancePeeked: false,
    outcomeFieldsIncluded: false,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
  assert.equal(assertV1833SessionCaptureProof(proof), true);
  assert.throws(() => assertV1833SessionCaptureProof({ ...proof, captureSequence: 3 }), /V1833_CAPTURE_SEQUENCE_INVALID/);
  assert.throws(() => assertV1833SessionCaptureProof({ ...proof, capture: { ...proof.capture, previousCaptureHash: 'c'.repeat(64) } }), /V1833_PREVIOUS_HASH_LINK_BROKEN/);
});
