import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShadowForecasts } from '../src/shadow-forecast-engine.js';
import { createLiveShadowForecastRecords } from '../src/forecast-outcome-ledger.js';

function series(count = 900) {
  return {
    usable: true,
    source: 'Validated Test History',
    providerSymbol: 'ABC',
    candles: Array.from({ length: count }, (_, index) => {
      const close = 100 + 0.035 * index + 7 * Math.sin((2 * Math.PI * index) / 90);
      return {
        timestamp: 1_650_000_000 + index * 86_400,
        close,
        rawClose: close,
        volume: 1_500_000 * (1 + 0.08 * Math.cos((2 * Math.PI * index) / 45)),
      };
    }),
  };
}

function objectKeysDeep(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    output.push(key);
    objectKeysDeep(child, output);
  }
  return output;
}

test('shadow forecast exposes multi-factor latent research per horizon without changing final-action authority', () => {
  const history = series();
  const generatedAt = new Date(history.candles.at(-1).timestamp * 1000).toISOString();
  const dossier = {
    companyId: 'company:ABC',
    companyName: 'ABC Corp',
    listing: { symbol: 'ABC', exchange: 'Nasdaq', mic: 'XNAS', currency: 'USD' },
    referencePrice: { value: history.candles.at(-1).close, timestamp: generatedAt, currency: 'USD', source: 'validated-test' },
    finalAction: { status: 'FINAL', marketAction: 'HOLD', holderAction: 'HOLD', nonHolderAction: 'WATCH' },
    readiness: { publishable: true, blockers: [] },
    catalysts: [{ text: 'Verified catalyst', confidence: 0.8, evidenceIds: ['e-cat'] }],
    risks: [{ text: 'Known thesis risk', confidence: 0.6, evidenceIds: ['e-risk'] }],
    metrics: {
      crossCheck: { recommendationReady: true, contradictionCount: 0 },
      market: {
        latestTimestamp: history.candles.at(-1).timestamp,
        benchmarkSymbol: 'SPY',
        relativeStrength: { excessReturnPct: 9 },
        trend: { distanceFromSma50Pct: 6, distanceFromSma200Pct: 12 },
        risk: { annualizedVolatility60Pct: 32, maxDrawdown120Pct: -14, flags: [] },
        liquidity: { score: 85, averageDailyValueTraded20: 30_000_000 },
        readiness: { priceHistoryReady: true, relativeStrengthReady: true, liquidityReady: true, marketMetricsReady: true },
      },
      fundamentalRisk: {
        metricsReady: true,
        profitability: { netMarginPct: 18, freeCashFlow: 120_000_000 },
        capitalStructure: { dilutedSharesChangePct: 1 },
        balanceSheet: { cashRunwayYears: null },
        flags: [],
      },
    },
  };
  const opportunity = {
    instrumentId: 'company:ABC',
    evidenceQualityScore: 90,
    factors: {
      valuation: { score: 78, verified: true, peerSampleSize: 20, sourceCount: 2 },
      quality: { score: 82, verified: true, sourceCount: 2 },
      growth: { score: 76, verified: true, sourceCount: 2 },
      momentum: { score: 74, verified: true, sourceCount: 1 },
    },
  };
  const forecasts = buildShadowForecasts({
    generatedAt,
    universe: [{ companyId: 'company:ABC', displayName: 'ABC Corp', country: 'US', active: true, primaryListing: dossier.listing }],
    researchDossiers: [dossier],
    opportunityUniverse: { ranking: { items: [opportunity] } },
    historicalSeriesCollector: new Map([['company:ABC', history]]),
    options: { shadowForecastHorizons: { month1: 21 }, shadowForecastMinAnalogCount: 8, shadowForecastMinimumHistory: 260 },
  });

  assert.equal(forecasts.length, 1);
  const shadow = forecasts[0];
  const research = shadow.multiFactorResearch.horizons.month1;
  assert.ok(research.featureVector.availableDomainCount >= 3);
  assert.ok(Number.isFinite(research.factorScore.rawLatentScore));
  assert.equal(research.factorScore.decisionImpact, 'NONE');
  assert.equal(research.factorScore.finalActionEligible, false);
  assert.equal(shadow.decisionImpact, 'NONE');
  assert.equal(shadow.finalActionEligible, false);
  assert.equal(shadow.existingFinalActionSnapshot.marketAction, 'HOLD');
  assert.equal(objectKeysDeep(research.factorScore).some((key) => key.toLowerCase().includes('probability')), false);

  const withFactor = createLiveShadowForecastRecords([shadow], [dossier]);
  const withoutFactorShadow = structuredClone(shadow);
  delete withoutFactorShadow.multiFactorResearch;
  const withoutFactor = createLiveShadowForecastRecords([withoutFactorShadow], [dossier]);
  assert.equal(withFactor.length, 1);
  assert.equal(withoutFactor.length, 1);
  assert.equal(withFactor[0].forecastId, withoutFactor[0].forecastId);
  assert.ok(withFactor[0].factorScorePolicyVersion);
  assert.ok(Number.isFinite(withFactor[0].rawLatentFactorScore));
  assert.equal(withoutFactor[0].factorScorePolicyVersion, null);
});

test('multi-factor research cannot manufacture BUY or SELL vocabulary in its score contract', () => {
  const history = series();
  const generatedAt = new Date(history.candles.at(-1).timestamp * 1000).toISOString();
  const dossier = {
    companyId: 'company:ABC', companyName: 'ABC Corp', listing: { symbol: 'ABC', exchange: 'Nasdaq', mic: 'XNAS', currency: 'USD' },
    referencePrice: { value: history.candles.at(-1).close, timestamp: generatedAt, currency: 'USD', source: 'test' },
    readiness: { publishable: false, blockers: ['INCOMPLETE_EVIDENCE'] },
    metrics: { crossCheck: { recommendationReady: false, contradictionCount: 0 }, market: {}, fundamentalRisk: {} },
  };
  const [shadow] = buildShadowForecasts({
    generatedAt,
    universe: [{ companyId: 'company:ABC', displayName: 'ABC Corp', country: 'US', active: true, primaryListing: dossier.listing }],
    researchDossiers: [dossier],
    opportunityUniverse: { ranking: { items: [] } },
    historicalSeriesCollector: new Map([['company:ABC', history]]),
    options: { shadowForecastHorizons: { week1: 5 }, shadowForecastMinAnalogCount: 8, shadowForecastMinimumHistory: 260 },
  });
  const serialized = JSON.stringify(shadow.multiFactorResearch);
  assert.doesNotMatch(serialized, /BUY_NOW|SELL_NOW|"BUY"|"SELL"/);
  assert.equal(shadow.multiFactorResearch.decisionImpact, 'NONE');
  assert.equal(shadow.multiFactorResearch.finalActionEligible, false);
});
