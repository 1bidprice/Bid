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
      ...options,
    },
  });
}

function allGroupRecords(status) {
  return status.groups.flatMap((group) => group.sampleRecords || []);
}

test('cross-sectional walk-forward creates historical OOS records only after per-instrument forecasts', () => {
  const status = build([instrument(0), instrument(1), instrument(2)]);
  assert.equal(status.evaluatedInstrumentCount, 3);
  assert.ok(status.generatedRecordCount > 0);
  assert.ok(status.validRegimeRecordCount > 0);
  assert.ok(status.groupCount > 0);
  assert.ok(status.instrumentSummaries.every((item) => item.generatedRecordCount > 0));
  assert.equal(status.historicalResearchOnly, true);
  assert.equal(status.liveArchiveEligible, false);
  assert.equal(status.liveCalibrationEligible, false);
  assert.equal(status.decisionIntegrationEnabled, false);
  assert.equal(status.forecastMayInfluenceFinalAction, false);
  assert.equal(status.brokerExecutionEligible, false);
});

test('historical regime reconstruction never uses benchmark data after the forecast timestamp', () => {
  const status = build([instrument(0), instrument(1)]);
  const records = status.researchRecords || [];
  assert.ok(records.length > 0);
  for (const record of records.filter((item) => item.marketRegimeSnapshot)) {
    assert.ok(Date.parse(record.marketRegimeSnapshot.benchmarkAsOf) <= Date.parse(record.forecastAt));
    assert.ok(Date.parse(record.marketRegimeSnapshot.capturedAt) <= Date.parse(record.forecastAt));
    assert.ok(Date.parse(record.realisedOutcome.timestamp) > Date.parse(record.forecastAt));
  }
});

test('current classification input is never copied into historical walk-forward records', () => {
  const status = build([instrument(0), instrument(1)]);
  const serialized = JSON.stringify(status.researchRecords || []);
  assert.equal(serialized.includes('classificationSnapshot'), false);
  assert.equal(serialized.includes('Modern classification that must not leak backwards'), false);
  assert.equal(status.methodology.historicalClassificationBackfillAllowed, false);
});

test('missing historical benchmark leaves records explicitly regime-unavailable instead of inventing a regime', () => {
  const status = build([instrument(0, { noBenchmark: true })]);
  assert.ok(status.generatedRecordCount > 0);
  assert.equal(status.validRegimeRecordCount, 0);
  assert.equal(status.groupCount, 0);
  assert.equal(status.regimeUnavailableRecordCount, status.generatedRecordCount);
  assert.ok((status.researchRecords || []).every((record) => record.regimeStatus === 'REGIME_NOT_AVAILABLE'));
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
  const records = status.researchRecords || [];
  assert.ok(records.length > 0);
  assert.ok(records.every((record) => record.validationMode === 'WALK_FORWARD_OOS'));
  assert.ok(records.every((record) => record.evidenceClass === 'HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH'));
  assert.ok(records.every((record) => record.liveArchiveEligible === false && record.liveCalibrationEligible === false));
  assert.equal(JSON.stringify(records).includes('LIVE_SHADOW_OOS'), false);
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
