import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistoricalMarketDomainPrequentialStackPredictions,
  buildHistoricalMarketFactorPrequentialStackPredictions,
  buildHistoricalMarketPriorShrunkPrequentialStackPredictions,
} from '../src/forecast-historical-market-prequential-stack.js';
import { buildHistoricalMarketAdaptivePriorShrunkPrequentialStackPredictions } from '../src/forecast-historical-market-adaptive-prior-shrinkage.js';
import {
  PROSPECTIVE_FROZEN_STACK_BRIDGE_CONTRACT,
  PROSPECTIVE_FROZEN_STACK_MODEL_SOURCE_COMMIT,
  buildProspectiveFrozenStackPredictions,
} from '../src/forecast-prospective-frozen-stack-bridge.js';

function iso(ms) {
  return new Date(ms).toISOString();
}

function historicalRecord(index, options = {}) {
  const base = Date.parse('2024-01-02T21:00:00.000Z');
  const forecastMs = base + index * 2 * 86_400_000;
  const outcomeMs = forecastMs + 86_400_000;
  const pattern = 0.32 + ((index * 17) % 36) / 100;
  const factor = -0.75 + ((index * 13) % 150) / 100;
  const momentum = -0.7 + ((index * 11) % 140) / 100;
  const risk = -0.65 + ((index * 7) % 130) / 100;
  const positive = ((index * 37 + 11) % 100) < 54 ? 1 : 0;
  return {
    forecastId: `fixture:${index}`,
    validationMode: 'WALK_FORWARD_OOS',
    evidenceClass: 'HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH',
    status: 'MATURED',
    historicalPatternPolicyVersion: '2026-08-11.1',
    historicalMarketFactorPolicyVersion: '2026-08-14.1',
    historicalMarketFactorStatus: 'HISTORICAL_MARKET_FACTOR_READY',
    historicalMarketFactorScore: Number(factor.toFixed(6)),
    historicalMarketFactorSnapshot: {
      domainContributions: [
        { domain: 'MOMENTUM', value: Number(momentum.toFixed(6)) },
        { domain: 'RISK', value: Number(risk.toFixed(6)) },
      ],
    },
    instrumentId: `company:${index % 16}`,
    companyId: `company:${index % 16}`,
    assetClass: 'EQUITY',
    horizon: 'week1',
    tradingDays: 5,
    forecastAt: iso(forecastMs),
    forecastSampleDate: iso(forecastMs).slice(0, 10),
    outcomeKnownAt: iso(outcomeMs),
    realisedOutcome: { timestamp: iso(outcomeMs) },
    rawProbabilityPositive: Number(pattern.toFixed(6)),
    positiveOutcome: positive,
    regimeKey: 'RISK_ON|BULL_TREND|LOW_VOLATILITY|POSITIVE_MOMENTUM',
    ...options,
  };
}

function targetWithoutOutcome(index = 190) {
  const matured = historicalRecord(index);
  const {
    positiveOutcome: _positiveOutcome,
    outcomeKnownAt: _outcomeKnownAt,
    realisedOutcome: _realisedOutcome,
    status: _status,
    validationMode: _validationMode,
    evidenceClass: _evidenceClass,
    ...target
  } = matured;
  return target;
}

function referenceTarget(records, targetMatured) {
  return records.find((prediction) => prediction.forecastAt === targetMatured.forecastAt);
}

function bridgeVariant(bridge, modelVariant) {
  return bridge.predictions.find((prediction) => prediction.modelVariant === modelVariant);
}

test('prospective bridge reproduces all four frozen v1829 variants for an identical historical target', () => {
  const history = Array.from({ length: 190 }, (_, index) => historicalRecord(index));
  const targetMatured = historicalRecord(190);
  const all = [...history, targetMatured];
  const target = targetWithoutOutcome(190);

  const scalarRef = referenceTarget(buildHistoricalMarketFactorPrequentialStackPredictions(all).predictions, targetMatured);
  const domainRef = referenceTarget(buildHistoricalMarketDomainPrequentialStackPredictions(all).predictions, targetMatured);
  const priorRef = referenceTarget(buildHistoricalMarketPriorShrunkPrequentialStackPredictions(all).predictions, targetMatured);
  const adaptiveRef = referenceTarget(buildHistoricalMarketAdaptivePriorShrunkPrequentialStackPredictions(all).predictions, targetMatured);
  assert.ok(scalarRef && domainRef && priorRef && adaptiveRef);

  const bridge = buildProspectiveFrozenStackPredictions(history, target);
  assert.equal(bridge.contract, PROSPECTIVE_FROZEN_STACK_BRIDGE_CONTRACT);
  assert.equal(bridge.modelSourceCommit, PROSPECTIVE_FROZEN_STACK_MODEL_SOURCE_COMMIT);
  assert.equal(bridge.targetOutcomeUsed, false);
  assert.equal(bridge.modelVariantCount, 4);

  const scalar = bridgeVariant(bridge, 'SCALAR_MARKET_FACTOR');
  const domain = bridgeVariant(bridge, 'DOMAIN_SEPARATED_MARKET_FACTOR');
  const prior = bridgeVariant(bridge, 'PRIOR_SHRUNK_SCALAR_MARKET_FACTOR');
  const adaptive = bridgeVariant(bridge, 'ADAPTIVE_PRIOR_SHRUNK_SCALAR_MARKET_FACTOR');
  assert.equal(scalar.status, 'FORECAST_AVAILABLE');
  assert.equal(domain.status, 'FORECAST_AVAILABLE');
  assert.equal(prior.status, 'FORECAST_AVAILABLE');
  assert.equal(adaptive.status, 'FORECAST_AVAILABLE');

  assert.equal(scalar.probabilityPositive, scalarRef.ensembleResearchProbabilityPositive);
  assert.equal(domain.probabilityPositive, domainRef.ensembleResearchProbabilityPositive);
  assert.equal(prior.probabilityPositive, priorRef.ensembleResearchProbabilityPositive);
  assert.equal(adaptive.probabilityPositive, adaptiveRef.ensembleResearchProbabilityPositive);
  assert.equal(prior.supportFloor, priorRef.ensemblePriorShrinkageSupportFloor);
  assert.equal(adaptive.supportFloor, adaptiveRef.ensemblePriorShrinkageSupportFloor);
  assert.equal(adaptive.adaptiveSelectionStatus, adaptiveRef.ensembleAdaptiveSelectionStatus);
  assert.equal(adaptive.adaptiveSelectionSampleSize, adaptiveRef.ensembleAdaptiveSelectionSampleSize);
  assert.equal(adaptive.adaptiveSelectedHistoricalBrierScore, adaptiveRef.ensembleAdaptiveSelectedHistoricalBrierScore);

  for (const prediction of bridge.predictions) {
    assert.equal(prediction.modelSourceCommit, PROSPECTIVE_FROZEN_STACK_MODEL_SOURCE_COMMIT);
    assert.equal(Object.hasOwn(prediction, 'positiveOutcome'), false);
    assert.equal(Object.hasOwn(prediction, 'realisedOutcome'), false);
    assert.equal(Object.hasOwn(prediction, 'outcomeKnownAt'), false);
  }
  assert.equal(bridge.automaticModelPromotionEnabled, false);
  assert.equal(bridge.decisionIntegrationEnabled, false);
  assert.equal(bridge.forecastMayInfluenceFinalAction, false);
  assert.equal(bridge.brokerExecutionEligible, false);
  assert.equal(bridge.decisionImpact, 'NONE');
});

test('prospective bridge trains only on outcomes known strictly before target forecast time', () => {
  const history = Array.from({ length: 100 }, (_, index) => historicalRecord(index));
  const target = targetWithoutOutcome(100);
  const late = historicalRecord(99, {
    forecastId: 'fixture:late-outcome',
    outcomeKnownAt: iso(Date.parse(target.forecastAt) + 86_400_000),
    realisedOutcome: { timestamp: iso(Date.parse(target.forecastAt) + 86_400_000) },
  });
  history[99] = late;
  const bridge = buildProspectiveFrozenStackPredictions(history, target);
  const scalar = bridgeVariant(bridge, 'SCALAR_MARKET_FACTOR');
  assert.equal(scalar.status, 'FORECAST_AVAILABLE');
  assert.equal(scalar.trainingSampleSize, 99);
  assert.ok(Date.parse(scalar.trainingLatestOutcomeAt) < Date.parse(target.forecastAt));
});

test('prospective bridge withholds all variants when pre-outcome training support is insufficient', () => {
  const history = Array.from({ length: 50 }, (_, index) => historicalRecord(index));
  const target = targetWithoutOutcome(50);
  const bridge = buildProspectiveFrozenStackPredictions(history, target);
  assert.equal(bridge.predictions.length, 4);
  for (const prediction of bridge.predictions) {
    assert.equal(prediction.status, 'WITHHELD');
    assert.equal(prediction.probabilityPositive, null);
    assert.equal(prediction.withheldReason, 'FROZEN_STACK_INSUFFICIENT_PREOUTCOME_TRAINING');
  }
});

test('prospective bridge rejects target feature lineage that is not ready without inventing a probability', () => {
  const history = Array.from({ length: 100 }, (_, index) => historicalRecord(index));
  const target = { ...targetWithoutOutcome(100), historicalMarketFactorStatus: 'HISTORICAL_MARKET_FACTOR_BLOCKED' };
  const bridge = buildProspectiveFrozenStackPredictions(history, target);
  for (const prediction of bridge.predictions) {
    assert.equal(prediction.status, 'WITHHELD');
    assert.equal(prediction.probabilityPositive, null);
  }
});
