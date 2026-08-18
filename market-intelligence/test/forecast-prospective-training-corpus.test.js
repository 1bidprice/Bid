import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrossSectionalRegimeWalkForwardResearch } from '../src/forecast-cross-sectional-regime-walk-forward.js';
import { buildHistoricalMarketStackResearch } from '../src/forecast-historical-market-stacked-ensemble-research.js';
import {
  PROSPECTIVE_TRAINING_CORPUS_CONTRACT,
  PROSPECTIVE_TRAINING_CORPUS_REFERENCE_SOURCE_COMMIT,
  buildProspectiveFrozenTrainingCorpus,
} from '../src/forecast-prospective-training-corpus.js';

function series(symbol, count, phase = 0, benchmark = false) {
  const start = Date.parse('2023-01-03T21:00:00.000Z') / 1000;
  const candles = [];
  let previous = benchmark ? 100 : 100 + phase * 3;
  for (let index = 0; index < count; index += 1) {
    const closeLevel = benchmark
      ? 100 + index * 0.04 + 0.45 * Math.sin((2 * Math.PI * index) / 160)
      : 100
        + phase * 3
        + index * 0.015
        + 8 * Math.sin((2 * Math.PI * index) / 80 + phase * 0.7)
        + 2 * Math.sin((2 * Math.PI * index) / 23 + phase * 0.37);
    const close = Number(Math.max(5, closeLevel).toFixed(6));
    const open = Number(((previous + close) / 2).toFixed(6));
    const high = Number((Math.max(open, close) * 1.008).toFixed(6));
    const low = Number((Math.min(open, close) * 0.992).toFixed(6));
    candles.push({
      timestamp: start + index * 86_400,
      open,
      high,
      low,
      close,
      volume: 1_000_000 + ((index * 7919 + phase * 31_337) % 350_000),
    });
    previous = close;
  }
  return { provider: 'TEST_FIXTURE', providerSymbol: symbol, symbol, candles };
}

function fixtureInstruments() {
  const benchmarkSeries = series('SPY', 1000, 0, true);
  return [
    {
      instrumentId: 'company:fixture-alpha',
      companyId: 'company:fixture-alpha',
      symbol: 'AAA',
      assetClass: 'EQUITY',
      series: series('AAA', 1000, 1),
      benchmarkSeries,
    },
    {
      instrumentId: 'company:fixture-beta',
      companyId: 'company:fixture-beta',
      symbol: 'BBB',
      assetClass: 'EQUITY',
      series: series('BBB', 1000, 2),
      benchmarkSeries,
    },
    {
      instrumentId: 'company:fixture-gamma',
      companyId: 'company:fixture-gamma',
      symbol: 'CCC',
      assetClass: 'EQUITY',
      series: series('CCC', 1000, 3),
      benchmarkSeries,
    },
    {
      instrumentId: 'company:fixture-delta',
      companyId: 'company:fixture-delta',
      symbol: 'DDD',
      assetClass: 'EQUITY',
      series: series('DDD', 1000, 4),
      benchmarkSeries,
    },
  ];
}

function scientificOptions() {
  return {
    horizons: { week1: 5, month1: 21 },
    warmupObservations: 320,
    evaluationStep: 7,
    minimumForecastsForMetrics: 20,
    minAnalogCount: 8,
    maxAnalogs: 30,
    minEffectiveSample: 4,
    sameInstrumentTrendRegimeOnly: true,
    minimumHistory: 200,
    periodsPerYear: 252,
    marketRegimeMinimumObservations: 200,
  };
}

test('prospective frozen training corpus reproduces the frozen cross-sectional stack research exactly', () => {
  const instruments = fixtureInstruments();
  const options = scientificOptions();
  const generatedAt = '2026-08-16T17:30:00.000Z';

  const frozenReference = buildCrossSectionalRegimeWalkForwardResearch({
    instruments,
    options,
    generatedAt,
  });
  const corpus = buildProspectiveFrozenTrainingCorpus({
    instruments,
    options,
    generatedAt,
  });
  const rebuiltStack = buildHistoricalMarketStackResearch(corpus.records, options);

  assert.equal(corpus.contract, PROSPECTIVE_TRAINING_CORPUS_CONTRACT);
  assert.equal(corpus.referenceSourceCommit, PROSPECTIVE_TRAINING_CORPUS_REFERENCE_SOURCE_COMMIT);
  assert.equal(corpus.instrumentCount, 4);
  assert.equal(corpus.generatedRecordCount, frozenReference.generatedRecordCount);
  assert.equal(corpus.validRegimeRecordCount, frozenReference.validRegimeRecordCount);
  assert.equal(corpus.regimeCoveragePct, Number(((frozenReference.validRegimeRecordCount / frozenReference.generatedRecordCount) * 100).toFixed(4)));
  assert.ok(corpus.validRegimeRecordCount > 0);
  assert.ok(frozenReference.historicalMarketStackResearch.predictionCount > 0, 'fixture must exercise actual stacked OOS predictions');
  assert.deepEqual(rebuiltStack, frozenReference.historicalMarketStackResearch);

  assert.equal(corpus.internalTrainingOnly, true);
  assert.equal(corpus.rawRecordsMayBePublished, false);
  assert.equal(corpus.rawHistoricalCandlesIncluded, false);
  assert.equal(corpus.prospectiveResearchOnly, true);
  assert.equal(corpus.automaticModelPromotionEnabled, false);
  assert.equal(corpus.decisionIntegrationEnabled, false);
  assert.equal(corpus.forecastMayInfluenceFinalAction, false);
  assert.equal(corpus.brokerExecutionEligible, false);
  assert.equal(corpus.decisionImpact, 'NONE');
});

test('prospective corpus fails closed on short histories instead of inventing training records', () => {
  const benchmarkSeries = series('SPY', 220, 0, true);
  const corpus = buildProspectiveFrozenTrainingCorpus({
    instruments: [{
      instrumentId: 'company:short',
      companyId: 'company:short',
      symbol: 'SHORT',
      assetClass: 'EQUITY',
      series: series('SHORT', 220, 2),
      benchmarkSeries,
    }],
    options: scientificOptions(),
    generatedAt: '2026-08-16T17:30:00.000Z',
  });

  assert.equal(corpus.generatedRecordCount, 0);
  assert.equal(corpus.validRegimeRecordCount, 0);
  assert.equal(corpus.records.length, 0);
  assert.ok(corpus.diagnostics.some((item) => item.code === 'HISTORICAL_WALK_FORWARD_SERIES_TOO_SHORT'));
});
