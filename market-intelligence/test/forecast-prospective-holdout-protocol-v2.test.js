import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProspectiveHoldoutCaptureV2,
  buildProspectiveHoldoutProtocolV2,
  prospectiveTargetFeatureFingerprint,
  protocolV2Fingerprint,
  verifyProspectiveHoldoutCaptureV2,
  PROSPECTIVE_HOLDOUT_PROTOCOL_V2_CONTRACT,
  PROSPECTIVE_HOLDOUT_V2_CAPTURE_CONTRACT,
} from '../src/forecast-prospective-holdout-protocol-v2.js';

function canonicalSlots(protocol = buildProspectiveHoldoutProtocolV2()) {
  const slots = [];
  for (const instrument of protocol.universeFreeze.instruments) {
    for (const horizon of protocol.horizons) {
      const target = {
        forecastId: `v2:${instrument.companyId}:${horizon.horizon}:2026-08-14`,
        companyId: instrument.companyId,
        symbol: instrument.symbol,
        horizon: horizon.horizon,
        tradingDays: horizon.tradingDays,
        featureAsOf: '2026-08-14T13:30:00.000Z',
        rawPatternProbabilityPositive: 0.51,
        regimeKey: 'trend:UP|volatility:NORMAL',
        historicalPatternPolicyVersion: 'fixture-pattern-v1',
        historicalMarketFactorPolicyVersion: 'fixture-factor-v1',
        historicalMarketFactorScore: 0.07,
      };
      const targetFeatureFingerprint = prospectiveTargetFeatureFingerprint(target);
      for (const modelVariant of protocol.modelFreeze.modelVariants) {
        slots.push({
          ...target,
          modelVariant,
          status: 'FORECAST_AVAILABLE',
          probabilityPositive: 0.53,
          withheldReason: null,
          targetFeatureFingerprint,
          modelSourceCommit: protocol.modelFreeze.sourceCommit,
          trainingSampleSize: 250,
          trainingPositiveCount: 130,
          trainingNegativeCount: 120,
        });
      }
    }
  }
  return slots;
}

function canonicalCapture() {
  const protocol = buildProspectiveHoldoutProtocolV2();
  return buildProspectiveHoldoutCaptureV2({
    protocol,
    capturedAt: '2026-08-17T12:00:00.000Z',
    sourceDataAsOf: '2026-08-14T13:30:00.000Z',
    slots: canonicalSlots(protocol),
  });
}

test('v2 protocol explicitly retires v1 before any outcome or performance peek', () => {
  const protocol = buildProspectiveHoldoutProtocolV2();
  assert.equal(protocol.contract, PROSPECTIVE_HOLDOUT_PROTOCOL_V2_CONTRACT);
  assert.equal(protocol.supersession.maturedOutcomeCountAtRetirement, 0);
  assert.equal(protocol.supersession.performancePeekedAtRetirement, false);
  assert.equal(protocol.supersession.evaluationGateOpenedAtRetirement, false);
  assert.equal(protocol.supersession.v1MayContributeToV2PerformanceEvaluation, false);
  assert.equal(protocol.modelFreeze.modelSpecificationChangedFromV1, false);
  assert.equal(protocol.modelFreeze.onlyCaptureAuditSchemaChangedFromV1, true);
  assert.equal(protocol.evaluationProtocol.rawPatternBaselineMustBeCapturedBeforeOutcome, true);
  assert.equal(protocol.evaluationProtocol.regimeKeyMustBeCapturedBeforeOutcome, true);
  assert.match(protocolV2Fingerprint(protocol), /^[a-f0-9]{64}$/);
});

test('v2 canonical 128-slot capture verifies with complete immutable evaluation lineage', () => {
  const capture = canonicalCapture();
  assert.equal(capture.captureContract, PROSPECTIVE_HOLDOUT_V2_CAPTURE_CONTRACT);
  assert.equal(capture.slots.length, 128);
  const verification = verifyProspectiveHoldoutCaptureV2(capture);
  assert.equal(verification.status, 'PROSPECTIVE_V2_CAPTURE_VERIFIED');
  assert.equal(verification.verified, true);
  assert.equal(verification.targetFeatureFingerprintCount, 32);
  assert.deepEqual(verification.blockers, []);
});

test('v2 rejects a missing raw-pattern baseline even when the final model probability is valid', () => {
  const capture = canonicalCapture();
  const slots = capture.slots.map((slot, index) => index === 0
    ? { ...slot, rawPatternProbabilityPositive: null }
    : slot);
  const tampered = buildProspectiveHoldoutCaptureV2({
    capturedAt: capture.capturedAt,
    sourceDataAsOf: capture.sourceDataAsOf,
    slots,
  });
  const verification = verifyProspectiveHoldoutCaptureV2(tampered);
  assert.equal(verification.verified, false);
  assert.ok(verification.blockers.includes('V2_CAPTURE_RAW_PATTERN_BASELINE_MISSING'));
});

test('v2 rejects missing regime lineage and cross-variant target-feature divergence', () => {
  const capture = canonicalCapture();
  const first = capture.slots[0];
  const slots = capture.slots.map((slot, index) => {
    if (index === 0) {
      const changed = { ...slot, regimeKey: '' };
      return { ...changed, targetFeatureFingerprint: prospectiveTargetFeatureFingerprint(changed) };
    }
    if (index === 1) {
      const changed = { ...slot, historicalMarketFactorScore: slot.historicalMarketFactorScore + 0.01 };
      return { ...changed, targetFeatureFingerprint: prospectiveTargetFeatureFingerprint(changed) };
    }
    return slot;
  });
  assert.equal(first.companyId, slots[1].companyId);
  assert.equal(first.horizon, slots[1].horizon);
  const tampered = buildProspectiveHoldoutCaptureV2({
    capturedAt: capture.capturedAt,
    sourceDataAsOf: capture.sourceDataAsOf,
    slots,
  });
  const verification = verifyProspectiveHoldoutCaptureV2(tampered);
  assert.equal(verification.verified, false);
  assert.ok(verification.blockers.includes('V2_CAPTURE_REGIME_KEY_MISSING'));
  assert.ok(verification.blockers.includes('V2_CAPTURE_VARIANTS_DO_NOT_SHARE_IDENTICAL_TARGET_FEATURES'));
});

test('v2 rejects post-capture content mutation through canonical capture hash', () => {
  const capture = canonicalCapture();
  const tampered = {
    ...capture,
    slots: capture.slots.map((slot, index) => index === 0 ? { ...slot, probabilityPositive: 0.99 } : slot),
  };
  const verification = verifyProspectiveHoldoutCaptureV2(tampered);
  assert.equal(verification.verified, false);
  assert.ok(verification.blockers.includes('V2_CAPTURE_CONTENT_HASH_INVALID'));
});
