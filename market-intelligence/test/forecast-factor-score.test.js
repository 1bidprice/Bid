import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecastFeatureVector } from '../src/forecast-feature-vector.js';
import { buildForecastFactorScore } from '../src/forecast-factor-score.js';

function driver(name, family, direction, strengthScore, verified = true, evidenceIds = []) {
  return { name, family, direction, strengthScore, verified, evidenceIds, sourceCount: evidenceIds.length };
}

function baseSynthesis(overrides = {}) {
  return {
    instrumentId: 'company:ABC',
    evidenceQualityScore: 85,
    contradictionCount: 0,
    drivers: [
      driver('PEER_VALUATION', 'VALUATION', 'POSITIVE', 70, true, ['v1']),
      driver('QUALITY', 'QUALITY', 'POSITIVE', 65, true, ['q1']),
      driver('GROWTH', 'GROWTH', 'POSITIVE', 60, true, ['g1']),
      driver('RELATIVE_STRENGTH', 'MOMENTUM', 'POSITIVE', 75, true),
      driver('PROFITABILITY', 'FUNDAMENTAL', 'POSITIVE', 70, true),
      driver('VOLATILITY', 'RISK', 'NEUTRAL', 40, true),
      driver('VERIFIED_CATALYST', 'CATALYST', 'POSITIVE', 70, true, ['c1']),
      driver('LIQUIDITY', 'EXECUTION', 'NEUTRAL', 90, true),
    ],
    ...overrides,
  };
}

function pattern(overrides = {}) {
  return {
    tradingDays: 21,
    rawProbabilityPositive: 0.64,
    expectedReturnPct: 4.5,
    sample: { effectiveSampleSize: 24 },
    analogs: Array.from({ length: 30 }, (_, index) => ({ index })),
    ...overrides,
  };
}

function vector(synthesis = baseSynthesis(), patternHorizon = pattern()) {
  return buildForecastFeatureVector({
    instrumentId: 'company:ABC',
    assetClass: 'EQUITY',
    horizon: 'month1',
    driverSynthesis: synthesis,
    patternHorizon,
  });
}

function objectKeysDeep(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    output.push(key);
    objectKeysDeep(child, output);
  }
  return output;
}

test('missing and unverified factors are excluded rather than silently zero-filled', () => {
  const synthesis = baseSynthesis({
    drivers: [
      driver('ABSOLUTE_PS', 'VALUATION', 'POSITIVE', 100, false),
      driver('QUALITY', 'QUALITY', 'POSITIVE', 70, true),
      driver('RELATIVE_STRENGTH', 'MOMENTUM', 'POSITIVE', 70, true),
    ],
  });
  const result = vector(synthesis, null);
  const valuation = result.features.find((item) => item.domain === 'VALUATION');
  const historical = result.features.find((item) => item.domain === 'HISTORICAL_PATTERN');
  assert.equal(valuation.available, false);
  assert.equal(valuation.value, null);
  assert.equal(historical.available, false);
  assert.ok(result.missingDomains.includes('VALUATION'));
  assert.ok(result.missingDomains.includes('HISTORICAL_PATTERN'));
  assert.ok(result.excludedDrivers.some((item) => item.name === 'ABSOLUTE_PS' && item.reason === 'UNVERIFIED_DRIVER_EXCLUDED'));
});

test('execution liquidity is excluded from the return forecast even when verified and strong', () => {
  const result = vector();
  assert.equal(result.features.some((item) => item.domain === 'EXECUTION'), false);
  assert.ok(result.excludedDrivers.some((item) => item.name === 'LIQUIDITY' && item.reason === 'EXECUTION_QUALITY_NOT_RETURN_FORECAST_FACTOR'));
});

test('historical pattern frequency contributes only as a bounded research feature and not as a probability output', () => {
  const result = vector(baseSynthesis(), pattern({ rawProbabilityPositive: 0.8, expectedReturnPct: 8 }));
  const historical = result.features.find((item) => item.domain === 'HISTORICAL_PATTERN');
  assert.equal(historical.available, true);
  assert.ok(historical.value > 0 && historical.value <= 1);
  assert.equal(historical.components.rawPatternFrequencyPositive, 0.8);
  assert.equal(Object.hasOwn(historical.components, 'probabilityPositive'), false);
});

test('severe verified risk caps a positive latent score without turning the score into a trade action', () => {
  const synthesis = baseSynthesis({
    drivers: [
      ...baseSynthesis().drivers.filter((item) => item.family !== 'RISK'),
      driver('SEVERE_BALANCE_SHEET_RISK', 'RISK', 'NEGATIVE', 97, true, ['r1']),
    ],
  });
  const featureVector = vector(synthesis);
  const score = buildForecastFactorScore(featureVector);
  assert.equal(score.status, 'LATENT_SCORE_READY');
  assert.ok(score.rawLatentScore > 0);
  assert.equal(score.riskControl.capApplied, true);
  assert.equal(score.riskControl.maximumPositiveLatentScore, 0);
  assert.ok(score.latentScore <= 0);
  assert.equal(score.decisionImpact, 'NONE');
  assert.equal(score.finalActionEligible, false);
});

test('unresolved contradiction blocks the usable latent score while preserving auditable raw research score', () => {
  const featureVector = vector(baseSynthesis({ contradictionCount: 2 }));
  const score = buildForecastFactorScore(featureVector);
  assert.equal(score.status, 'RESEARCH_SCORE_BLOCKED');
  assert.ok(Number.isFinite(score.rawLatentScore));
  assert.equal(score.latentScore, null);
  assert.ok(score.blockers.includes('UNRESOLVED_CONTRADICTION'));
  assert.equal(score.finalActionEligible, false);
});

test('insufficient verified domain coverage fails closed instead of treating missing factors as neutral', () => {
  const featureVector = vector(baseSynthesis({
    drivers: [driver('QUALITY', 'QUALITY', 'POSITIVE', 80, true)],
  }), null);
  const score = buildForecastFactorScore(featureVector);
  assert.equal(score.status, 'RESEARCH_SCORE_BLOCKED');
  assert.equal(score.latentScore, null);
  assert.ok(score.blockers.includes('INSUFFICIENT_VERIFIED_FACTOR_DOMAINS'));
  assert.ok(score.blockers.includes('INSUFFICIENT_FACTOR_WEIGHT_COVERAGE'));
});

test('same verified inputs produce deterministic latent score and no probability field is emitted by the score contract', () => {
  const first = buildForecastFactorScore(vector());
  const second = buildForecastFactorScore(vector());
  assert.deepEqual(first, second);
  const keys = objectKeysDeep(first).map((key) => key.toLowerCase());
  assert.equal(keys.some((key) => key.includes('probability')), false);
  assert.equal(first.methodology.modelType, 'VERSIONED_DETERMINISTIC_MULTIFACTOR_LATENT_SCORE');
});
