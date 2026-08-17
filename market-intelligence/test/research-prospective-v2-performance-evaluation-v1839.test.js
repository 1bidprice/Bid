import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProspectiveHoldoutCaptureV2,
  buildProspectiveHoldoutProtocolV2,
  prospectiveTargetFeatureFingerprint,
} from '../src/forecast-prospective-holdout-protocol-v2.js';
import { buildV1838StructuralEvaluationGate } from '../scripts/run-prospective-holdout-v2-structural-gate-v1838.js';
import {
  assertV1839PerformanceEvaluationSafe,
  buildV1839PostGatePerformanceEvaluation,
  V1839_PERFORMANCE_EVALUATION_CONTRACT,
} from '../scripts/run-prospective-holdout-v2-performance-evaluation-v1839.js';

function addDays(iso, days) { return new Date(Date.parse(iso) + days * 86_400_000).toISOString(); }

function targetOutcome(companyIndex, dateIndex) { return (companyIndex + dateIndex) % 2; }

function strongCapture(featureAsOf, dateIndex, previousCaptureHash = null) {
  const protocol = buildProspectiveHoldoutProtocolV2();
  const slots = [];
  protocol.universeFreeze.instruments.forEach((instrument, companyIndex) => {
    for (const horizon of protocol.horizons) {
      const outcome = targetOutcome(companyIndex, dateIndex);
      const feature = {
        forecastId: `v1839:${instrument.companyId}:${horizon.horizon}:${featureAsOf}`,
        companyId: instrument.companyId,
        symbol: instrument.symbol,
        horizon: horizon.horizon,
        tradingDays: horizon.tradingDays,
        featureAsOf,
        rawPatternProbabilityPositive: 0.3,
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
          probabilityPositive: outcome ? 0.95 : 0.05,
          withheldReason: null,
          targetFeatureFingerprint: fingerprint,
          modelSourceCommit: protocol.modelFreeze.sourceCommit,
          trainingSampleSize: 250,
          trainingPositiveCount: 130,
          trainingNegativeCount: 120,
        });
      }
    }
  });
  return buildProspectiveHoldoutCaptureV2({
    protocol,
    capturedAt: new Date(Date.parse(featureAsOf) + 3_600_000).toISOString(),
    sourceDataAsOf: featureAsOf,
    previousCaptureHash,
    slots,
  });
}

function strongFixture(count = 40, spacingDays = 5) {
  const captures = [];
  const outcomes = [];
  let previous = null;
  const first = '2026-08-14T13:30:00.000Z';
  for (let dateIndex = 0; dateIndex < count; dateIndex += 1) {
    const featureAsOf = addDays(first, dateIndex * spacingDays);
    const capture = strongCapture(featureAsOf, dateIndex, previous);
    captures.push(capture);
    previous = capture.contentHash;
    const seen = new Set();
    for (const slot of capture.slots) {
      const key = `${slot.companyId}|${slot.horizon}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const companyIndex = buildProspectiveHoldoutProtocolV2().universeFreeze.instruments.findIndex((item) => item.companyId === slot.companyId);
      const positiveOutcome = targetOutcome(companyIndex, dateIndex);
      outcomes.push({
        captureHash: capture.contentHash,
        holdoutId: capture.holdoutId,
        companyId: slot.companyId,
        symbol: slot.symbol,
        horizon: slot.horizon,
        tradingDays: slot.tradingDays,
        featureAsOf: slot.featureAsOf,
        sourceCaptureVerified: true,
        status: 'MATURED_OUTCOME_AVAILABLE',
        outcomeKnownAt: addDays(slot.featureAsOf, slot.tradingDays),
        positiveOutcome,
        realizedReturnPct: positiveOutcome ? 5 : -5,
        benchmarkReturnPct: 0,
        benchmarkRelativeReturnPct: positiveOutcome ? 5 : -5,
      });
    }
  }
  const maturationArtifact = {
    contract: 'PROSPECTIVE_HOLDOUT_V2_OUTCOME_MATURATION_V1',
    holdoutId: 'investor-control-us-equity-unseen-holdout-2026q3-v2',
    protocolContract: 'PROSPECTIVE_UNSEEN_HOLDOUT_PROTOCOL_V2',
    outcomes,
    performanceMetricsIncluded: false,
    performancePeeked: false,
    evaluationGateOpened: false,
  };
  const structuralGate = buildV1838StructuralEvaluationGate({
    captures,
    maturationArtifact,
    generatedAt: '2027-03-01T14:00:00.000Z',
    sourceCommit: 'fixture',
  });
  return { captures, maturationArtifact, structuralGate };
}

test('v1839 remains fully locked and metric-free before v1838 structural eligibility', () => {
  const structuralGate = buildV1838StructuralEvaluationGate({
    captures: [],
    maturationArtifact: {
      contract: 'PROSPECTIVE_HOLDOUT_V2_OUTCOME_MATURATION_V1',
      holdoutId: 'investor-control-us-equity-unseen-holdout-2026q3-v2',
      protocolContract: 'PROSPECTIVE_UNSEEN_HOLDOUT_PROTOCOL_V2',
      outcomes: [],
      performanceMetricsIncluded: false,
      performancePeeked: false,
      evaluationGateOpened: false,
    },
    generatedAt: '2026-08-17T14:00:00.000Z',
  });
  const artifact = buildV1839PostGatePerformanceEvaluation({
    captures: [{ deliberately: 'invalid and must never be inspected while locked' }],
    maturationArtifact: { outcomes: [{ positiveOutcome: 1, realizedReturnPct: 999 }] },
    structuralGate,
    generatedAt: '2026-08-17T14:01:00.000Z',
  });
  assert.equal(artifact.contract, V1839_PERFORMANCE_EVALUATION_CONTRACT);
  assert.equal(artifact.status, 'PERFORMANCE_EVALUATION_LOCKED');
  assert.equal(artifact.structuralGateEligible, false);
  assert.equal(artifact.evaluationGateOpened, false);
  assert.equal(artifact.performanceMetricsIncluded, false);
  assert.equal(artifact.performancePeeked, false);
  assert.equal(artifact.evaluationCount, 0);
  assert.deepEqual(artifact.evaluations, []);
  assert.equal(assertV1839PerformanceEvaluationSafe(artifact), true);
});

test('v1839 evaluates all four frozen variants symmetrically only after structural gate eligibility', () => {
  const { captures, maturationArtifact, structuralGate } = strongFixture();
  assert.equal(structuralGate.performanceGateEligible, true);
  const artifact = buildV1839PostGatePerformanceEvaluation({
    captures,
    maturationArtifact,
    structuralGate,
    generatedAt: '2027-03-01T14:01:00.000Z',
    sourceCommit: 'fixture',
  });
  assert.equal(artifact.evaluationGateOpened, true);
  assert.equal(artifact.performanceMetricsIncluded, true);
  assert.equal(artifact.performancePeeked, true);
  assert.equal(artifact.evaluationCount, 4);
  assert.equal(artifact.predictiveStandardSignalCount, 4);
  assert.equal(artifact.anyPredictiveStandardSignalDetected, true);
  assert.deepEqual(new Set(artifact.evaluations.map((item) => item.modelVariant)), new Set(buildProspectiveHoldoutProtocolV2().modelFreeze.modelVariants));
  assert.ok(artifact.evaluations.every((item) => item.horizon === 'week1'));
  assert.ok(artifact.evaluations.every((item) => item.sampleSize === 640));
  assert.ok(artifact.evaluations.every((item) => item.positiveCount === 320 && item.negativeCount === 320));
  assert.ok(artifact.evaluations.every((item) => item.predictiveStandardMet === true));
  assert.ok(artifact.evaluations.every((item) => item.modelMetrics.skillVsBaseRatePct >= 5));
  assert.ok(artifact.evaluations.every((item) => item.modelMetrics.expectedCalibrationError <= 0.08));
  assert.ok(artifact.evaluations.every((item) => item.improvementsVsRawPattern.brierImprovementPct >= 3));
  assert.ok(artifact.evaluations.every((item) => item.chronologicalBlocks.every((block) => block.skillVsBaseRatePct >= 0)));
});

test('v1839 never converts a positive exploratory signal into winner selection or production authority', () => {
  const { captures, maturationArtifact, structuralGate } = strongFixture();
  const artifact = buildV1839PostGatePerformanceEvaluation({ captures, maturationArtifact, structuralGate, generatedAt: '2027-03-01T14:01:00.000Z' });
  assert.equal(artifact.status, 'PREDICTIVE_SIGNAL_DETECTED_CONFIRMATION_REQUIRED');
  assert.equal(artifact.sameHoldoutVariantSelectionAllowed, false);
  assert.equal(artifact.postHocWinnerSelectionAllowed, false);
  assert.equal(artifact.confirmatoryHoldoutRequiredBeforeAnyVariantSelection, true);
  assert.equal(artifact.confirmatoryHoldoutRequiredBeforeAnyProductionPromotion, true);
  assert.equal(artifact.modelRankingPublished, false);
  assert.equal(artifact.automaticModelPromotionEnabled, false);
  assert.equal(artifact.probabilityCalibrationEnabled, false);
  assert.equal(artifact.decisionIntegrationEnabled, false);
  assert.equal(artifact.forecastMayInfluenceFinalAction, false);
  assert.equal(artifact.finalActionEligible, false);
  assert.equal(artifact.brokerExecutionEligible, false);
  assert.equal(artifact.decisionImpact, 'NONE');
  assert.equal(assertV1839PerformanceEvaluationSafe(artifact), true);
});
