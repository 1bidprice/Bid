import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROSPECTIVE_HOLDOUT_ID,
  PROSPECTIVE_HOLDOUT_MODEL_FREEZE_SOURCE_COMMIT,
  PROSPECTIVE_HOLDOUT_MODEL_VARIANTS,
  PROSPECTIVE_HOLDOUT_PROTOCOL_CONTRACT,
  buildProspectiveHoldoutCapture,
  buildProspectiveHoldoutProtocol,
  protocolFingerprint,
  verifyProspectiveHoldoutCapture,
} from '../src/forecast-prospective-holdout-protocol.js';

function canonicalSlots(protocol) {
  const slots = [];
  for (const instrument of protocol.universeFreeze.instruments) {
    for (const horizon of protocol.horizons) {
      for (const modelVariant of protocol.modelFreeze.modelVariants) {
        slots.push({
          companyId: instrument.companyId,
          symbol: instrument.symbol,
          horizon: horizon.horizon,
          tradingDays: horizon.tradingDays,
          modelVariant,
          status: 'WITHHELD',
          probabilityPositive: null,
          withheldReason: 'TEST_ONLY_NO_LIVE_FORECAST_GENERATOR',
          featureAsOf: '2026-08-17T13:00:00.000Z',
        });
      }
    }
  }
  return slots;
}

test('prospective holdout protocol is fully preregistered against the v1829 model freeze', () => {
  const protocol = buildProspectiveHoldoutProtocol();
  assert.equal(protocol.contract, PROSPECTIVE_HOLDOUT_PROTOCOL_CONTRACT);
  assert.equal(protocol.holdoutId, PROSPECTIVE_HOLDOUT_ID);
  assert.equal(protocol.status, 'PREREGISTERED_NOT_YET_STARTED');
  assert.equal(protocol.historicalBackfillAllowed, false);
  assert.equal(protocol.modelFreeze.sourceCommit, PROSPECTIVE_HOLDOUT_MODEL_FREEZE_SOURCE_COMMIT);
  assert.deepEqual(protocol.modelFreeze.modelVariants, [...PROSPECTIVE_HOLDOUT_MODEL_VARIANTS]);
  assert.equal(protocol.modelFreeze.modelVariants.length, 4);
  assert.equal(protocol.modelFreeze.specificationChangeAllowedInsideHoldout, false);
  assert.equal(protocol.modelFreeze.variantRemovalAllowedInsideHoldout, false);
  assert.equal(protocol.modelFreeze.postHocWinnerSelectionAllowed, false);
  assert.equal(protocol.universeFreeze.marketDomain, 'US_EQUITY');
  assert.equal(protocol.universeFreeze.benchmarkFamily, 'SPY');
  assert.equal(protocol.universeFreeze.instrumentCount, 16);
  assert.equal(protocol.universeFreeze.currentNewsDependentSelection, false);
  assert.equal(protocol.horizons.length, 2);
  assert.equal(protocol.captureProtocol.expectedSlotCountPerCapture, 128);
  assert.equal(protocol.captureProtocol.outcomeFieldsAllowedAtCapture, false);
  assert.equal(protocol.captureProtocol.performanceMetricsAllowedAtCapture, false);
  assert.equal(protocol.evaluationProtocol.minimumEvaluationSamplePerGroup, 200);
  assert.equal(protocol.evaluationProtocol.minimumClassCountPerGroup, 40);
  assert.equal(protocol.evaluationProtocol.minimumSkillPctVsBaseRate, 5);
  assert.equal(protocol.evaluationProtocol.maximumExpectedCalibrationError, 0.08);
  assert.equal(protocol.evaluationProtocol.minimumBrierImprovementPctVsRawPattern, 3);
  assert.equal(protocol.evaluationProtocol.minimumDistinctForecastDates, 40);
  assert.equal(protocol.evaluationProtocol.minimumDistinctInstruments, 10);
  assert.equal(protocol.evaluationProtocol.chronologicalBlockCount, 3);
  assert.equal(protocol.evaluationProtocol.thresholdWeakeningAllowed, false);
  assert.equal(protocol.publication.finalActionWriteAllowed, false);
  assert.equal(protocol.publication.brokerWriteAllowed, false);
  assert.equal(protocol.prospectiveResearchOnly, true);
  assert.equal(protocol.automaticModelPromotionEnabled, false);
  assert.equal(protocol.decisionIntegrationEnabled, false);
  assert.equal(protocol.forecastMayInfluenceFinalAction, false);
  assert.equal(protocol.brokerExecutionEligible, false);
  assert.equal(protocol.decisionImpact, 'NONE');
  assert.match(protocolFingerprint(protocol), /^[a-f0-9]{64}$/);
});

test('complete 128-slot prospective capture verifies with immutable hash', () => {
  const protocol = buildProspectiveHoldoutProtocol();
  const capture = buildProspectiveHoldoutCapture({
    protocol,
    capturedAt: '2026-08-17T13:05:00.000Z',
    sourceDataAsOf: '2026-08-17T13:00:00.000Z',
    slots: canonicalSlots(protocol),
  });
  const verification = verifyProspectiveHoldoutCapture(capture, protocol);
  assert.equal(capture.slots.length, 128);
  assert.match(capture.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(verification.status, 'PROSPECTIVE_CAPTURE_VERIFIED');
  assert.equal(verification.verified, true);
  assert.deepEqual(verification.blockers, []);
  assert.equal(verification.expectedSlotCount, 128);
  assert.equal(verification.actualSlotCount, 128);
});

test('capture hash fails closed after post-capture probability tampering', () => {
  const protocol = buildProspectiveHoldoutProtocol();
  const capture = buildProspectiveHoldoutCapture({
    protocol,
    capturedAt: '2026-08-17T13:05:00.000Z',
    sourceDataAsOf: '2026-08-17T13:00:00.000Z',
    slots: canonicalSlots(protocol),
  });
  capture.slots[0] = {
    ...capture.slots[0],
    status: 'FORECAST_AVAILABLE',
    probabilityPositive: 0.61,
    withheldReason: null,
  };
  const verification = verifyProspectiveHoldoutCapture(capture, protocol);
  assert.equal(verification.verified, false);
  assert.ok(verification.blockers.includes('PROSPECTIVE_CAPTURE_CONTENT_HASH_INVALID'));
});

test('capture rejects outcome or performance fields before maturation', () => {
  const protocol = buildProspectiveHoldoutProtocol();
  const slots = canonicalSlots(protocol);
  slots[0].positiveOutcome = 1;
  slots[1].brierScore = 0.2;
  const capture = buildProspectiveHoldoutCapture({
    protocol,
    capturedAt: '2026-08-17T13:05:00.000Z',
    sourceDataAsOf: '2026-08-17T13:00:00.000Z',
    slots,
  });
  const verification = verifyProspectiveHoldoutCapture(capture, protocol);
  assert.equal(verification.verified, false);
  assert.ok(verification.blockers.includes('PROSPECTIVE_CAPTURE_CONTAINS_OUTCOME_OR_PERFORMANCE_FIELDS'));
  assert.equal(verification.forbiddenOutcomePathCount, 2);
});

test('capture rejects selective omission of a model/instrument/horizon tuple', () => {
  const protocol = buildProspectiveHoldoutProtocol();
  const slots = canonicalSlots(protocol).slice(1);
  const capture = buildProspectiveHoldoutCapture({
    protocol,
    capturedAt: '2026-08-17T13:05:00.000Z',
    sourceDataAsOf: '2026-08-17T13:00:00.000Z',
    slots,
  });
  const verification = verifyProspectiveHoldoutCapture(capture, protocol);
  assert.equal(verification.verified, false);
  assert.ok(verification.blockers.includes('PROSPECTIVE_CAPTURE_SLOT_MATRIX_INCOMPLETE'));
});

test('capture rejects duplicate slots and unknown model variants', () => {
  const protocol = buildProspectiveHoldoutProtocol();
  const slots = canonicalSlots(protocol);
  slots[1] = { ...slots[0] };
  slots[2] = { ...slots[2], modelVariant: 'POST_HOC_MAGIC_MODEL' };
  const capture = buildProspectiveHoldoutCapture({
    protocol,
    capturedAt: '2026-08-17T13:05:00.000Z',
    sourceDataAsOf: '2026-08-17T13:00:00.000Z',
    slots,
  });
  const verification = verifyProspectiveHoldoutCapture(capture, protocol);
  assert.equal(verification.verified, false);
  assert.ok(verification.blockers.includes('PROSPECTIVE_CAPTURE_DUPLICATE_SLOT'));
  assert.ok(verification.blockers.includes('PROSPECTIVE_CAPTURE_UNKNOWN_SLOT'));
  assert.ok(verification.blockers.includes('PROSPECTIVE_CAPTURE_SLOT_MATRIX_INCOMPLETE'));
});

test('capture rejects source data or feature data from after capture time', () => {
  const protocol = buildProspectiveHoldoutProtocol();
  const slots = canonicalSlots(protocol);
  slots[0].featureAsOf = '2026-08-17T13:06:00.000Z';
  const capture = buildProspectiveHoldoutCapture({
    protocol,
    capturedAt: '2026-08-17T13:05:00.000Z',
    sourceDataAsOf: '2026-08-17T13:06:00.000Z',
    slots,
  });
  const verification = verifyProspectiveHoldoutCapture(capture, protocol);
  assert.equal(verification.verified, false);
  assert.ok(verification.blockers.includes('PROSPECTIVE_CAPTURE_SOURCE_DATA_FROM_FUTURE'));
  assert.ok(verification.blockers.includes('PROSPECTIVE_CAPTURE_FEATURE_ASOF_INVALID'));
});

test('capture rejects any final-action or broker authority', () => {
  const protocol = buildProspectiveHoldoutProtocol();
  const capture = buildProspectiveHoldoutCapture({
    protocol,
    capturedAt: '2026-08-17T13:05:00.000Z',
    sourceDataAsOf: '2026-08-17T13:00:00.000Z',
    slots: canonicalSlots(protocol),
  });
  capture.finalActionEligible = true;
  capture.brokerExecutionEligible = true;
  const verification = verifyProspectiveHoldoutCapture(capture, protocol);
  assert.equal(verification.verified, false);
  assert.ok(verification.blockers.includes('PROSPECTIVE_CAPTURE_CONTENT_HASH_INVALID'));
  assert.ok(verification.blockers.includes('PROSPECTIVE_CAPTURE_AUTHORITY_BOUNDARY_BROKEN'));
});
