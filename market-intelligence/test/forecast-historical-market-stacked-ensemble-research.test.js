import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoricalMarketStackResearch } from '../src/forecast-historical-market-stacked-ensemble-research.js';

const DAY_MS = 86_400_000;
const START_MS = Date.UTC(2020, 0, 2);
const RISK_ON = 'RISK_ON|BULL_TREND|LOW_VOLATILITY|POSITIVE_MOMENTUM';
const RISK_OFF = 'RISK_OFF|BEAR_TREND|HIGH_VOLATILITY|NEGATIVE_MOMENTUM';

function record(index, options = {}) {
  const forecastMs = START_MS + index * DAY_MS;
  const outcomeMs = forecastMs + Number(options.outcomeDelayDays ?? 2) * DAY_MS;
  const outcome = options.positiveOutcome ?? (index % 2);
  const factorScore = options.factorScore ?? (outcome === 1 ? 1 : -1);
  return {
    forecastId: options.forecastId || `historical:${options.regimeKey || RISK_ON}:${index}`,
    validationMode: 'WALK_FORWARD_OOS',
    evidenceClass: 'HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH',
    status: 'MATURED',
    historicalPatternPolicyVersion: options.patternVersion || 'pattern-v1',
    historicalMarketFactorPolicyVersion: options.factorVersion || 'market-factor-v1',
    historicalMarketFactorStatus: 'HISTORICAL_MARKET_FACTOR_READY',
    instrumentId: options.instrumentId || `instrument:${index % Number(options.instrumentCount || 12)}`,
    companyId: options.instrumentId || `instrument:${index % Number(options.instrumentCount || 12)}`,
    assetClass: 'EQUITY',
    horizon: options.horizon || 'week1',
    tradingDays: Number(options.tradingDays || 5),
    regimeKey: options.regimeKey || RISK_ON,
    forecastAt: new Date(forecastMs).toISOString(),
    forecastSampleDate: new Date(forecastMs).toISOString().slice(0, 10),
    outcomeKnownAt: new Date(outcomeMs).toISOString(),
    referencePrice: { timestamp: new Date(forecastMs).toISOString(), value: 100 },
    realisedOutcome: { timestamp: new Date(outcomeMs).toISOString(), close: outcome ? 101 : 99 },
    rawProbabilityPositive: options.rawProbabilityPositive ?? 0.5,
    historicalMarketFactorScore: factorScore,
    positiveOutcome: outcome,
  };
}

function strongRecords(count = 520, options = {}) {
  return Array.from({ length: count }, (_, index) => record(index, {
    ...options,
    positiveOutcome: index % 2,
    factorScore: index % 2 ? 1 : -1,
    rawProbabilityPositive: 0.5,
  }));
}

const strongOptions = {
  ensembleMinimumTrainingSample: 60,
  ensembleMinimumTrainingClassCount: 15,
  ensembleL2Penalty: 0.001,
  ensembleLearningRate: 0.1,
  ensembleMaxIterations: 900,
};

test('strong leakage-safe market factor can satisfy the full historical predictive stack gate', () => {
  const result = buildHistoricalMarketStackResearch(strongRecords(), strongOptions);
  assert.equal(result.groupCount, 1);
  assert.equal(result.predictiveReadyGroupCount, 1);
  const group = result.groups[0];
  assert.equal(group.status, 'HISTORICAL_MARKET_STACK_PREDICTIVE_READY');
  assert.ok(group.sampleSize >= 200);
  assert.ok(group.ensembleMetrics.skillVsBaseRatePct >= 5);
  assert.ok(group.ensembleMetrics.expectedCalibrationError <= 0.08);
  assert.ok(group.brierImprovementVsRawPatternPct >= 3);
  assert.ok(group.logLossImprovementVsRawPatternPct >= 0);
  assert.equal(group.sampleIndependence.status, 'INDEPENDENCE_READY');
  assert.equal(group.outcomeWindowIndependence.status, 'WINDOW_INDEPENDENCE_READY');
  assert.equal(group.instrumentConcentration.status, 'INSTRUMENT_DIVERSIFICATION_READY');
  assert.equal(group.chronologicalStability.status, 'CHRONOLOGICAL_STABILITY_READY');
  assert.ok(group.chronologicalStability.blocks.every((block) => block.ready));
  assert.deepEqual(group.blockers, []);
});

test('uninformative market factor cannot manufacture predictive skill from a flat raw pattern baseline', () => {
  const input = Array.from({ length: 520 }, (_, index) => record(index, {
    positiveOutcome: index % 2,
    factorScore: 0,
    rawProbabilityPositive: 0.5,
  }));
  const result = buildHistoricalMarketStackResearch(input, strongOptions);
  const group = result.groups[0];
  assert.equal(result.predictiveReadyGroupCount, 0);
  assert.equal(group.status, 'HISTORICAL_MARKET_STACK_PREDICTIVE_NOT_READY');
  assert.ok(group.blockers.includes('HISTORICAL_MARKET_STACK_PROBABILISTIC_SKILL_TOO_SMALL'));
  assert.ok(group.blockers.includes('HISTORICAL_MARKET_STACK_BRIER_IMPROVEMENT_TOO_SMALL'));
});

test('late chronological reversal blocks an apparently useful aggregate market factor', () => {
  const input = Array.from({ length: 600 }, (_, index) => {
    const outcome = index % 2;
    const aligned = index < 420;
    return record(index, {
      positiveOutcome: outcome,
      factorScore: aligned ? (outcome ? 1 : -1) : (outcome ? -1 : 1),
      rawProbabilityPositive: 0.5,
    });
  });
  const result = buildHistoricalMarketStackResearch(input, strongOptions);
  const group = result.groups[0];
  assert.equal(group.status, 'HISTORICAL_MARKET_STACK_PREDICTIVE_NOT_READY');
  assert.equal(group.chronologicalStability.status, 'CHRONOLOGICAL_STABILITY_NOT_READY');
  assert.ok(group.chronologicalStability.blocks.some((block) => block.ready === false));
  assert.ok(group.blockers.includes('HISTORICAL_MARKET_STACK_CHRONOLOGICAL_STABILITY_NOT_READY'));
});

test('raw volume below 200 target predictions remains blocked even with perfect factor ordering', () => {
  const result = buildHistoricalMarketStackResearch(strongRecords(190), strongOptions);
  const group = result.groups[0];
  assert.ok(group.sampleSize < 200);
  assert.equal(group.status, 'HISTORICAL_MARKET_STACK_PREDICTIVE_NOT_READY');
  assert.ok(group.blockers.includes('HISTORICAL_MARKET_STACK_PREDICTION_SAMPLE_TOO_SMALL'));
});

test('pattern factor horizon and regime lineages remain separate in historical stack evaluation', () => {
  const first = strongRecords(360, { regimeKey: RISK_ON });
  const second = strongRecords(360, { regimeKey: RISK_OFF }).map((item, index) => ({
    ...item,
    forecastId: `risk-off:${index}`,
    regimeKey: RISK_OFF,
  }));
  const result = buildHistoricalMarketStackResearch([...first, ...second], strongOptions);
  assert.equal(result.groupCount, 2);
  assert.deepEqual(new Set(result.groups.map((group) => group.regimeKey)), new Set([RISK_ON, RISK_OFF]));
  assert.ok(result.groups.every((group) => group.historicalPatternPolicyVersion === 'pattern-v1'));
  assert.ok(result.groups.every((group) => group.historicalMarketFactorPolicyVersion === 'market-factor-v1'));
});

test('historical market stack thresholds cannot be loosened below the locked scientific floors', () => {
  const result = buildHistoricalMarketStackResearch(strongRecords(), {
    ...strongOptions,
    minimumEvaluationSample: 20,
    minimumClassCount: 5,
    minimumSkillPct: -50,
    maximumEce: 1,
    minimumBrierImprovementPct: -10,
    minimumLogLossImprovementPct: -20,
    minimumEceImprovement: -1,
    minimumDistinctForecastDates: 2,
    minimumDistinctInstruments: 2,
    maximumSingleForecastDateSharePct: 100,
    minimumEffectiveNonOverlappingWindows: 2,
    maximumSingleInstrumentSharePct: 100,
    minimumEffectiveInstrumentCount: 1,
  });
  const thresholds = result.groups[0].thresholds;
  assert.equal(thresholds.minimumEvaluationSample, 200);
  assert.equal(thresholds.minimumClassCount, 40);
  assert.equal(thresholds.minimumSkillPct, 5);
  assert.equal(thresholds.maximumEce, 0.08);
  assert.equal(thresholds.minimumBrierImprovementPct, 3);
  assert.equal(thresholds.minimumLogLossImprovementPct, 0);
  assert.equal(thresholds.minimumEceImprovement, -0.01);
  assert.equal(thresholds.minimumDistinctForecastDates, 40);
  assert.equal(thresholds.minimumDistinctInstruments, 10);
  assert.equal(thresholds.maximumSingleForecastDateSharePct, 10);
  assert.equal(thresholds.minimumEffectiveNonOverlappingWindows, 12);
  assert.equal(thresholds.maximumSingleInstrumentSharePct, 25);
  assert.equal(thresholds.minimumEffectiveInstrumentCount, 6);
});

test('historical market stack output exports no raw predictions and grants zero authority even when ready', () => {
  const result = buildHistoricalMarketStackResearch(strongRecords(), strongOptions);
  const serialized = JSON.stringify(result);
  assert.equal(result.predictiveReadyGroupCount, 1);
  assert.equal(result.rawPredictionsIncluded, false);
  assert.equal(result.rawHistoricalRecordsIncluded, false);
  assert.equal(result.rawHistoricalCandlesIncluded, false);
  assert.equal(result.taxonomyPromotionEligible, false);
  assert.equal(result.historicalResearchOnly, true);
  assert.equal(result.automaticModelPromotionEnabled, false);
  assert.equal(result.probabilityCalibrationEnabled, false);
  assert.equal(result.decisionIntegrationEnabled, false);
  assert.equal(result.forecastMayInfluenceFinalAction, false);
  assert.equal(result.finalActionEligible, false);
  assert.equal(result.brokerExecutionEligible, false);
  assert.equal(result.decisionImpact, 'NONE');
  assert.equal(serialized.includes('"predictions"'), false);
  assert.equal(serialized.includes('"candles"'), false);
  assert.equal(serialized.includes('LIVE_SHADOW_OOS'), false);
});
