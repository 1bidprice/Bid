import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecastRegimeLearningStatus } from '../src/forecast-regime-learning-status.js';

const DAY_MS = 86_400_000;
const START = Date.UTC(2000, 0, 1);

function regimeSnapshot(forecastAt, kind = 'RISK_ON', options = {}) {
  const riskOn = kind === 'RISK_ON';
  return {
    contract: 'FORECAST_TIME_MARKET_REGIME_SNAPSHOT_V1',
    policyVersion: '2026-08-12.1',
    capturedAt: options.capturedAt || forecastAt,
    benchmarkAsOf: options.benchmarkAsOf || forecastAt,
    benchmarkSymbol: options.benchmarkSymbol || 'SPY',
    benchmarkSource: 'synthetic benchmark',
    benchmarkSourceQuality: 'TEST',
    observationCount: 300,
    status: 'REGIME_READY',
    regimeKey: riskOn
      ? 'RISK_ON|BULL_TREND|LOW_VOLATILITY|POSITIVE_MOMENTUM'
      : 'RISK_OFF|BEAR_TREND|HIGH_VOLATILITY|NEGATIVE_MOMENTUM',
    riskTone: kind,
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
  const spacingDays = options.spacingDays ?? 30;
  const tradingDays = options.tradingDays ?? 21;
  const forecastAt = new Date(START + index * spacingDays * DAY_MS).toISOString();
  const outcomeAt = new Date(new Date(forecastAt).getTime() + tradingDays * DAY_MS).toISOString();
  const positive = options.positive ?? (index % 2 === 0);
  const probability = options.probability ?? (positive ? 0.7 : 0.3);
  const realisedReturnPct = options.realisedReturnPct ?? (positive ? 5 : -3);
  const instrumentIndex = options.instrumentIndex ?? index % 20;
  const regime = options.noRegime ? null : regimeSnapshot(forecastAt, options.regime || 'RISK_ON', options.regimeOptions || {});
  return {
    forecastId: `regime-oos:${options.patternVersion || 'pattern-v1'}:${options.horizon || 'month1'}:${index}:${options.suffix || ''}`,
    validationMode: 'LIVE_SHADOW_OOS',
    historicalPatternPolicyVersion: options.patternVersion || 'pattern-v1',
    assetClass: options.assetClass || 'EQUITY',
    horizon: options.horizon || 'month1',
    tradingDays,
    companyId: `company:${instrumentIndex}`,
    instrumentId: `instrument:${instrumentIndex}`,
    symbol: `SYM${instrumentIndex}`,
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    referencePrice: { timestamp: forecastAt, value: 100 },
    status: options.open ? 'OPEN' : 'MATURED',
    positiveOutcome: options.open ? null : positive ? 1 : 0,
    rawProbabilityPositive: options.stringProbability ? String(probability) : probability,
    expectedReturnPct: options.expectedReturnPct ?? (positive ? 2 : -1),
    realisedOutcome: options.open ? null : { timestamp: outcomeAt, realisedReturnPct },
    ...(regime ? { marketRegimeSnapshot: regime } : {}),
  };
}

function readyRecords() {
  return [
    ...Array.from({ length: 80 }, (_, index) => record(index, { regime: 'RISK_ON', suffix: 'on' })),
    ...Array.from({ length: 80 }, (_, offset) => record(100 + offset, {
      regime: 'RISK_OFF',
      suffix: 'off',
      positive: offset % 2 === 0,
      probability: offset % 2 === 0 ? 0.65 : 0.35,
      realisedReturnPct: offset % 2 === 0 ? 2 : -6,
    })),
  ];
}

test('matured OOS performance is measured separately for each frozen forecast-time regime', () => {
  const status = buildForecastRegimeLearningStatus({ records: readyRecords() });
  assert.equal(status.status, 'RESEARCH_ONLY');
  assert.equal(status.groupCount, 1);
  assert.equal(status.readyRegimeCount, 2);
  const group = status.groups[0];
  assert.equal(group.coverage.regimeCoveragePct, 100);
  assert.equal(group.coverage.status, 'REGIME_COVERAGE_READY');
  assert.equal(group.regimeCount, 2);
  const riskOn = group.regimes.find((item) => item.riskTone === 'RISK_ON');
  const riskOff = group.regimes.find((item) => item.riskTone === 'RISK_OFF');
  assert.equal(riskOn.status, 'REGIME_RESEARCH_READY');
  assert.equal(riskOff.status, 'REGIME_RESEARCH_READY');
  assert.equal(riskOn.maturedSampleSize, 80);
  assert.equal(riskOff.maturedSampleSize, 80);
  assert.ok(riskOn.metrics.meanRealisedReturnPct > riskOff.metrics.meanRealisedReturnPct);
  assert.equal(riskOn.calibration.status, 'OOS_METRICS_READY');
  assert.equal(riskOff.calibration.status, 'OOS_METRICS_READY');
});

test('low regime coverage blocks conclusions even when the classified subset is large and diversified', () => {
  const classified = Array.from({ length: 80 }, (_, index) => record(index, { regime: 'RISK_ON' }));
  const legacy = Array.from({ length: 40 }, (_, offset) => record(100 + offset, { noRegime: true, suffix: 'legacy' }));
  const group = buildForecastRegimeLearningStatus({ records: [...classified, ...legacy] }).groups[0];
  assert.equal(group.coverage.regimeCoveragePct, 66.67);
  assert.equal(group.coverage.status, 'REGIME_COVERAGE_NOT_READY');
  assert.ok(group.coverage.blockers.includes('MARKET_REGIME_MATURED_COVERAGE_TOO_LOW'));
  assert.equal(group.regimes[0].status, 'REGIME_RESEARCH_NOT_READY');
  assert.ok(group.regimes[0].blockers.includes('REGIME_LINEAGE_COVERAGE_NOT_READY'));
});

test('post-forecast regime snapshots are excluded and explicitly reduce valid coverage', () => {
  const records = Array.from({ length: 80 }, (_, index) => record(index, {
    regime: 'RISK_ON',
    regimeOptions: index < 8 ? { capturedAt: new Date(START + index * 30 * DAY_MS + DAY_MS).toISOString() } : {},
  }));
  const group = buildForecastRegimeLearningStatus({ records }).groups[0];
  assert.equal(group.coverage.invalidRegimeSnapshotCount, 8);
  assert.equal(group.coverage.validRegimeMaturedCount, 72);
  assert.equal(group.coverage.regimeCoveragePct, 90);
  assert.equal(group.coverage.coverageReady, false);
  assert.ok(group.coverage.blockers.includes('INVALID_MARKET_REGIME_SNAPSHOTS_EXCLUDED'));
});

test('raw sample size cannot replace independent forecast dates and non-overlapping outcome windows inside a regime', () => {
  const records = Array.from({ length: 80 }, (_, index) => record(index, {
    regime: 'RISK_ON',
    spacingDays: 1,
    instrumentIndex: index % 20,
  }));
  const regime = buildForecastRegimeLearningStatus({ records }).groups[0].regimes[0];
  assert.equal(regime.maturedSampleSize, 80);
  assert.equal(regime.status, 'REGIME_RESEARCH_NOT_READY');
  assert.ok(regime.outcomeWindowIndependence.effectiveNonOverlappingWindowCount < 8);
  assert.ok(regime.blockers.includes('OOS_NON_OVERLAPPING_OUTCOME_WINDOWS_TOO_SMALL'));
});

test('one-instrument dominated regime evidence is rejected despite adequate raw sample', () => {
  const records = Array.from({ length: 80 }, (_, index) => record(index, {
    regime: 'RISK_ON',
    instrumentIndex: index < 40 ? 0 : 1 + ((index - 40) % 9),
  }));
  const regime = buildForecastRegimeLearningStatus({ records }).groups[0].regimes[0];
  assert.equal(regime.maturedSampleSize, 80);
  assert.equal(regime.instrumentConcentration.status, 'INSTRUMENT_DIVERSIFICATION_NOT_READY');
  assert.ok(regime.blockers.includes('OOS_SINGLE_INSTRUMENT_CONCENTRATION_TOO_HIGH'));
  assert.equal(regime.status, 'REGIME_RESEARCH_NOT_READY');
});

test('string probabilities are not coerced into the regime calibration sample', () => {
  const records = Array.from({ length: 80 }, (_, index) => record(index, { regime: 'RISK_ON', stringProbability: true }));
  const regime = buildForecastRegimeLearningStatus({ records }).groups[0].regimes[0];
  assert.equal(regime.metrics.probabilitySampleSize, 0);
  assert.equal(regime.calibration.sampleSize, 0);
  assert.ok(regime.blockers.includes('REGIME_STRICT_PROBABILITY_SAMPLE_INCOMPLETE'));
  assert.equal(regime.status, 'REGIME_RESEARCH_NOT_READY');
});

test('model version and horizon remain separate regime-learning lineages', () => {
  const records = [
    ...Array.from({ length: 70 }, (_, index) => record(index, { patternVersion: 'pattern-v1', horizon: 'month1', regime: 'RISK_ON', suffix: 'a' })),
    ...Array.from({ length: 70 }, (_, index) => record(100 + index, { patternVersion: 'pattern-v2', horizon: 'month1', regime: 'RISK_ON', suffix: 'b' })),
    ...Array.from({ length: 70 }, (_, index) => record(200 + index, { patternVersion: 'pattern-v1', horizon: 'month3', tradingDays: 63, spacingDays: 70, regime: 'RISK_ON', suffix: 'c' })),
  ];
  const status = buildForecastRegimeLearningStatus({ records });
  assert.equal(status.groupCount, 3);
  assert.deepEqual(
    status.groups.map((group) => [group.historicalPatternPolicyVersion, group.horizon]).sort(),
    [['pattern-v1', 'month1'], ['pattern-v1', 'month3'], ['pattern-v2', 'month1']],
  );
});

test('regime learning is permanently research-only even when every statistical gate passes', () => {
  const status = buildForecastRegimeLearningStatus({ records: readyRecords() });
  assert.equal(status.readyRegimeCount, 2);
  assert.equal(status.researchOnly, true);
  assert.equal(status.automaticRegimeWeightingEnabled, false);
  assert.equal(status.probabilityCalibrationEnabled, false);
  assert.equal(status.factorReweightingEnabled, false);
  assert.equal(status.decisionIntegrationEnabled, false);
  assert.equal(status.forecastMayInfluenceFinalAction, false);
  for (const group of status.groups) {
    assert.equal(group.automaticRegimeWeightingEnabled, false);
    assert.equal(group.forecastMayInfluenceFinalAction, false);
    for (const regime of group.regimes) {
      assert.equal(regime.probabilityCalibrationEnabled, false);
      assert.equal(regime.factorReweightingEnabled, false);
      assert.equal(regime.decisionIntegrationEnabled, false);
      assert.equal(regime.forecastMayInfluenceFinalAction, false);
    }
  }
});
