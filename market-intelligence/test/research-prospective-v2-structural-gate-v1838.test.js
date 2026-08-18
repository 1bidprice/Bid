import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProspectiveHoldoutCaptureV2,
  buildProspectiveHoldoutProtocolV2,
  prospectiveTargetFeatureFingerprint,
} from '../src/forecast-prospective-holdout-protocol-v2.js';
import {
  assertV1838StructuralGateSafe,
  buildV1838StructuralEvaluationGate,
  V1838_STRUCTURAL_GATE_CONTRACT,
} from '../scripts/run-prospective-holdout-v2-structural-gate-v1838.js';

function isoAddDays(baseIso, days) {
  return new Date(Date.parse(baseIso) + days * 86_400_000).toISOString();
}

function captureForDate(featureAsOf, previousCaptureHash = null) {
  const protocol = buildProspectiveHoldoutProtocolV2();
  const slots = [];
  for (const instrument of protocol.universeFreeze.instruments) {
    for (const horizon of protocol.horizons) {
      const feature = {
        forecastId: `structural:${instrument.companyId}:${horizon.horizon}:${featureAsOf}`,
        companyId: instrument.companyId,
        symbol: instrument.symbol,
        horizon: horizon.horizon,
        tradingDays: horizon.tradingDays,
        featureAsOf,
        rawPatternProbabilityPositive: 0.51,
        regimeKey: 'RISK_ON|BULL_TREND|NORMAL_VOLATILITY|POSITIVE_MOMENTUM',
        historicalPatternPolicyVersion: 'fixture-pattern-v1',
        historicalMarketFactorPolicyVersion: 'fixture-factor-v1',
        historicalMarketFactorScore: 0.08,
      };
      const fingerprint = prospectiveTargetFeatureFingerprint(feature);
      for (const modelVariant of protocol.modelFreeze.modelVariants) {
        slots.push({
          ...feature,
          modelVariant,
          status: 'FORECAST_AVAILABLE',
          probabilityPositive: 0.53,
          withheldReason: null,
          targetFeatureFingerprint: fingerprint,
          modelSourceCommit: protocol.modelFreeze.sourceCommit,
          trainingSampleSize: 250,
          trainingPositiveCount: 130,
          trainingNegativeCount: 120,
        });
      }
    }
  }
  return buildProspectiveHoldoutCaptureV2({
    protocol,
    capturedAt: new Date(Date.parse(featureAsOf) + 3_600_000).toISOString(),
    sourceDataAsOf: featureAsOf,
    previousCaptureHash,
    slots,
  });
}

function maturationForCaptures(captures, { mature = true, flipOutcomes = false } = {}) {
  const outcomes = [];
  for (const capture of captures) {
    const targets = new Map();
    for (const slot of capture.slots) {
      const key = `${slot.companyId}|${slot.horizon}`;
      if (!targets.has(key)) targets.set(key, slot);
    }
    for (const slot of targets.values()) {
      const outcomeKnownAt = mature ? isoAddDays(slot.featureAsOf, slot.tradingDays) : null;
      outcomes.push({
        captureHash: capture.contentHash,
        holdoutId: capture.holdoutId,
        companyId: slot.companyId,
        symbol: slot.symbol,
        horizon: slot.horizon,
        tradingDays: slot.tradingDays,
        featureAsOf: slot.featureAsOf,
        sourceCaptureVerified: true,
        status: mature ? 'MATURED_OUTCOME_AVAILABLE' : 'PENDING_HORIZON_MATURATION',
        outcomeKnownAt,
        positiveOutcome: mature ? (flipOutcomes ? 0 : 1) : null,
        realizedReturnPct: mature ? (flipOutcomes ? -99 : 99) : null,
        benchmarkReturnPct: mature ? (flipOutcomes ? 88 : -88) : null,
        benchmarkRelativeReturnPct: mature ? (flipOutcomes ? -187 : 187) : null,
      });
    }
  }
  return {
    contract: 'PROSPECTIVE_HOLDOUT_V2_OUTCOME_MATURATION_V1',
    holdoutId: 'investor-control-us-equity-unseen-holdout-2026q3-v2',
    protocolContract: 'PROSPECTIVE_UNSEEN_HOLDOUT_PROTOCOL_V2',
    captureCount: captures.length,
    outcomes,
    performanceMetricsIncluded: false,
    performancePeeked: false,
    evaluationGateOpened: false,
  };
}

function captureSequence(count = 40, spacingDays = 5) {
  const captures = [];
  let previous = null;
  const first = '2026-08-14T13:30:00.000Z';
  for (let index = 0; index < count; index += 1) {
    const capture = captureForDate(isoAddDays(first, index * spacingDays), previous);
    captures.push(capture);
    previous = capture.contentHash;
  }
  return captures;
}

test('v1838 remains closed when no v2 outcome window has matured', () => {
  const captures = captureSequence(1);
  const artifact = buildV1838StructuralEvaluationGate({
    captures,
    maturationArtifact: maturationForCaptures(captures, { mature: false }),
    generatedAt: '2026-08-17T14:00:00.000Z',
    sourceCommit: 'test',
  });
  assert.equal(artifact.contract, V1838_STRUCTURAL_GATE_CONTRACT);
  assert.equal(artifact.performanceGateEligible, false);
  assert.equal(artifact.maturedCommonVariantTargetCount, 0);
  assert.equal(artifact.performancePeeked, false);
  assert.equal(artifact.outcomeSignsIncluded, false);
  assert.equal(artifact.outcomeReturnsIncluded, false);
  assert.equal(artifact.classCountsIncluded, false);
  assert.ok(artifact.blockers.includes('STRUCTURAL_GATE_NO_MATURED_COMMON_VARIANT_TARGETS'));
  assert.equal(assertV1838StructuralGateSafe(artifact), true);
});

test('v1838 structural result is exactly invariant to outcome signs and return magnitudes', () => {
  const captures = captureSequence(40, 5);
  const positiveArtifact = buildV1838StructuralEvaluationGate({
    captures,
    maturationArtifact: maturationForCaptures(captures, { mature: true, flipOutcomes: false }),
    generatedAt: '2027-03-01T14:00:00.000Z',
    sourceCommit: 'test',
  });
  const negativeArtifact = buildV1838StructuralEvaluationGate({
    captures,
    maturationArtifact: maturationForCaptures(captures, { mature: true, flipOutcomes: true }),
    generatedAt: '2027-03-01T14:00:00.000Z',
    sourceCommit: 'test',
  });
  assert.deepEqual(negativeArtifact, positiveArtifact);
  assert.equal(positiveArtifact.performancePeeked, false);
  assert.equal(positiveArtifact.performanceMetricsIncluded, false);
  assert.equal(positiveArtifact.outcomeSignsIncluded, false);
  assert.equal(positiveArtifact.outcomeReturnsIncluded, false);
});

test('v1838 opens only structural eligibility when a predeclared group meets sample, breadth, independence and chronology', () => {
  const captures = captureSequence(40, 5);
  const artifact = buildV1838StructuralEvaluationGate({
    captures,
    maturationArtifact: maturationForCaptures(captures, { mature: true }),
    generatedAt: '2027-03-01T14:00:00.000Z',
    sourceCommit: 'test',
  });
  assert.equal(artifact.performanceGateEligible, true);
  assert.ok(artifact.structurallyReadyGroupCount >= 1);
  const week1 = artifact.groups.find((group) => group.horizon === 'week1');
  assert.ok(week1);
  assert.equal(week1.ready, true);
  assert.equal(week1.sampleSize, 640);
  assert.equal(week1.distinctForecastDates, 40);
  assert.equal(week1.distinctInstruments, 16);
  assert.equal(week1.maximumSingleForecastDateSharePct, 2.5);
  assert.equal(week1.maximumSingleInstrumentSharePct, 6.25);
  assert.equal(week1.effectiveInstrumentCount, 16);
  assert.ok(week1.effectiveNonOverlappingWindowCount >= 12);
  assert.equal(week1.chronologicalBlocks.length, 3);
  assert.ok(week1.minimumChronologicalBlockSample >= 20);
  assert.equal(artifact.evaluationGateOpened, false);
  assert.equal(artifact.nextAllowedAction, 'MAY_RUN_SEPARATE_PREDECLARED_POST_GATE_PERFORMANCE_EVALUATOR_WITHOUT_MODEL_PROMOTION_AUTHORITY');
});

test('v1838 does not count a target unless all four frozen variants were actually forecast-available', () => {
  const captures = captureSequence(40, 5);
  const changed = captures.map((capture, captureIndex) => {
    if (captureIndex !== 0) return capture;
    const protocol = buildProspectiveHoldoutProtocolV2();
    const slots = capture.slots.map((slot, index) => index === 0 ? {
      ...slot,
      status: 'WITHHELD',
      probabilityPositive: null,
      withheldReason: 'TEST_WITHHELD',
    } : slot);
    return buildProspectiveHoldoutCaptureV2({
      protocol,
      capturedAt: capture.capturedAt,
      sourceDataAsOf: capture.sourceDataAsOf,
      previousCaptureHash: capture.previousCaptureHash,
      slots,
    });
  });
  const artifact = buildV1838StructuralEvaluationGate({
    captures: changed,
    maturationArtifact: maturationForCaptures(changed, { mature: true }),
    generatedAt: '2027-03-01T14:00:00.000Z',
  });
  assert.equal(artifact.maturedCommonVariantTargetCount, 1279);
  const week1 = artifact.groups.find((group) => group.horizon === 'week1');
  assert.equal(week1.sampleSize, 639);
});
