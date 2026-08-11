import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildForecastMarketRegimeSnapshot,
  validateForecastMarketRegimeSnapshot,
} from '../src/forecast-market-regime.js';

const DAY_SECONDS = 86_400;
const START = Date.UTC(2024, 0, 1) / 1000;

function candlesFromCloses(closes) {
  return closes.map((close, index) => ({
    timestamp: START + index * DAY_SECONDS,
    open: close,
    high: close * 1.002,
    low: close * 0.998,
    close,
    volume: 1_000_000,
  }));
}

function smoothRiskOnSeries() {
  const closes = [];
  let value = 100;
  for (let index = 0; index < 210; index += 1) {
    const shock = index % 4 === 0 ? 0.025 : index % 4 === 1 ? -0.018 : index % 4 === 2 ? 0.015 : -0.01;
    value *= 1 + shock;
    closes.push(value);
  }
  for (let index = 0; index < 70; index += 1) {
    value *= 1.0025;
    closes.push(value);
  }
  return { usable: true, symbol: 'SPY', providerSymbol: 'SPY', source: 'synthetic benchmark', sourceQuality: 'TEST', candles: candlesFromCloses(closes) };
}

function stressedRiskOffSeries() {
  const closes = [];
  let value = 150;
  for (let index = 0; index < 220; index += 1) {
    value *= 1 + (index % 2 === 0 ? 0.002 : -0.0015);
    closes.push(value);
  }
  for (let index = 0; index < 70; index += 1) {
    const shock = index % 2 === 0 ? -0.035 : 0.012;
    value *= 1 + shock;
    closes.push(value);
  }
  return { usable: true, symbol: 'SPY', providerSymbol: 'SPY', source: 'synthetic benchmark', sourceQuality: 'TEST', candles: candlesFromCloses(closes) };
}

function captureAt(series) {
  return new Date(series.candles.at(-1).timestamp * 1000).toISOString();
}

test('smooth positive benchmark regime becomes research-ready risk-on context', () => {
  const series = smoothRiskOnSeries();
  const snapshot = buildForecastMarketRegimeSnapshot({ series, capturedAt: captureAt(series) });
  assert.equal(snapshot.status, 'REGIME_READY');
  assert.equal(snapshot.trendRegime, 'BULL_TREND');
  assert.equal(snapshot.momentumRegime, 'POSITIVE_MOMENTUM');
  assert.equal(snapshot.volatilityRegime, 'LOW_VOLATILITY');
  assert.equal(snapshot.riskTone, 'RISK_ON');
  assert.equal(snapshot.researchOnly, true);
  assert.equal(snapshot.finalActionEligible, false);
  assert.equal(snapshot.decisionImpact, 'NONE');
  assert.equal(validateForecastMarketRegimeSnapshot(snapshot, { forecastAt: snapshot.capturedAt }).ok, true);
});

test('falling high-volatility benchmark becomes risk-off context', () => {
  const series = stressedRiskOffSeries();
  const snapshot = buildForecastMarketRegimeSnapshot({ series, capturedAt: captureAt(series) });
  assert.equal(snapshot.status, 'REGIME_READY');
  assert.equal(snapshot.trendRegime, 'BEAR_TREND');
  assert.equal(snapshot.momentumRegime, 'NEGATIVE_MOMENTUM');
  assert.equal(snapshot.volatilityRegime, 'HIGH_VOLATILITY');
  assert.equal(snapshot.riskTone, 'RISK_OFF');
});

test('future benchmark candles are excluded by the forecast-time cutoff', () => {
  const base = smoothRiskOnSeries();
  const capturedAt = captureAt(base);
  const future = {
    ...base,
    candles: [
      ...base.candles,
      {
        timestamp: base.candles.at(-1).timestamp + DAY_SECONDS,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1_000_000,
      },
    ],
  };
  const withoutFuture = buildForecastMarketRegimeSnapshot({ series: base, capturedAt });
  const withFuture = buildForecastMarketRegimeSnapshot({ series: future, capturedAt });
  assert.equal(withFuture.observationCount, withoutFuture.observationCount);
  assert.equal(withFuture.benchmarkAsOf, withoutFuture.benchmarkAsOf);
  assert.deepEqual(withFuture.metrics, withoutFuture.metrics);
  assert.equal(withFuture.regimeKey, withoutFuture.regimeKey);
});

test('short benchmark history fails closed without manufacturing a regime', () => {
  const closes = Array.from({ length: 120 }, (_, index) => 100 + index * 0.2);
  const series = { usable: true, symbol: 'SPY', candles: candlesFromCloses(closes) };
  const snapshot = buildForecastMarketRegimeSnapshot({ series, capturedAt: captureAt(series) });
  assert.equal(snapshot.status, 'REGIME_NOT_READY');
  assert.equal(snapshot.regimeKey, null);
  assert.equal(snapshot.riskTone, null);
  assert.ok(snapshot.blockers.includes('MARKET_REGIME_HISTORY_TOO_SHORT'));
});

test('snapshot validation rejects regime data captured after the forecast', () => {
  const series = smoothRiskOnSeries();
  const snapshot = buildForecastMarketRegimeSnapshot({ series, capturedAt: captureAt(series) });
  const forecastAt = new Date(new Date(snapshot.capturedAt).getTime() - DAY_SECONDS * 1000).toISOString();
  const validation = validateForecastMarketRegimeSnapshot(snapshot, { forecastAt });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes('MARKET_REGIME_CAPTURE_AFTER_FORECAST'));
  assert.ok(validation.errors.includes('MARKET_REGIME_DATA_AFTER_FORECAST'));
});

test('snapshot validation rejects decision authority or non-research usage', () => {
  const series = smoothRiskOnSeries();
  const snapshot = buildForecastMarketRegimeSnapshot({ series, capturedAt: captureAt(series) });
  const invalid = {
    ...snapshot,
    researchOnly: false,
    finalActionEligible: true,
    decisionImpact: 'BUY',
  };
  const validation = validateForecastMarketRegimeSnapshot(invalid, { forecastAt: snapshot.capturedAt });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes('MARKET_REGIME_RESEARCH_ONLY_REQUIRED'));
  assert.ok(validation.errors.includes('MARKET_REGIME_FINAL_ACTION_FORBIDDEN'));
  assert.ok(validation.errors.includes('MARKET_REGIME_DECISION_IMPACT_FORBIDDEN'));
});
