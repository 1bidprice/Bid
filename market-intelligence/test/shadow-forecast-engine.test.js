import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildShadowForecasts } from '../src/shadow-forecast-engine.js';

function series(count = 900, source = 'Finnhub Historical') {
  return {
    usable: true,
    source,
    providerSymbol: 'ABC',
    candles: Array.from({ length: count }, (_, i) => {
      const close = 100 + 0.03 * i + 6 * Math.sin((2 * Math.PI * i) / 90);
      return {
        timestamp: 1_650_000_000 + i * 86_400,
        close,
        rawClose: close,
        volume: 1_000_000 * (1 + 0.1 * Math.cos((2 * Math.PI * i) / 45)),
      };
    }),
  };
}

function dossier() {
  return {
    companyId: 'company:ABC',
    companyName: 'ABC Corp',
    listing: { symbol: 'ABC', exchange: 'Nasdaq', mic: 'XNAS' },
    finalAction: { status: 'FINAL', marketAction: 'HOLD', holderAction: 'HOLD', nonHolderAction: 'WATCH' },
    invalidationCondition: 'Ακύρωση thesis αν χαθεί η θεμελιώδης υπόθεση.',
    readiness: { publishable: true, blockers: [] },
    catalysts: [{ text: 'Verified catalyst', confidence: 0.8, evidenceIds: ['e1'] }],
    risks: [{ text: 'Verified risk', confidence: 0.8, evidenceIds: ['e2'] }],
    metrics: {
      crossCheck: { recommendationReady: true, contradictionCount: 0 },
      market: {
        latestTimestamp: 1_730_000_000,
        benchmarkSymbol: 'SPY',
        relativeStrength: { excessReturnPct: 8 },
        trend: { distanceFromSma50Pct: 5, distanceFromSma200Pct: 10 },
        risk: { annualizedVolatility60Pct: 35, maxDrawdown120Pct: -15, flags: [] },
        liquidity: { score: 80, averageDailyValueTraded20: 20_000_000 },
        readiness: { priceHistoryReady: true, relativeStrengthReady: true, liquidityReady: true, marketMetricsReady: true },
      },
      fundamentalRisk: {
        metricsReady: true,
        profitability: { netMarginPct: 15, freeCashFlow: 100_000_000 },
        capitalStructure: { dilutedSharesChangePct: 1 },
        balanceSheet: { cashRunwayYears: null },
        flags: [],
      },
    },
  };
}

function baseInput(overrides = {}) {
  return {
    generatedAt: '2026-08-11T00:00:00.000Z',
    universe: [{
      companyId: 'company:ABC',
      displayName: 'ABC Corp',
      active: true,
      country: 'US',
      primaryListing: { symbol: 'ABC', exchange: 'Nasdaq', mic: 'XNAS', currency: 'USD' },
      sector: 'Technology',
    }],
    researchDossiers: [dossier()],
    opportunityUniverse: { ranking: { items: [] } },
    historicalSeriesCollector: new Map([['company:ABC', series()]]),
    options: { shadowForecastHorizons: { month1: 21 }, shadowForecastMinAnalogCount: 8, shadowForecastMinimumHistory: 260 },
    ...overrides,
  };
}

test('shadow engine attaches research forecast while preserving existing final action snapshot', () => {
  const forecasts = buildShadowForecasts(baseInput());
  assert.equal(forecasts.length, 1);
  const item = forecasts[0];
  assert.equal(item.mode, 'SHADOW_ONLY');
  assert.equal(item.decisionImpact, 'NONE');
  assert.equal(item.finalActionEligible, false);
  assert.equal(item.existingFinalActionSnapshot.marketAction, 'HOLD');
  assert.equal(item.forecast.finalActionEligible, false);
  assert.equal(item.forecast.forecastMayInfluenceFinalAction, false);
  assert.ok(item.forecast.explainability.supportingDrivers.length > 0);
  assert.equal(item.historySource.type, 'CANONICAL_MARKET_HISTORY');
});

test('RESEARCH_READY long history is preferred for pattern learning but remains research-only', () => {
  const longSeries = series(1500, 'Yahoo Finance Chart');
  const forecasts = buildShadowForecasts(baseInput({
    longHistoryResearchCollector: new Map([['company:ABC', {
      status: 'RESEARCH_READY',
      researchEligible: true,
      decisionEligible: false,
      executionEligible: false,
      policyVersion: '2026-08-11.1',
      source: 'Yahoo Finance Chart',
      providerSymbol: 'ABC',
      observationCount: 1500,
      crossCheck: { status: 'CROSSCHECK_PASS', overlapSessions: 120, medianReturnErrorBps: 2, p95ReturnErrorBps: 10 },
      series: { ...longSeries, researchOnly: true, decisionEligible: false, executionEligible: false },
    }]]),
  }));
  const item = forecasts[0];
  assert.equal(item.historySource.type, 'VALIDATED_LONG_HISTORY_RESEARCH');
  assert.equal(item.historySource.researchOnly, true);
  assert.equal(item.historySource.observationCount, 1500);
  assert.equal(item.historySource.crossCheck.status, 'CROSSCHECK_PASS');
  assert.equal(item.finalActionEligible, false);
  assert.equal(item.decisionImpact, 'NONE');
  assert.ok(!item.diagnostics.some((entry) => entry.code === 'LONG_HISTORY_RESEARCH_REJECTED'));
});

test('rejected long history can never replace canonical history', () => {
  const forecasts = buildShadowForecasts(baseInput({
    longHistoryResearchCollector: new Map([['company:ABC', {
      status: 'REJECTED',
      researchEligible: false,
      decisionEligible: false,
      executionEligible: false,
      observationCount: 1500,
      blockers: ['LONG_HISTORY_MEDIAN_RETURN_MISMATCH'],
      series: series(1500, 'Yahoo Finance Chart'),
    }]]),
  }));
  const item = forecasts[0];
  assert.equal(item.historySource.type, 'CANONICAL_MARKET_HISTORY');
  assert.equal(item.historySource.observationCount, 900);
  assert.ok(item.diagnostics.some((entry) => entry.code === 'LONG_HISTORY_RESEARCH_REJECTED'));
  assert.ok(item.diagnostics.some((entry) => entry.blockers?.includes('LONG_HISTORY_MEDIAN_RETURN_MISMATCH')));
});

test('malformed RESEARCH_READY record fails closed and cannot enter pattern learning', () => {
  const forecasts = buildShadowForecasts(baseInput({
    longHistoryResearchCollector: new Map([['company:ABC', {
      status: 'RESEARCH_READY',
      researchEligible: true,
      decisionEligible: true,
      executionEligible: false,
      observationCount: 1500,
      series: series(1500, 'Yahoo Finance Chart'),
    }]]),
  }));
  const item = forecasts[0];
  assert.equal(item.historySource.type, 'CANONICAL_MARKET_HISTORY');
  assert.ok(item.diagnostics.some((entry) => entry.code === 'LONG_HISTORY_RESEARCH_CONTRACT_INVALID'));
});

test('short history is explicitly diagnosed instead of fabricating a pattern forecast', () => {
  const forecasts = buildShadowForecasts(baseInput({
    historicalSeriesCollector: new Map([['company:ABC', series(300)]]),
    options: { minimumShadowHistoryObservations: 520 },
  }));
  assert.ok(forecasts[0].diagnostics.some((item) => item.code === 'LONG_HISTORY_REQUIRED_FOR_PATTERN_LEARNING'));
  assert.equal(forecasts[0].finalActionEligible, false);
});

test('runtime patch wires in-memory historical series to autonomous shadow forecasts without serializing raw series', () => {
  const daily = fs.readFileSync(new URL('../src/run-daily-intelligence.js', import.meta.url), 'utf8');
  const autonomous = fs.readFileSync(new URL('../src/run-autonomous-intelligence.js', import.meta.url), 'utf8');
  assert.match(daily, /historicalSeriesCollector\.set\(company\.companyId, historyResult\.series\)/);
  assert.match(autonomous, /const historicalSeriesCollector = new Map\(\)/);
  assert.match(autonomous, /const shadowForecasts = buildShadowForecasts\(/);
  assert.match(autonomous, /shadowForecastCount: shadowForecasts\.length/);
  assert.doesNotMatch(autonomous, /historicalMarketSeries:/);
});
