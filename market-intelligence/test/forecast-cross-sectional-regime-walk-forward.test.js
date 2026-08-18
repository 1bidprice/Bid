import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrossSectionalRegimeWalkForwardResearch } from '../src/forecast-cross-sectional-regime-walk-forward.js';

const DAY = 86_400;

function series({ length = 620, start = Date.UTC(2022, 0, 1) / 1000, direction = 1, phase = 0, symbol = 'SYN' } = {}) {
  const candles = [];
  let close = direction > 0 ? 80 : 220;
  for (let index = 0; index < length; index += 1) {
    const wave = Math.sin((index + phase) / 9) * 0.45 + Math.sin((index + phase) / 31) * 0.2;
    const drift = direction * 0.11;
    close = Math.max(5, close + drift + wave * 0.12);
    candles.push({
      timestamp: start + index * DAY,
      open: close * 0.997,
      high: close * 1.006,
      low: close * 0.994,
      close,
      volume: 1_000_000 + ((index + phase) % 20) * 12_000,
    });
  }
  return { usable: true, source: 'SYNTHETIC_TEST', sourceQuality: 'CANONICAL', providerSymbol: symbol, candles };
}

function instrument(index, options = {}) {
  const direction = options.direction ?? 1;
  return {
    instrumentId: options.instrumentId || `instrument:${index}`,
    companyId: options.companyId || `company:${index}`,
    symbol: options.symbol || `SYM${index}`,
    assetClass: 'EQUITY',
    series: series({ direction: options.instrumentDirection ?? 1, phase: index * 3, symbol: `SYM${index}` }),
    benchmarkSeries: options.noBenchmark ? null : series({ direction, phase: options.benchmarkPhase ?? index, symbol: direction > 0 ? 'SPY' : 'BEAR' }),
    classificationSnapshot: options.classificationSnapshot || {
      contract: 'FORECAST_TIME_CLASSIFICATION_SNAPSHOT_V1',
      taxonomy: 'SEC_SIC',
      code: '6020',
      description: 'Modern classification that must not leak backwards',
    },
  };
}

function build(instruments, options = {}) {
  return buildCrossSectionalRegimeWalkForwardResearch({
    generatedAt: '2026-08-13T00:00:00.000Z',
    instruments,
    options: {
      horizons: { week1: 5 },
      warmupObservations: 260,
      evaluationStep: 5,
      minimumHistory: 200,
      minAnalogCount: 5,
      minEffectiveSample: 4,
      maxAnalogs: 30,
      minimumDistinctForecastDates: 5,
      minimumDistinctInstruments: 2,
      maximumSingleForecastDateSharePct: 100,
      minimumEffectiveNonOverlappingWindows: 3,
      maximumSingleInstrumentSharePct: 80,
      minimumEffectiveInstrumentCount: 1.5,
      minimumCalibrationSample: 20,
      includeAuditSamples: true,
      auditSampleLimit: 25,
      ...options,
    },
  });
}

function mutateSeriesAfter(input, cutoffIso, multiplier) {
  const cutoff = Date.parse(cutoffIso) / 1000;
  return {
    ...input,
    candles: input.candles.map((candle) => candle.timestamp > cutoff
      ? {
        ...candle,
        open: candle.open * multiplier,
        high: candle.high * multiplier,
        low: candle.low * multiplier,
        close: candle.close * multiplier,
        volume: candle.volume * Math.max(1, multiplier),
      }
      : { ...candle }),
  };
}

test('cross-sectional walk-forward creates matured historical OOS records with valid outcome windows only after per-instrument forecasts', () => {
  const status = build([instrument(0), instrument(1), instrument(2)]);
  assert.equal(status.evaluatedInstrumentCount, 3);
  assert.ok(status.generatedRecordCount > 0);
  assert.ok(status.validRegimeRecordCount > 0);
  assert.ok(status.groupCount > 0);
  assert.ok(status.instrumentSummaries.every((item) => item.generatedRecordCount > 0));
  assert.ok(status.auditSampleRecords.length > 0);
  assert.ok(status.auditSampleRecords.length <= 25);
  assert.ok(status.auditSampleRecords.every((record) => record.status === 'MATURED'));
  assert.ok(status.groups.some((group) => group.outcomeWindowIndependence.validWindowRecordCount > 0));
  assert.ok(status.groups.some((group) => group.outcomeWindowIndependence.invalidWindowRecordCount === 0));
  assert.equal(status.historicalResearchOnly, true);
  assert.equal(status.liveArchiveEligible, false);
  assert.equal(status.liveCalibrationEligible, false);
  assert.equal(status.decisionIntegrationEnabled, false);
  assert.equal(status.forecastMayInfluenceFinalAction, false);
  assert.equal(status.brokerExecutionEligible, false);
});

test('historical market factor lineage is attached only from forecast-time market history', () => {
  const status = build([instrument(0), instrument(1)]);
  assert.ok(status.historicalMarketFactorReadyRecordCount > 0);
  assert.equal(status.historicalMarketFactorReadyRecordCount + status.historicalMarketFactorBlockedRecordCount, status.generatedRecordCount);
  assert.ok(status.instrumentSummaries.every((item) => item.historicalMarketFactorReadyRecordCount + item.historicalMarketFactorBlockedRecordCount === item.generatedRecordCount));
  const readyRecords = status.auditSampleRecords.filter((record) => record.historicalMarketFactorStatus === 'HISTORICAL_MARKET_FACTOR_READY');
  assert.ok(readyRecords.length > 0);
  for (const record of readyRecords) {
    assert.equal(typeof record.historicalMarketFactorScore, 'number');
    assert.ok(record.historicalMarketFactorScore >= -1 && record.historicalMarketFactorScore <= 1);
    assert.ok(record.historicalMarketFactorPolicyVersion);
    assert.equal(record.historicalMarketFactorSnapshot.usesOnlyMarketHistoryAvailableAtForecastTime, true);
    assert.ok(Date.parse(record.historicalMarketFactorSnapshot.companyHistoryAsOf) <= Date.parse(record.forecastAt));
    assert.ok(Date.parse(record.historicalMarketFactorSnapshot.benchmarkHistoryAsOf) <= Date.parse(record.forecastAt));
    assert.deepEqual(record.historicalMarketFactorSnapshot.domainContributions.map((item) => item.domain), ['MOMENTUM', 'RISK']);
    assert.equal(record.historicalMarketFactorSnapshot.fundamentalsBackfilled, false);
    assert.equal(record.historicalMarketFactorSnapshot.valuationBackfilled, false);
    assert.equal(record.historicalMarketFactorSnapshot.qualityBackfilled, false);
    assert.equal(record.historicalMarketFactorSnapshot.growthBackfilled, false);
    assert.equal(record.historicalMarketFactorSnapshot.catalystsBackfilled, false);
    assert.equal(record.historicalMarketFactorSnapshot.newsBackfilled, false);
    assert.equal(record.historicalMarketFactorSnapshot.liquidityUsedAsReturnFactor, false);
  }
  assert.deepEqual(status.methodology.historicalMarketFactorAllowedDomains, ['MOMENTUM', 'RISK']);
  assert.equal(status.methodology.historicalMarketFactorFundamentalBackfillAllowed, false);
});

test('future company and benchmark mutations cannot change an already-issued historical market factor', () => {
  const originalInstrument = instrument(0);
  const original = build([originalInstrument]);
  const target = original.auditSampleRecords.find((record) => record.historicalMarketFactorStatus === 'HISTORICAL_MARKET_FACTOR_READY');
  assert.ok(target);

  const mutatedInstrument = {
    ...originalInstrument,
    series: mutateSeriesAfter(originalInstrument.series, target.forecastAt, 25),
    benchmarkSeries: mutateSeriesAfter(originalInstrument.benchmarkSeries, target.forecastAt, 0.08),
  };
  const mutated = build([mutatedInstrument]);
  const sameForecast = mutated.auditSampleRecords.find((record) => record.forecastId === target.forecastId);
  assert.ok(sameForecast);
  assert.equal(sameForecast.historicalMarketFactorStatus, 'HISTORICAL_MARKET_FACTOR_READY');
  assert.equal(sameForecast.historicalMarketFactorScore, target.historicalMarketFactorScore);
  assert.deepEqual(sameForecast.historicalMarketFactorSnapshot.domainContributions, target.historicalMarketFactorSnapshot.domainContributions);
  assert.equal(sameForecast.historicalMarketFactorSnapshot.companyHistoryAsOf, target.historicalMarketFactorSnapshot.companyHistoryAsOf);
  assert.equal(sameForecast.historicalMarketFactorSnapshot.benchmarkHistoryAsOf, target.historicalMarketFactorSnapshot.benchmarkHistoryAsOf);
});

test('historical regime reconstruction never uses benchmark data after the forecast timestamp', () => {
  const status = build([instrument(0), instrument(1)]);
  const records = status.auditSampleRecords;
  assert.ok(records.length > 0);
  for (const record of records.filter((item) => item.marketRegimeSnapshot)) {
    assert.ok(Date.parse(record.marketRegimeSnapshot.benchmarkAsOf) <= Date.parse(record.forecastAt));
    assert.ok(Date.parse(record.marketRegimeSnapshot.capturedAt) <= Date.parse(record.forecastAt));
    assert.ok(Date.parse(record.realisedOutcome.timestamp) > Date.parse(record.forecastAt));
  }
});

test('current classification and current non-market inputs are never copied into historical walk-forward records', () => {
  const contaminated = instrument(0);
  contaminated.currentFundamentals = { revenue: 999999999999 };
  contaminated.currentNews = [{ headline: 'future news must not leak' }];
  contaminated.currentCatalysts = [{ type: 'future catalyst' }];
  contaminated.currentValuation = { score: 100 };
  const status = build([contaminated, instrument(1)]);
  const serialized = JSON.stringify(status.auditSampleRecords);
  assert.equal(serialized.includes('classificationSnapshot'), false);
  assert.equal(serialized.includes('Modern classification that must not leak backwards'), false);
  assert.equal(serialized.includes('future news must not leak'), false);
  assert.equal(serialized.includes('future catalyst'), false);
  assert.equal(serialized.includes('999999999999'), false);
  assert.equal(status.methodology.historicalClassificationBackfillAllowed, false);
  assert.equal(status.methodology.historicalMarketFactorFundamentalBackfillAllowed, false);
});

test('missing historical benchmark leaves regime and historical market factor explicitly unavailable', () => {
  const status = build([instrument(0, { noBenchmark: true })]);
  assert.ok(status.generatedRecordCount > 0);
  assert.equal(status.validRegimeRecordCount, 0);
  assert.equal(status.groupCount, 0);
  assert.equal(status.regimeUnavailableRecordCount, status.generatedRecordCount);
  assert.equal(status.historicalMarketFactorReadyRecordCount, 0);
  assert.equal(status.historicalMarketFactorBlockedRecordCount, status.generatedRecordCount);
  assert.ok(status.auditSampleRecords.length > 0);
  assert.ok(status.auditSampleRecords.every((record) => record.regimeStatus === 'REGIME_NOT_AVAILABLE'));
  assert.ok(status.auditSampleRecords.every((record) => record.historicalMarketFactorStatus === 'HISTORICAL_MARKET_FACTOR_BLOCKED'));
  assert.ok(status.auditSampleRecords.every((record) => record.historicalMarketFactorScore === null));
});

test('bull and bear benchmark histories produce separate native historical regime research groups', () => {
  const status = build([
    instrument(0, { direction: 1 }),
    instrument(1, { direction: 1 }),
    instrument(2, { direction: -1 }),
    instrument(3, { direction: -1 }),
  ]);
  const regimeKeys = new Set(status.groups.map((group) => group.regimeKey));
  assert.ok(regimeKeys.size >= 2);
  assert.ok(status.groups.some((group) => group.riskTone === 'RISK_ON' || group.trendRegime === 'BULL_TREND'));
  assert.ok(status.groups.some((group) => group.riskTone === 'RISK_OFF' || group.trendRegime === 'BEAR_TREND'));
});

test('instrument/date/window independence remains a hard blocker for concentrated historical evidence', () => {
  const duplicated = Array.from({ length: 4 }, () => instrument(0, { instrumentId: 'same-instrument', companyId: 'same-company' }));
  const status = build(duplicated, { minimumDistinctInstruments: 3, minimumEffectiveInstrumentCount: 2 });
  assert.ok(status.groups.length > 0);
  assert.ok(status.groups.every((group) => group.status === 'HISTORICAL_REGIME_RESEARCH_NOT_READY'));
  assert.ok(status.groups.some((group) => group.sampleIndependence.blockers.includes('OOS_DISTINCT_INSTRUMENTS_TOO_SMALL')));
  assert.ok(status.groups.some((group) => group.instrumentConcentration.blockers.length > 0));
});

test('historical evidence is explicitly WALK_FORWARD_OOS and can never masquerade as live shadow OOS', () => {
  const status = build([instrument(0), instrument(1)]);
  const records = status.auditSampleRecords;
  assert.ok(records.length > 0);
  assert.ok(records.every((record) => record.validationMode === 'WALK_FORWARD_OOS'));
  assert.ok(records.every((record) => record.evidenceClass === 'HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH'));
  assert.ok(records.every((record) => record.liveArchiveEligible === false && record.liveCalibrationEligible === false));
  assert.equal(JSON.stringify(records).includes('LIVE_SHADOW_OOS'), false);
  assert.equal(JSON.stringify(records).includes('"latentFactorScore"'), false);
});

test('raw historical records are omitted by default and audit samples are explicit and bounded', () => {
  const status = buildCrossSectionalRegimeWalkForwardResearch({
    generatedAt: '2026-08-13T00:00:00.000Z',
    instruments: [instrument(0), instrument(1)],
    options: {
      horizons: { week1: 5 },
      warmupObservations: 260,
      minimumHistory: 200,
      minAnalogCount: 5,
      minEffectiveSample: 4,
    },
  });
  assert.deepEqual(status.auditSampleRecords, []);
  assert.equal(Object.prototype.hasOwnProperty.call(status, 'researchRecords'), false);
  assert.equal(status.methodology.rawHistoricalRecordExportDefault, 'DISABLED');
});

test('historical market factor audit lineage remains compact and raw-candle free', () => {
  const status = build([instrument(0), instrument(1)]);
  const text = JSON.stringify(status.auditSampleRecords);
  assert.equal(text.includes('"candles"'), false);
  assert.equal(text.includes('currentFundamentals'), false);
  assert.equal(text.includes('currentNews'), false);
  assert.ok(status.auditSampleRecords.some((record) => record.historicalMarketFactorSnapshot));
});

test('research output never creates final actions, broker authority or live-archive mutation instructions', () => {
  const status = build([instrument(0), instrument(1), instrument(2)]);
  const text = JSON.stringify(status);
  assert.equal(status.automaticModelPromotionEnabled, false);
  assert.equal(status.probabilityCalibrationEnabled, false);
  assert.equal(status.decisionIntegrationEnabled, false);
  assert.equal(status.forecastMayInfluenceFinalAction, false);
  assert.equal(status.finalActionEligible, false);
  assert.equal(status.brokerExecutionEligible, false);
  assert.equal(text.includes('BUY_NOW'), false);
  assert.equal(text.includes('SELL_NOW'), false);
  assert.equal(text.includes('automaticBrokerOrder'), false);
  assert.equal(text.includes('appendToLiveArchive'), false);
});