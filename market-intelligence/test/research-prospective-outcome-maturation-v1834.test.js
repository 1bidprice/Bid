import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProspectiveHoldoutCapture,
  buildProspectiveHoldoutProtocol,
} from '../src/forecast-prospective-holdout-protocol.js';
import {
  assertV1834OutcomeMaturationReady,
  matureCaptureOutcomes,
  runV1834OutcomeMaturation,
  V1834_OUTCOME_MATURATION_CONTRACT,
} from '../scripts/run-prospective-holdout-outcome-maturation-v1834.js';

const START_SECONDS = Date.parse('2026-06-01T20:00:00.000Z') / 1000;
const ANCHOR_INDEX = 50;
const ANCHOR_ISO = new Date((START_SECONDS + ANCHOR_INDEX * 86_400) * 1000).toISOString();

function sessionSeries(symbol, sessionsAfterAnchor, dailyGrowth) {
  const candles = [];
  const count = ANCHOR_INDEX + sessionsAfterAnchor + 1;
  for (let index = 0; index < count; index += 1) {
    candles.push({
      timestamp: START_SECONDS + index * 86_400,
      close: 100 * ((1 + dailyGrowth) ** index),
      volume: 1_000_000 + index * 100,
    });
  }
  return { symbol, providerSymbol: symbol, usable: true, candles };
}

function fullCapture() {
  const protocol = buildProspectiveHoldoutProtocol();
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
          status: 'FORECAST_AVAILABLE',
          probabilityPositive: 0.55,
          withheldReason: null,
          featureAsOf: ANCHOR_ISO,
          modelSourceCommit: protocol.modelFreeze.sourceCommit,
          trainingSampleSize: 120,
          trainingPositiveCount: 65,
          trainingNegativeCount: 55,
        });
      }
    }
  }
  return buildProspectiveHoldoutCapture({
    protocol,
    capturedAt: new Date(Date.parse(ANCHOR_ISO) + 3_600_000).toISOString(),
    sourceDataAsOf: ANCHOR_ISO,
    previousCaptureHash: null,
    slots,
  });
}

function marketData(sessionsAfterAnchor) {
  const protocol = buildProspectiveHoldoutProtocol();
  return {
    universe: protocol.universeFreeze.instruments,
    loaded: protocol.universeFreeze.instruments.map((instrument) => ({
      company: { companyId: instrument.companyId, primaryListing: { symbol: instrument.symbol } },
      series: sessionSeries(instrument.symbol, sessionsAfterAnchor, 0.01),
      benchmarkSeries: sessionSeries('SPY', sessionsAfterAnchor, 0.005),
    })),
  };
}

function closeTo(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

test('v1834 keeps all outcomes pending before the first five completed sessions', () => {
  const result = matureCaptureOutcomes(fullCapture(), marketData(4));
  assert.equal(result.verification.verified, true);
  assert.equal(result.outcomes.length, 32);
  assert.equal(result.outcomes.filter((item) => item.status === 'MATURED_OUTCOME_AVAILABLE').length, 0);
  assert.equal(result.outcomes.filter((item) => item.status === 'PENDING_HORIZON_MATURATION').length, 32);
  assert.ok(result.outcomes.every((item) => item.positiveOutcome === null));
  assert.ok(result.outcomes.every((item) => item.realizedReturnPct === null));
  assert.ok(result.outcomes.every((item) => item.benchmarkReturnPct === null));
  assert.ok(result.outcomes.every((item) => item.benchmarkRelativeReturnPct === null));
});

test('v1834 matures week1 exactly after five sessions while month1 remains sealed', () => {
  const result = matureCaptureOutcomes(fullCapture(), marketData(5));
  const week1 = result.outcomes.filter((item) => item.horizon === 'week1');
  const month1 = result.outcomes.filter((item) => item.horizon === 'month1');
  assert.equal(week1.length, 16);
  assert.equal(month1.length, 16);
  assert.ok(week1.every((item) => item.status === 'MATURED_OUTCOME_AVAILABLE'));
  assert.ok(month1.every((item) => item.status === 'PENDING_HORIZON_MATURATION'));

  const sample = week1[0];
  const expectedCompany = (((1.01) ** 5) - 1) * 100;
  const expectedBenchmark = (((1.005) ** 5) - 1) * 100;
  closeTo(sample.realizedReturnPct, Number(expectedCompany.toFixed(8)));
  closeTo(sample.benchmarkReturnPct, Number(expectedBenchmark.toFixed(8)));
  closeTo(sample.benchmarkRelativeReturnPct, Number((expectedCompany - expectedBenchmark).toFixed(8)));
  assert.equal(sample.positiveOutcome, 1);
  assert.equal(sample.sourceCaptureVerified, true);
});

test('v1834 matures month1 only after twenty-one completed sessions', () => {
  const result = matureCaptureOutcomes(fullCapture(), marketData(21));
  assert.equal(result.outcomes.length, 32);
  assert.equal(result.outcomes.filter((item) => item.status === 'MATURED_OUTCOME_AVAILABLE').length, 32);
  const month1 = result.outcomes.filter((item) => item.horizon === 'month1');
  assert.equal(month1.length, 16);
  assert.ok(month1.every((item) => item.completedCompanySessionsAfterFeature >= 21));
  assert.ok(month1.every((item) => item.completedBenchmarkSessionsAfterFeature >= 21));
  assert.ok(month1.every((item) => typeof item.outcomeKnownAt === 'string'));
});

test('v1834 rejects a tampered immutable capture before reading outcomes', () => {
  const capture = fullCapture();
  const tampered = {
    ...capture,
    slots: capture.slots.map((slot, index) => index === 0 ? { ...slot, probabilityPositive: 0.99 } : slot),
  };
  assert.throws(
    () => matureCaptureOutcomes(tampered, marketData(21)),
    /v1834 refuses unverified capture/,
  );
});

test('v1834 operational artifact exposes maturation only and never pre-gate performance', async () => {
  const artifact = await runV1834OutcomeMaturation({
    captures: [fullCapture()],
    marketData: marketData(5),
    generatedAt: '2026-08-20T23:00:00.000Z',
    sourceCommit: 'test-source',
  });
  assert.equal(artifact.contract, V1834_OUTCOME_MATURATION_CONTRACT);
  assert.equal(artifact.captureCount, 1);
  assert.equal(artifact.outcomeTupleCount, 32);
  assert.equal(artifact.maturedOutcomeCount, 16);
  assert.equal(artifact.pendingOutcomeCount, 16);
  assert.equal(artifact.performanceMetricsIncluded, false);
  assert.equal(artifact.performancePeeked, false);
  assert.equal(artifact.evaluationGateOpened, false);
  assert.equal(artifact.automaticModelPromotionEnabled, false);
  assert.equal(artifact.decisionIntegrationEnabled, false);
  assert.equal(artifact.forecastMayInfluenceFinalAction, false);
  assert.equal(artifact.brokerExecutionEligible, false);
  assert.equal(artifact.decisionImpact, 'NONE');
  assert.equal(artifact.contentHashAlgorithm, 'SHA256_CANONICAL_JSON');
  assert.match(artifact.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(assertV1834OutcomeMaturationReady(artifact), true);
  assert.equal(Object.hasOwn(artifact, 'brierScore'), false);
  assert.equal(Object.hasOwn(artifact, 'skillVsBaseRatePct'), false);
  assert.equal(Object.hasOwn(artifact, 'logLoss'), false);
});
