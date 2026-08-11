import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildForecastRegimeLearningStatus } from '../src/forecast-regime-learning-status.js';
import {
  buildForecastRegimeOperationalTelemetry,
  verifyForecastRegimeProductionSafety,
} from '../src/forecast-regime-production-safety.js';

const DAY_MS = 86_400_000;
const START = Date.UTC(2000, 0, 1);

function regimeSnapshot(forecastAt) {
  return {
    contract: 'FORECAST_TIME_MARKET_REGIME_SNAPSHOT_V1',
    policyVersion: '2026-08-12.1',
    capturedAt: forecastAt,
    benchmarkAsOf: forecastAt,
    benchmarkSymbol: 'SPY',
    benchmarkSource: 'synthetic benchmark',
    benchmarkSourceQuality: 'TEST',
    observationCount: 300,
    status: 'REGIME_READY',
    regimeKey: 'RISK_ON|BULL_TREND|LOW_VOLATILITY|POSITIVE_MOMENTUM',
    riskTone: 'RISK_ON',
    trendRegime: 'BULL_TREND',
    momentumRegime: 'POSITIVE_MOMENTUM',
    volatilityRegime: 'LOW_VOLATILITY',
    metrics: {},
    blockers: [],
    researchOnly: true,
    modelDerived: true,
    finalActionEligible: false,
    decisionImpact: 'NONE',
  };
}

function records(count = 80) {
  return Array.from({ length: count }, (_, index) => {
    const forecastAt = new Date(START + index * 30 * DAY_MS).toISOString();
    const positive = index % 2 === 0;
    return {
      forecastId: `regime-production:${index}`,
      validationMode: 'LIVE_SHADOW_OOS',
      historicalPatternPolicyVersion: 'pattern-v1',
      assetClass: 'EQUITY',
      horizon: 'month1',
      tradingDays: 21,
      companyId: `company:${index % 20}`,
      instrumentId: `instrument:${index % 20}`,
      forecastAt,
      forecastSampleDate: forecastAt.slice(0, 10),
      referencePrice: { timestamp: forecastAt, value: 100 },
      status: 'MATURED',
      positiveOutcome: positive ? 1 : 0,
      rawProbabilityPositive: positive ? 0.7 : 0.3,
      expectedReturnPct: positive ? 2 : -1,
      realisedOutcome: {
        timestamp: new Date(new Date(forecastAt).getTime() + 21 * DAY_MS).toISOString(),
        realisedReturnPct: positive ? 5 : -3,
      },
      marketRegimeSnapshot: regimeSnapshot(forecastAt),
    };
  });
}

function report(status) {
  return {
    forecastRegimeLearningStatus: status,
    operationalHealth: {
      ...buildForecastRegimeOperationalTelemetry(status),
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('empty regime lineage remains valid research-only production state with zero telemetry', () => {
  const status = buildForecastRegimeLearningStatus({ records: [] });
  const value = report(status);
  const verified = verifyForecastRegimeProductionSafety(value);
  assert.equal(verified.status, 'VERIFIED');
  assert.equal(value.operationalHealth.forecastRegimeLearningLineageRecordCount, 0);
  assert.equal(value.operationalHealth.forecastRegimeLearningReadyRegimeCount, 0);
  assert.equal(value.operationalHealth.forecastRegimeDecisionIntegrationEnabled, false);
});

test('statistically ready regime remains production-safe because all authority flags stay false', () => {
  const status = buildForecastRegimeLearningStatus({ records: records() });
  assert.equal(status.readyRegimeCount, 1);
  const value = report(status);
  assert.equal(verifyForecastRegimeProductionSafety(value).readyRegimeCount, 1);
  assert.equal(status.automaticRegimeWeightingEnabled, false);
  assert.equal(status.probabilityCalibrationEnabled, false);
  assert.equal(status.factorReweightingEnabled, false);
  assert.equal(status.decisionIntegrationEnabled, false);
  assert.equal(status.forecastMayInfluenceFinalAction, false);
});

test('production verifier rejects any attempt to give regime research decision authority', () => {
  const value = report(buildForecastRegimeLearningStatus({ records: records() }));
  value.forecastRegimeLearningStatus.decisionIntegrationEnabled = true;
  assert.throws(() => verifyForecastRegimeProductionSafety(value), /decisionIntegrationEnabled must remain false/);
});

test('production verifier rejects a READY regime whose statistical gates were weakened after serialization', () => {
  const value = report(buildForecastRegimeLearningStatus({ records: records() }));
  const regime = value.forecastRegimeLearningStatus.groups[0].regimes[0];
  assert.equal(regime.status, 'REGIME_RESEARCH_READY');
  regime.sampleIndependence.status = 'INDEPENDENCE_NOT_READY';
  assert.throws(() => verifyForecastRegimeProductionSafety(value), /sample independence not ready/);
});

test('production verifier rejects compact telemetry that does not match the full regime research object', () => {
  const value = report(buildForecastRegimeLearningStatus({ records: records() }));
  value.operationalHealth.forecastRegimeLearningReadyRegimeCount += 1;
  assert.throws(() => verifyForecastRegimeProductionSafety(value), /operational telemetry mismatch/);
});

test('v1816 runtime wiring exposes full regime research plus compact operational telemetry and production verifier', () => {
  const autonomous = fs.readFileSync(new URL('../src/run-autonomous-intelligence.js', import.meta.url), 'utf8');
  const verifier = fs.readFileSync(new URL('../scripts/verify-production-output.js', import.meta.url), 'utf8');
  assert.match(autonomous, /buildForecastRegimeLearningStatus/);
  assert.match(autonomous, /buildForecastRegimeOperationalTelemetry/);
  assert.match(autonomous, /forecastRegimeLearningStatus,/);
  assert.match(autonomous, /\.\.\.forecastRegimeOperationalTelemetry/);
  assert.match(verifier, /verifyForecastRegimeProductionSafety\(report\)/);
  assert.match(verifier, /regimeStratifiedOosResearchSafety: 'REQUIRED'/);
});
