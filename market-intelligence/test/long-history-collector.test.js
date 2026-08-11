import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLongHistoryResearch } from '../src/long-history-collector.js';

function canonical(source = 'Finnhub Historical', count = 120) {
  return {
    usable: true,
    source,
    sourceUrl: source.includes('Yahoo')
      ? 'https://query1.finance.yahoo.com/v8/finance/chart/ABC'
      : 'https://finnhub.io/api/v1/stock/candle',
    candles: Array.from({ length: count }, (_, index) => ({
      timestamp: 1_700_000_000 + index * 86_400,
      close: 100 + index,
    })),
  };
}

function readyRecord(symbol) {
  return {
    status: 'RESEARCH_READY',
    researchEligible: true,
    decisionEligible: false,
    executionEligible: false,
    observationCount: 1500,
    source: 'Test Long History',
    providerSymbol: symbol,
    crossCheck: { status: 'CROSSCHECK_PASS', overlapSessions: 120 },
    series: { usable: true, candles: Array.from({ length: 1500 }, (_, index) => ({ timestamp: 1_500_000_000 + index * 86_400, close: 10 + index })) },
  };
}

function company(companyId, symbol, extras = {}) {
  return {
    companyId,
    displayName: companyId,
    country: extras.country || 'US',
    primaryListing: {
      symbol,
      mic: extras.mic || 'XNAS',
      exchange: extras.exchange || 'Nasdaq',
      currency: extras.currency || 'USD',
    },
    ...(extras.marketData ? { marketData: extras.marketData } : {}),
  };
}

function dossier(companyId, priority = 'draft') {
  const base = { companyId, companyName: companyId, listing: { symbol: companyId.toUpperCase(), mic: 'XNAS' } };
  if (priority === 'final') return { ...base, finalAction: { status: 'FINAL', marketAction: 'HOLD' } };
  if (priority === 'ready') return { ...base, metrics: { crossCheck: { recommendationReady: true } } };
  return base;
}

test('collector is bounded and prioritizes final then recommendation-ready dossiers without hardcoded identities', async () => {
  const calls = [];
  const fetcher = async (symbol, options) => {
    calls.push({ symbol, canonical: options.canonicalSeries });
    return readyRecord(symbol);
  };
  const researchDossiers = [dossier('company:c', 'draft'), dossier('company:b', 'ready'), dossier('company:a', 'final')];
  const universe = [company('company:a', 'AAA'), company('company:b', 'BBB'), company('company:c', 'CCC')];
  const historicalSeriesCollector = new Map(universe.map((item) => [item.companyId, canonical()]));
  const result = await collectLongHistoryResearch({
    universe,
    researchDossiers,
    historicalSeriesCollector,
    options: { longHistoryResearchLimit: 2, longHistoryFetcher: fetcher },
  });
  assert.deepEqual(calls.map((item) => item.symbol), ['AAA', 'BBB']);
  assert.equal(result.summary.selectedCount, 2);
  assert.equal(result.summary.attemptedCount, 2);
  assert.equal(result.summary.readyCount, 2);
  assert.equal(result.summary.skippedByLimit, 1);
  assert.equal(result.collector.has('company:c'), false);
});

test('collector never performs a max-range provider request without sufficient canonical overlap', async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return readyRecord('AAA'); };
  const result = await collectLongHistoryResearch({
    universe: [company('company:a', 'AAA')],
    researchDossiers: [dossier('company:a', 'final')],
    historicalSeriesCollector: new Map([['company:a', canonical('Finnhub Historical', 20)]]),
    options: { longHistoryFetcher: fetcher, longHistoryMinimumOverlapSessions: 40 },
  });
  assert.equal(calls, 0);
  assert.equal(result.summary.attemptedCount, 0);
  assert.equal(result.summary.skippedNoCanonicalCount, 1);
  assert.ok(result.collector.get('company:a').blockers.includes('LONG_HISTORY_CANONICAL_OVERLAP_TOO_SMALL'));
});

test('built-in Yahoo acquisition is skipped when canonical overlap is already Yahoo and therefore non-independent', async () => {
  const result = await collectLongHistoryResearch({
    universe: [company('company:a', 'AAA')],
    researchDossiers: [dossier('company:a', 'final')],
    historicalSeriesCollector: new Map([['company:a', canonical('Yahoo Finance Chart', 120)]]),
    options: {},
  });
  assert.equal(result.summary.attemptedCount, 0);
  assert.equal(result.summary.skippedNonIndependentCount, 1);
  assert.ok(result.collector.get('company:a').blockers.includes('INDEPENDENT_CANONICAL_OVERLAP_SOURCE_REQUIRED'));
});

test('provider symbols resolve generically for Athens and respect explicit market-data aliases', async () => {
  const calls = [];
  const fetcher = async (symbol, options) => {
    calls.push({ symbol, alternateSymbols: options.alternateSymbols });
    return readyRecord(symbol);
  };
  const athens = company('company:athens', 'TEST', { country: 'GR', mic: 'XATH', exchange: 'Athens Exchange', currency: 'EUR' });
  const configured = company('company:configured', 'XYZ', { marketData: { yahooSymbols: ['XYZ-A', 'XYZ-B'] } });
  const result = await collectLongHistoryResearch({
    universe: [athens, configured],
    researchDossiers: [dossier('company:athens', 'final'), dossier('company:configured', 'ready')],
    historicalSeriesCollector: new Map([
      ['company:athens', canonical()],
      ['company:configured', canonical()],
    ]),
    options: { longHistoryFetcher: fetcher, longHistoryResearchLimit: 5 },
  });
  assert.equal(result.summary.readyCount, 2);
  assert.equal(calls[0].symbol, 'TEST.AT');
  assert.equal(calls[1].symbol, 'XYZ-A');
  assert.deepEqual(calls[1].alternateSymbols, ['XYZ-B']);
});

test('disabled long-history collection performs no provider work and returns an empty collector', async () => {
  let calls = 0;
  const result = await collectLongHistoryResearch({
    universe: [company('company:a', 'AAA')],
    researchDossiers: [dossier('company:a', 'final')],
    historicalSeriesCollector: new Map([['company:a', canonical()]]),
    options: { enableLongHistoryResearch: false, longHistoryFetcher: async () => { calls += 1; return readyRecord('AAA'); } },
  });
  assert.equal(calls, 0);
  assert.equal(result.summary.enabled, false);
  assert.equal(result.summary.selectedCount, 0);
  assert.equal(result.collector.size, 0);
});
