import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildShadowForecasts } from '../src/shadow-forecast-engine.js';

function series(count = 900) {
  return {
    usable: true,
    candles: Array.from({ length: count }, (_, i) => {
      const close = 100 + 0.03 * i + 6 * Math.sin((2 * Math.PI * i) / 90);
      return {
        timestamp: 1_650_000_000 + i * 86_400,
        close,
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

test('shadow engine attaches research forecast while preserving existing final action snapshot', () => {
  const history = new Map([['company:ABC', series()]]);
  const forecasts = buildShadowForecasts({
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
    historicalSeriesCollector: history,
    options: { shadowForecastHorizons: { month1: 21 }, shadowForecastMinAnalogCount: 8, shadowForecastMinimumHistory: 260 },
  });
  assert.equal(forecasts.length, 1);
  const item = forecasts[0];
  assert.equal(item.mode, 'SHADOW_ONLY');
  assert.equal(item.decisionImpact, 'NONE');
  assert.equal(item.finalActionEligible, false);
  assert.equal(item.existingFinalActionSnapshot.marketAction, 'HOLD');
  assert.equal(item.forecast.finalActionEligible, false);
  assert.equal(item.forecast.forecastMayInfluenceFinalAction, false);
  assert.ok(item.forecast.explainability.supportingDrivers.length > 0);
});

test('short history is explicitly diagnosed instead of fabricating a pattern forecast', () => {
  const forecasts = buildShadowForecasts({
    universe: [{ companyId: 'company:ABC', displayName: 'ABC Corp', country: 'US', primaryListing: { symbol: 'ABC', mic: 'XNAS' } }],
    researchDossiers: [dossier()],
    historicalSeriesCollector: new Map([['company:ABC', series(300)]]),
    opportunityUniverse: { ranking: { items: [] } },
    options: { minimumShadowHistoryObservations: 520 },
  });
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
