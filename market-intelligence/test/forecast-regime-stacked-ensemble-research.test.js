import test from 'node:test';
import assert from 'node:assert/strict';
import { FORECAST_MARKET_REGIME_VERSION } from '../src/forecast-market-regime.js';
import { buildForecastRegimeStackedEnsembleResearchStatus } from '../src/forecast-regime-stacked-ensemble-research.js';
import {
  buildForecastRegimeStackedEnsembleOperationalTelemetry,
  verifyForecastRegimeStackedEnsembleProductionSafety,
} from '../src/forecast-regime-stacked-ensemble-production-safety.js';

function regimeSnapshot(forecastAt, key, options = {}) {
  const riskOn = key === 'RISK_ON|BULL_TREND|LOW_VOLATILITY|POSITIVE_MOMENTUM';
  const capturedAt = options.future
    ? new Date(new Date(forecastAt).getTime() + 60_000).toISOString()
    : forecastAt;
  return {
    contract: 'FORECAST_TIME_MARKET_REGIME_SNAPSHOT_V1',
    policyVersion: FORECAST_MARKET_REGIME_VERSION,
    capturedAt,
    benchmarkAsOf: forecastAt,
    benchmarkSymbol: 'SPY',
    benchmarkSource: 'TEST',
    benchmarkSourceQuality: 'CANONICAL',
    observationCount: 300,
    status: 'REGIME_READY',
    regimeKey: key,
    riskTone: riskOn ? 'RISK_ON' : 'RISK_OFF',
    trendRegime: riskOn ? 'BULL_TREND' : 'BEAR_TREND',
    momentumRegime: riskOn ? 'POSITIVE_MOMENTUM' : 'NEGATIVE_MOMENTUM',
    volatilityRegime: riskOn ? 'LOW_VOLATILITY' : 'HIGH_VOLATILITY',
    metrics: {},
    blockers: [],
    researchOnly: true,
    modelDerived: true,
    finalActionEligible: false,
    decisionImpact: 'NONE',
  };
}

function record(index, options = {}) {
  const base = new Date(Date.UTC(2023, 0, 1));
  const forecastAt = new Date(base.getTime() + index * 86_400_000).toISOString();
  const outcomeAt = new Date(new Date(forecastAt).getTime() + 43_200_000).toISOString();
  const factorScore = index % 2 === 0 ? 0.7 : -0.7;
  const riskOn = options.regime !== 'OFF';
  const positiveOutcome = riskOn ? (factorScore > 0 ? 1 : 0) : (factorScore < 0 ? 1 : 0);
  const regimeKey = riskOn
    ? 'RISK_ON|BULL_TREND|LOW_VOLATILITY|POSITIVE_MOMENTUM'
    : 'RISK_OFF|BEAR_TREND|HIGH_VOLATILITY|NEGATIVE_MOMENTUM';
  return {
    forecastId: `regime-stack:${options.version || 'pattern-v1'}:${options.regime || 'ON'}:${index}`,
    companyId: `company:${index % 20}`,
    instrumentId: `instrument:${index % 20}`,
    validationMode: 'LIVE_SHADOW_OOS',
    historicalPatternPolicyVersion: options.version || 'pattern-v1',
    factorScorePolicyVersion: options.factorVersion || 'factor-v1',
    factorScoreStatus: 'LATENT_SCORE_READY',
    rawProbabilityPositive: factorScore > 0 ? 0.72 : 0.28,
    latentFactorScore: factorScore,
    assetClass: 'EQUITY',
    horizon: options.horizon || 'month1',
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    status: 'MATURED',
    positiveOutcome,
    realisedOutcome: {
      timestamp: outcomeAt,
      realisedReturnPct: positiveOutcome ? 5 : -5,
    },
    marketRegimeSnapshot: options.noRegime ? undefined : regimeSnapshot(forecastAt, regimeKey, { future: options.futureRegime }),
  };
}

function build(records) {
  return buildForecastRegimeStackedEnsembleResearchStatus({
    generatedAt: '2026-08-13T00:00:00.000Z',
    records,
  });
}

function report(status) {
  return {
    forecastRegimeStackedEnsembleResearchStatus: status,
    operationalHealth: buildForecastRegimeStackedEnsembleOperationalTelemetry(status),
  };
}

test('regime stack never pools training records across opposite immutable regimes', () => {
  const records = [
    ...Array.from({ length: 90 }, (_, index) => record(index, { regime: 'ON' })),
    ...Array.from({ length: 90 }, (_, index) => record(index + 200, { regime: 'OFF' })),
  ];
  const status = build(records);
  const group = status.groups[0];
  assert.equal(group.regimeCount, 2);
  assert.equal(group.regimes.length, 2);
  assert.ok(group.pooledReference.prequentialPredictionCount > 0);
  for (const regime of group.regimes) {
    assert.equal(regime.regimeMaturedStackInputCount, 90);
    assert.equal(regime.ensembleResearch.lineageRecordCount, 90);
    assert.equal(regime.trainingRegimeIsolation, 'SAME_IMMUTABLE_FORECAST_TIME_REGIME_ONLY');
    assert.equal(regime.antiLeakRule, 'TRAIN_ONLY_ON_SAME_REGIME_OUTCOMES_REALIZED_STRICTLY_BEFORE_TARGET_FORECAST_TIME');
  }
  assert.equal(group.pooledReferenceMaySatisfyRegimeReadiness, false);
});

test('opposite factor relationships remain separated rather than averaged into one regime conclusion', () => {
  const records = [
    ...Array.from({ length: 100 }, (_, index) => record(index, { regime: 'ON' })),
    ...Array.from({ length: 100 }, (_, index) => record(index + 300, { regime: 'OFF' })),
  ];
  const group = build(records).groups[0];
  const on = group.regimes.find((item) => item.riskTone === 'RISK_ON');
  const off = group.regimes.find((item) => item.riskTone === 'RISK_OFF');
  assert.ok(on);
  assert.ok(off);
  assert.notEqual(on.regimeKey, off.regimeKey);
  assert.equal(on.ensembleResearch.groups[0].lineageRecordCount, 100);
  assert.equal(off.ensembleResearch.groups[0].lineageRecordCount, 100);
});

test('missing regime lineage lowers coverage and cannot be backfilled or silently promoted', () => {
  const classified = Array.from({ length: 60 }, (_, index) => record(index, { regime: 'ON' }));
  const legacy = Array.from({ length: 60 }, (_, index) => record(index + 100, { noRegime: true }));
  const before = JSON.stringify(legacy);
  const group = build([...classified, ...legacy]).groups[0];
  assert.equal(group.coverage.coverageReady, false);
  assert.equal(group.coverage.regimeCoveragePct, 50);
  assert.ok(group.coverage.blockers.includes('REGIME_ENSEMBLE_MATURED_COVERAGE_TOO_LOW'));
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(group.readyRegimeCount, 0);
});

test('future or malformed regime snapshots are excluded and block coverage readiness', () => {
  const records = [
    ...Array.from({ length: 80 }, (_, index) => record(index, { regime: 'ON' })),
    record(500, { regime: 'ON', futureRegime: true }),
  ];
  const group = build(records).groups[0];
  assert.equal(group.coverage.invalidRegimeSnapshotCount, 1);
  assert.equal(group.coverage.coverageReady, false);
  assert.ok(group.coverage.blockers.includes('REGIME_ENSEMBLE_INVALID_MARKET_REGIME_SNAPSHOTS_EXCLUDED'));
});

test('pattern, factor, asset-class and horizon lineages stay separated before regime stratification', () => {
  const records = [
    ...Array.from({ length: 30 }, (_, index) => record(index, { version: 'pattern-a', regime: 'ON' })),
    ...Array.from({ length: 30 }, (_, index) => record(index + 40, { version: 'pattern-b', regime: 'ON' })),
    ...Array.from({ length: 30 }, (_, index) => record(index + 80, { factorVersion: 'factor-b', regime: 'ON' })),
    ...Array.from({ length: 30 }, (_, index) => record(index + 120, { horizon: 'month3', regime: 'ON' })),
  ];
  const status = build(records);
  assert.equal(status.groupCount, 4);
  assert.ok(status.groups.every((group) => group.regimeCount === 1));
});

test('regime stacked ensemble remains research-only with zero decision or broker authority', () => {
  const status = build(Array.from({ length: 80 }, (_, index) => record(index, { regime: 'ON' })));
  assert.equal(status.researchOnly, true);
  assert.equal(status.automaticModelPromotionEnabled, false);
  assert.equal(status.probabilityCalibrationEnabled, false);
  assert.equal(status.decisionIntegrationEnabled, false);
  assert.equal(status.forecastMayInfluenceFinalAction, false);
  assert.equal(status.finalActionEligible, false);
  assert.equal(status.decisionImpact, 'NONE');
  assert.equal(JSON.stringify(status).includes('BUY_NOW'), false);
  assert.equal(JSON.stringify(status).includes('SELL_NOW'), false);
});

test('production firewall accepts safe research-only status and rejects authority or telemetry tampering', () => {
  const status = build(Array.from({ length: 80 }, (_, index) => record(index, { regime: 'ON' })));
  const safe = report(status);
  assert.equal(verifyForecastRegimeStackedEnsembleProductionSafety(safe).status, 'VERIFIED');

  const authority = JSON.parse(JSON.stringify(safe));
  authority.forecastRegimeStackedEnsembleResearchStatus.decisionIntegrationEnabled = true;
  assert.throws(() => verifyForecastRegimeStackedEnsembleProductionSafety(authority), /forbidden authority/);

  const telemetry = JSON.parse(JSON.stringify(safe));
  telemetry.operationalHealth.forecastRegimeStackedEnsembleReadyRegimeCount = 99;
  assert.throws(() => verifyForecastRegimeStackedEnsembleProductionSafety(telemetry), /telemetry mismatch/);
});

test('production firewall rejects a child lineage count that could indicate cross-regime training', () => {
  const status = build(Array.from({ length: 80 }, (_, index) => record(index, { regime: 'ON' })));
  const tampered = report(status);
  tampered.forecastRegimeStackedEnsembleResearchStatus.groups[0].regimes[0].ensembleResearch.lineageRecordCount += 1;
  assert.throws(() => verifyForecastRegimeStackedEnsembleProductionSafety(tampered), /crosses regime boundary/);
});
