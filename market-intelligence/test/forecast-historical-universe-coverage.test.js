import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistoricalWalkForwardRuntimeInstrumentSet,
  FORECAST_HISTORICAL_UNIVERSE_COVERAGE_CONTRACT,
} from '../src/forecast-cross-sectional-regime-walk-forward-runtime.js';

function series(length = 80, source = 'SYNTHETIC_TEST') {
  return {
    usable: true,
    source,
    sourceQuality: 'CANONICAL',
    candles: Array.from({ length }, (_, index) => ({ timestamp: 1_700_000_000 + index * 86_400, close: 100 + index })),
  };
}

function dossier(companyId, symbol = null) {
  return {
    ...(companyId ? { companyId } : {}),
    instrumentProfile: {
      instrumentId: companyId ? `instrument:${companyId}` : 'instrument:missing',
      assetClass: 'EQUITY',
      primaryListing: { symbol: symbol || companyId || 'MISSING' },
    },
  };
}

test('coverage diagnostics explain exclusions and loaded histories while preserving selection', () => {
  const histories = new Map([
    ['company:1', series(120)],
    ['company:3', { usable: true, source: 'EMPTY_TEST', sourceQuality: 'CANONICAL', candles: [] }],
    ['company:4', series(140, 'LOADED_WITHOUT_DOSSIER')],
  ]);
  const benchmarks = new Map([['company:1', series(150, 'BENCHMARK')]]);
  const set = buildHistoricalWalkForwardRuntimeInstrumentSet({
    researchDossiers: [
      dossier('company:1', 'ONE'),
      dossier('company:2', 'TWO'),
      dossier('company:3', 'THREE'),
      dossier('company:1', 'ONE-DUP'),
      dossier(null, 'NO-ID'),
    ],
    historicalSeriesByCompany: histories,
    benchmarkSeriesByCompany: benchmarks,
    maximumInstrumentCount: 24,
  });

  assert.equal(set.eligibleInstrumentCount, 1);
  assert.equal(set.selectedInstrumentCount, 1);
  assert.deepEqual(set.selectedInstruments.map((item) => item.companyId), ['company:1']);

  const coverage = set.universeCoverage;
  assert.equal(coverage.contract, FORECAST_HISTORICAL_UNIVERSE_COVERAGE_CONTRACT);
  assert.equal(coverage.dossierCount, 5);
  assert.equal(coverage.uniqueDossierCompanyCount, 3);
  assert.equal(coverage.loadedHistoricalSeriesCount, 3);
  assert.equal(coverage.loadedBenchmarkSeriesCount, 1);
  assert.equal(coverage.loadedHistoryWithoutDossierCount, 1);
  assert.deepEqual(coverage.exclusionReasonCounts, {
    HISTORICAL_SERIES_MISSING: 1,
    HISTORICAL_CANDLES_MISSING_OR_EMPTY: 1,
    DUPLICATE_ACCEPTED_COMPANY_ID: 1,
    COMPANY_ID_MISSING: 1,
  });
  assert.deepEqual(coverage.loadedHistoriesWithoutDossier.map((item) => item.companyId), ['company:4']);
  assert.equal(coverage.rawHistoricalCandlesIncluded, false);
  assert.equal(coverage.selectionRulesChanged, false);
  assert.equal(coverage.thresholdsChanged, false);
  assert.equal(coverage.networkFetchPerformed, false);
});

test('coverage diagnostics separate hard-bound omission from data exclusions', () => {
  const histories = new Map();
  const dossiers = [];
  for (let index = 0; index < 5; index += 1) {
    const companyId = `company:${index}`;
    dossiers.push(dossier(companyId));
    histories.set(companyId, series(100 + index));
  }
  const set = buildHistoricalWalkForwardRuntimeInstrumentSet({
    researchDossiers: dossiers,
    historicalSeriesByCompany: histories,
    maximumInstrumentCount: 2,
  });
  assert.equal(set.eligibleInstrumentCount, 5);
  assert.equal(set.selectedInstrumentCount, 2);
  assert.equal(set.omittedInstrumentCount, 3);
  assert.equal(set.universeCoverage.excludedDossierCount, 0);
  assert.equal(set.universeCoverage.omittedByBoundCount, 3);
  assert.deepEqual(set.universeCoverage.selectedInstruments.map((item) => item.companyId), ['company:4', 'company:3']);
  assert.deepEqual(set.universeCoverage.omittedByBound.map((item) => item.companyId), ['company:2', 'company:1', 'company:0']);
});
