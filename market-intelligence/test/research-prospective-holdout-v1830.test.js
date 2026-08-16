import test from 'node:test';
import assert from 'node:assert/strict';
import {
  V1830_PROSPECTIVE_HOLDOUT_PREREGISTRATION_PROOF_CONTRACT,
  assertV1830ProspectiveHoldoutPreregistrationReady,
  buildV1830ProspectiveHoldoutPreregistration,
} from '../scripts/run-prospective-holdout-preregistration-v1830.js';
import { buildProspectiveHoldoutProtocol } from '../src/forecast-prospective-holdout-protocol.js';

test('v1830 preregistration verifies without starting or backfilling the holdout', () => {
  const proof = buildV1830ProspectiveHoldoutPreregistration({ sourceCommit: 'protocol-test-sha' });
  assert.equal(proof.contract, V1830_PROSPECTIVE_HOLDOUT_PREREGISTRATION_PROOF_CONTRACT);
  assert.equal(proof.status, 'PROSPECTIVE_HOLDOUT_PREREGISTRATION_VERIFIED');
  assert.equal(proof.verified, true);
  assert.equal(proof.expectedSlotCountPerCapture, 128);
  assert.match(proof.protocolFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(proof.holdoutStarted, false);
  assert.equal(proof.firstCaptureCreated, false);
  assert.equal(proof.historicalBackfillAllowed, false);
  assert.equal(proof.prospectiveResearchOnly, true);
  assert.equal(proof.automaticModelPromotionEnabled, false);
  assert.equal(proof.decisionIntegrationEnabled, false);
  assert.equal(proof.forecastMayInfluenceFinalAction, false);
  assert.equal(proof.brokerExecutionEligible, false);
  assert.equal(proof.decisionImpact, 'NONE');
  assert.equal(assertV1830ProspectiveHoldoutPreregistrationReady(proof), true);
});

test('v1830 preregistration fails if scientific thresholds are weakened', () => {
  const protocol = buildProspectiveHoldoutProtocol();
  protocol.evaluationProtocol.minimumSkillPctVsBaseRate = 0;
  protocol.evaluationProtocol.minimumEvaluationSamplePerGroup = 20;
  const proof = buildV1830ProspectiveHoldoutPreregistration({ protocol });
  assert.equal(proof.verified, false);
  assert.ok(proof.blockers.includes('PROSPECTIVE_HOLDOUT_EVALUATION_STANDARD_CHANGED'));
  assert.throws(() => assertV1830ProspectiveHoldoutPreregistrationReady(proof), /preregistration blocked/);
});

test('v1830 preregistration fails if post-hoc selection or early stopping is enabled', () => {
  const protocol = buildProspectiveHoldoutProtocol();
  protocol.modelFreeze.postHocWinnerSelectionAllowed = true;
  protocol.evaluationProtocol.earlyStoppingForPositivePerformanceAllowed = true;
  const proof = buildV1830ProspectiveHoldoutPreregistration({ protocol });
  assert.equal(proof.verified, false);
  assert.ok(proof.blockers.includes('PROSPECTIVE_HOLDOUT_ANTI_P_HACKING_GUARD_CHANGED'));
});

test('v1830 preregistration fails if forecast authority is enabled', () => {
  const protocol = buildProspectiveHoldoutProtocol();
  protocol.finalActionEligible = true;
  const proof = buildV1830ProspectiveHoldoutPreregistration({ protocol });
  assert.equal(proof.verified, false);
  assert.ok(proof.blockers.includes('PROSPECTIVE_HOLDOUT_AUTHORITY_BOUNDARY_CHANGED'));
});
