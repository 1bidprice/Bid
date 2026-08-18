import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProspectiveHoldoutCaptureV2,
  buildProspectiveHoldoutProtocolV2,
  prospectiveTargetFeatureFingerprint,
} from '../src/forecast-prospective-holdout-protocol-v2.js';
import {
  matureV2CaptureOutcomes,
  runV1837V2OutcomeMaturation,
  V1837_V2_OUTCOME_MATURATION_CONTRACT,
} from '../scripts/run-prospective-holdout-v2-outcome-maturation-v1837.js';

const START = Date.parse('2026-06-01T20:00:00.000Z') / 1000;
const ANCHOR = 50;
const FEATURE_AS_OF = new Date((START + ANCHOR * 86_400) * 1000).toISOString();

function series(symbol, after, growth) {
  const candles = [];
  for (let i = 0; i <= ANCHOR + after; i += 1) candles.push({ timestamp: START + i * 86_400, close: 100 * ((1 + growth) ** i), volume: 1_000_000 + i });
  return { symbol, providerSymbol: symbol, usable: true, candles };
}

function captureV2() {
  const protocol = buildProspectiveHoldoutProtocolV2();
  const slots = [];
  for (const instrument of protocol.universeFreeze.instruments) {
    for (const horizon of protocol.horizons) {
      const feature = {
        forecastId: `v2:${instrument.companyId}:${horizon.horizon}:${FEATURE_AS_OF}`,
        companyId: instrument.companyId,
        symbol: instrument.symbol,
        horizon: horizon.horizon,
        tradingDays: horizon.tradingDays,
        featureAsOf: FEATURE_AS_OF,
        rawPatternProbabilityPositive: 0.51,
        regimeKey: 'RISK_ON|BULL_TREND|NORMAL_VOLATILITY|POSITIVE_MOMENTUM',
        historicalPatternPolicyVersion: 'fixture-pattern-v1',
        historicalMarketFactorPolicyVersion: 'fixture-factor-v1',
        historicalMarketFactorScore: 0.1,
      };
      const fingerprint = prospectiveTargetFeatureFingerprint(feature);
      for (const modelVariant of protocol.modelFreeze.modelVariants) slots.push({
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
  return buildProspectiveHoldoutCaptureV2({ protocol, capturedAt: new Date(Date.parse(FEATURE_AS_OF) + 3_600_000).toISOString(), sourceDataAsOf: FEATURE_AS_OF, slots });
}

function marketData(after) {
  const protocol = buildProspectiveHoldoutProtocolV2();
  return {
    loaded: protocol.universeFreeze.instruments.map((instrument) => ({
      company: { companyId: instrument.companyId },
      series: series(instrument.symbol, after, 0.01),
      benchmarkSeries: series('SPY', after, 0.005),
    })),
  };
}

test('v1837 reveals nothing before five completed sessions', () => {
  const result = matureV2CaptureOutcomes(captureV2(), marketData(4));
  assert.equal(result.verification.verified, true);
  assert.equal(result.outcomes.length, 32);
  assert.equal(result.outcomes.filter((item) => item.status === 'MATURED_OUTCOME_AVAILABLE').length, 0);
  assert.ok(result.outcomes.every((item) => item.realizedReturnPct === null && item.positiveOutcome === null));
});

test('v1837 matures only week1 at five sessions and keeps model/baseline/regime data out of outcome store', async () => {
  const artifact = await runV1837V2OutcomeMaturation({ captures: [captureV2()], marketData: marketData(5), generatedAt: '2026-08-20T23:00:00.000Z' });
  assert.equal(artifact.contract, V1837_V2_OUTCOME_MATURATION_CONTRACT);
  assert.equal(artifact.maturedOutcomeCount, 16);
  assert.equal(artifact.pendingOutcomeCount, 16);
  assert.equal(artifact.performanceMetricsIncluded, false);
  assert.equal(artifact.performancePeeked, false);
  assert.equal(artifact.evaluationGateOpened, false);
  assert.equal(artifact.modelProbabilitiesIncluded, false);
  assert.equal(artifact.rawPatternBaselinesIncluded, false);
  assert.equal(artifact.regimeKeysIncluded, false);
  assert.ok(artifact.outcomes.every((item) => !Object.hasOwn(item, 'probabilityPositive') && !Object.hasOwn(item, 'rawPatternProbabilityPositive') && !Object.hasOwn(item, 'regimeKey') && !Object.hasOwn(item, 'modelVariant')));
});

test('v1837 matures both horizons after twenty-one sessions', () => {
  const result = matureV2CaptureOutcomes(captureV2(), marketData(21));
  assert.equal(result.outcomes.filter((item) => item.status === 'MATURED_OUTCOME_AVAILABLE').length, 32);
});

test('v1837 rejects a tampered v2 capture before outcome access', () => {
  const capture = captureV2();
  const tampered = { ...capture, slots: capture.slots.map((slot, i) => i === 0 ? { ...slot, rawPatternProbabilityPositive: 0.99 } : slot) };
  assert.throws(() => matureV2CaptureOutcomes(tampered, marketData(21)), /v1837 refuses unverified v2 capture/);
});
