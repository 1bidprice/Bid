import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORICAL_MARKET_FACTOR_CONTRACT,
  buildHistoricalMarketFactorSnapshot,
} from '../src/forecast-historical-market-factor.js';

function candles(count, options = {}) {
  const start = Date.UTC(2020, 0, 2) / 1000;
  const drift = Number(options.drift ?? 0.001);
  const amplitude = Number(options.amplitude ?? 0.01);
  const base = Number(options.base ?? 100);
  return Array.from({ length: count }, (_, index) => {
    const cycle = Math.sin(index / 11) * amplitude;
    const close = base * Math.exp((drift * index) + cycle);
    return {
      timestamp: start + index * 86400,
      open: close * 0.998,
      high: close * 1.005,
      low: close * 0.995,
      close,
      volume: 1_000_000 + index * 100,
    };
  });
}

function input(companyCandles, benchmarkCandles, forecastIndex = 260, extra = {}) {
  return {
    instrumentId: 'TEST-EQUITY',
    assetClass: 'EQUITY',
    horizon: 'week1',
    symbol: 'TEST',
    series: { symbol: 'TEST', candles: companyCandles },
    benchmarkSeries: { symbol: 'BENCH', candles: benchmarkCandles },
    forecastAt: new Date(companyCandles[forecastIndex].timestamp * 1000).toISOString(),
    ...extra,
  };
}

test('historical market factor uses only company and benchmark candles at or before forecast time', () => {
  const company = candles(330, { drift: 0.0014 });
  const benchmark = candles(330, { drift: 0.0007, base: 200 });
  const original = buildHistoricalMarketFactorSnapshot(input(company, benchmark));
  assert.equal(original.contract, HISTORICAL_MARKET_FACTOR_CONTRACT);
  assert.equal(original.status, 'HISTORICAL_MARKET_FACTOR_READY');
  assert.ok(original.historicalMarketFactorScore >= -1 && original.historicalMarketFactorScore <= 1);
  assert.equal(original.domainContributions.length, 2);
  assert.deepEqual(original.domainContributions.map((item) => item.domain), ['MOMENTUM', 'RISK']);

  const mutatedCompany = company.map((candle, index) => index > 260 ? { ...candle, close: candle.close * 20 } : candle);
  const mutatedBenchmark = benchmark.map((candle, index) => index > 260 ? { ...candle, close: candle.close * 0.1 } : candle);
  const mutated = buildHistoricalMarketFactorSnapshot(input(mutatedCompany, mutatedBenchmark));

  assert.equal(mutated.historicalMarketFactorScore, original.historicalMarketFactorScore);
  assert.deepEqual(mutated.domainContributions, original.domainContributions);
  assert.equal(mutated.companyHistoryAsOf, original.companyHistoryAsOf);
  assert.equal(mutated.benchmarkHistoryAsOf, original.benchmarkHistoryAsOf);
  assert.ok(Date.parse(original.companyHistoryAsOf) <= Date.parse(original.forecastAt));
  assert.ok(Date.parse(original.benchmarkHistoryAsOf) <= Date.parse(original.forecastAt));
});

test('current fundamentals news and catalysts cannot influence historical market factor', () => {
  const company = candles(330, { drift: 0.0012 });
  const benchmark = candles(330, { drift: 0.0005, base: 180 });
  const baseline = buildHistoricalMarketFactorSnapshot(input(company, benchmark));
  const contaminated = buildHistoricalMarketFactorSnapshot(input(company, benchmark, 260, {
    currentFundamentals: { revenue: 9e99, netIncome: -9e99 },
    currentNews: [{ headline: 'future information' }],
    currentCatalysts: [{ confidence: 1 }],
    valuation: { score: 100 },
  }));

  assert.equal(contaminated.historicalMarketFactorScore, baseline.historicalMarketFactorScore);
  assert.equal(contaminated.fundamentalsBackfilled, false);
  assert.equal(contaminated.valuationBackfilled, false);
  assert.equal(contaminated.qualityBackfilled, false);
  assert.equal(contaminated.growthBackfilled, false);
  assert.equal(contaminated.catalystsBackfilled, false);
  assert.equal(contaminated.newsBackfilled, false);
  assert.equal(contaminated.liquidityUsedAsReturnFactor, false);
});

test('historical market factor fails closed without sufficient benchmark history', () => {
  const company = candles(330, { drift: 0.0012 });
  const benchmark = candles(120, { drift: 0.0006, base: 190 });
  const result = buildHistoricalMarketFactorSnapshot({
    ...input(company, candles(330), 260),
    benchmarkSeries: { symbol: 'BENCH', candles: benchmark },
  });

  assert.equal(result.status, 'HISTORICAL_MARKET_FACTOR_BLOCKED');
  assert.equal(result.historicalMarketFactorScore, null);
  assert.ok(result.blockers.includes('HISTORICAL_MARKET_FACTOR_BENCHMARK_HISTORY_TOO_SHORT'));
  assert.equal(result.decisionIntegrationEnabled, false);
  assert.equal(result.forecastMayInfluenceFinalAction, false);
  assert.equal(result.brokerExecutionEligible, false);
  assert.equal(result.decisionImpact, 'NONE');
});

test('historical market factor snapshot is compact raw-free and authority-free', () => {
  const result = buildHistoricalMarketFactorSnapshot(input(
    candles(330, { drift: 0.0013 }),
    candles(330, { drift: 0.0007, base: 210 }),
  ));
  const serialized = JSON.stringify(result);

  assert.equal(result.status, 'HISTORICAL_MARKET_FACTOR_READY');
  assert.equal(result.historicalResearchOnly, true);
  assert.equal(result.automaticModelPromotionEnabled, false);
  assert.equal(result.probabilityCalibrationEnabled, false);
  assert.equal(result.decisionIntegrationEnabled, false);
  assert.equal(result.forecastMayInfluenceFinalAction, false);
  assert.equal(result.finalActionEligible, false);
  assert.equal(result.brokerExecutionEligible, false);
  assert.equal(result.decisionImpact, 'NONE');
  assert.equal(serialized.includes('"candles"'), false);
  assert.equal(serialized.includes('currentFundamentals'), false);
  assert.equal(serialized.includes('currentNews'), false);
});
