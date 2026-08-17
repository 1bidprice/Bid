import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProspectiveFrozenTarget,
  latestCompletedSessionDate,
  PROSPECTIVE_TARGET_BUILDER_CONTRACT,
} from '../src/forecast-prospective-target-builder.js';

function series(symbol, count = 1000, phase = 0, benchmark = false) {
  const start = Date.parse('2023-01-03T21:00:00.000Z') / 1000;
  const candles = [];
  let previous = benchmark ? 100 : 85 + phase;
  for (let i = 0; i < count; i += 1) {
    const level = benchmark
      ? 100 + i * 0.05 + 1.1 * Math.sin(i / 37)
      : 85 + phase + i * 0.025 + 7.5 * Math.sin(i / 15 + phase) + 2.3 * Math.sin(i / 5.1 + phase * 0.3);
    const close = Math.max(5, level);
    const open = (previous + close) / 2;
    candles.push({
      timestamp: start + i * 86_400,
      open,
      high: Math.max(open, close) * 1.008,
      low: Math.min(open, close) * 0.992,
      close,
      volume: 900_000 + ((i * 7919 + phase * 1000) % 300_000),
    });
    previous = close;
  }
  return { providerSymbol: symbol, symbol, source: 'TEST', sourceQuality: 'SECONDARY_VALIDATED', candles, usable: true };
}

function containsForbiddenOutcome(value) {
  const forbidden = new Set(['positiveOutcome', 'outcomeKnownAt', 'realisedOutcome', 'realizedOutcome', 'realisedReturnPct', 'realizedReturnPct']);
  if (Array.isArray(value)) return value.some(containsForbiddenOutcome);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => forbidden.has(key) || containsForbiddenOutcome(item));
}

test('v1832 target builder creates a current feature-only target from the latest completed candle', () => {
  const companySeries = series('AAA', 1000, 2, false);
  const benchmarkSeries = series('SPY', 1000, 0, true);
  const result = buildProspectiveFrozenTarget({
    company: { companyId: 'company:aaa', primaryListing: { symbol: 'AAA' } },
    series: companySeries,
    benchmarkSeries,
    horizon: 'week1',
    tradingDays: 5,
  });

  assert.equal(result.contract, PROSPECTIVE_TARGET_BUILDER_CONTRACT);
  assert.equal(result.status, 'PROSPECTIVE_TARGET_READY');
  assert.equal(result.ready, true);
  assert.equal(result.target.forecastAt, new Date(companySeries.candles.at(-1).timestamp * 1000).toISOString());
  assert.equal(result.target.horizon, 'week1');
  assert.equal(result.target.tradingDays, 5);
  assert.equal(result.target.historicalMarketFactorStatus, 'HISTORICAL_MARKET_FACTOR_READY');
  assert.ok(typeof result.target.rawProbabilityPositive === 'number');
  assert.ok(result.target.rawProbabilityPositive >= 0 && result.target.rawProbabilityPositive <= 1);
  assert.ok(typeof result.target.regimeKey === 'string' && result.target.regimeKey.length > 0);
  assert.equal(result.target.prospectiveResearchOnly, true);
  assert.equal(result.target.forecastMayInfluenceFinalAction, false);
  assert.equal(result.target.brokerExecutionEligible, false);
  assert.equal(result.target.decisionImpact, 'NONE');
  assert.equal(containsForbiddenOutcome(result.target), false);
});

test('v1832 target builder fails closed when history is too short', () => {
  const result = buildProspectiveFrozenTarget({
    company: { companyId: 'company:short', primaryListing: { symbol: 'SHORT' } },
    series: series('SHORT', 180, 1, false),
    benchmarkSeries: series('SPY', 1000, 0, true),
    horizon: 'month1',
    tradingDays: 21,
  });
  assert.equal(result.ready, false);
  assert.equal(result.status, 'PROSPECTIVE_TARGET_NOT_READY');
  assert.ok(result.blockers.includes('PROSPECTIVE_TARGET_PATTERN_NOT_READY'));
  assert.ok(result.blockers.includes('PROSPECTIVE_TARGET_MARKET_FACTOR_NOT_READY'));
});

test('latest completed session date is derived from the final retained daily candle', () => {
  const sample = series('AAA', 3, 1, false);
  assert.equal(latestCompletedSessionDate(sample), new Date(sample.candles.at(-1).timestamp * 1000).toISOString().slice(0, 10));
});
