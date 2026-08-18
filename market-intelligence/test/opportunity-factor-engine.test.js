import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstrumentProfile } from '../src/instrument-profile.js';
import { buildOpportunityFactorsForUniverse, extractEquityOpportunityRawSignals } from '../src/opportunity-factor-engine.js';

function profile(id, sector = 'Industrials') {
  return buildInstrumentProfile({
    instrumentId: id,
    displayName: id,
    assetClass: 'EQUITY',
    sector,
    primaryListing: { symbol: id.toUpperCase(), mic: 'XNYS', exchange: 'NYSE', currency: 'USD' },
  });
}

function rec(id, values = {}) {
  return {
    instrumentId: id,
    displayName: id,
    profile: profile(id),
    sector: 'Industrials',
    sourceCount: 3,
    ageHours: 12,
    rawSignals: {
      priceToSales: values.priceToSales,
      priceToBook: values.priceToBook,
      netMarginPct: values.netMarginPct,
      freeCashFlowMarginPct: values.freeCashFlowMarginPct,
      revenueGrowthPct: values.revenueGrowthPct,
      liabilitiesToAssetsPct: values.liabilitiesToAssetsPct,
      cashRunwayYears: values.cashRunwayYears,
      dilutedSharesChangePct: values.dilutedSharesChangePct,
      nonPositiveEquity: values.nonPositiveEquity || false,
      relativeStrength60Pct: values.relativeStrength60Pct,
      return120Pct: values.return120Pct,
      distanceFromSma200Pct: values.distanceFromSma200Pct,
      maxDrawdown120Pct: values.maxDrawdown120Pct,
      liquidityScore: values.liquidityScore ?? 80,
      catalystScore: values.catalystScore ?? 75,
    },
  };
}

const peers = [
  rec('a', { priceToSales: 1.2, priceToBook: 1.4, netMarginPct: 18, freeCashFlowMarginPct: 15, revenueGrowthPct: 14, liabilitiesToAssetsPct: 42, cashRunwayYears: 8, dilutedSharesChangePct: -1, relativeStrength60Pct: 18, return120Pct: 24, distanceFromSma200Pct: 12, maxDrawdown120Pct: -14, liquidityScore: 92, catalystScore: 84 }),
  rec('b', { priceToSales: 2.1, priceToBook: 2.0, netMarginPct: 14, freeCashFlowMarginPct: 12, revenueGrowthPct: 9, liabilitiesToAssetsPct: 50, cashRunwayYears: 6, dilutedSharesChangePct: 1, relativeStrength60Pct: 8, return120Pct: 14, distanceFromSma200Pct: 7, maxDrawdown120Pct: -18 }),
  rec('c', { priceToSales: 3.0, priceToBook: 2.7, netMarginPct: 11, freeCashFlowMarginPct: 8, revenueGrowthPct: 6, liabilitiesToAssetsPct: 55, cashRunwayYears: 4, dilutedSharesChangePct: 2, relativeStrength60Pct: 2, return120Pct: 7, distanceFromSma200Pct: 2, maxDrawdown120Pct: -22 }),
  rec('d', { priceToSales: 4.2, priceToBook: 3.4, netMarginPct: 8, freeCashFlowMarginPct: 5, revenueGrowthPct: 4, liabilitiesToAssetsPct: 60, cashRunwayYears: 3, dilutedSharesChangePct: 4, relativeStrength60Pct: -4, return120Pct: -2, distanceFromSma200Pct: -3, maxDrawdown120Pct: -28 }),
  rec('e', { priceToSales: 5.5, priceToBook: 4.1, netMarginPct: 5, freeCashFlowMarginPct: 2, revenueGrowthPct: 1, liabilitiesToAssetsPct: 68, cashRunwayYears: 2, dilutedSharesChangePct: 6, relativeStrength60Pct: -10, return120Pct: -8, distanceFromSma200Pct: -8, maxDrawdown120Pct: -35 }),
  rec('trap', { priceToSales: 0.6, priceToBook: 0.7, netMarginPct: -25, freeCashFlowMarginPct: -32, revenueGrowthPct: -18, liabilitiesToAssetsPct: 94, cashRunwayYears: 0.5, dilutedSharesChangePct: 28, relativeStrength60Pct: -25, return120Pct: -44, distanceFromSma200Pct: -30, maxDrawdown120Pct: -62, liquidityScore: 70, catalystScore: 55 }),
];

test('peer normalization rewards multi-dimensional strength rather than raw cheapness alone', () => {
  const output = buildOpportunityFactorsForUniverse(peers, { minimumPeers: 5 });
  const best = output.find((item) => item.instrumentId === 'a');
  const trap = output.find((item) => item.instrumentId === 'trap');

  assert.equal(best.peerNormalization.sufficientPeerSample, true);
  assert.ok(best.opportunityFactors.valuation.score >= 70);
  assert.ok(best.opportunityFactors.quality.score >= 80);
  assert.ok(best.opportunityFactors.growth.score >= 80);
  assert.ok(best.opportunityFactors.momentum.score >= 80);

  assert.ok(trap.opportunityFactors.valuation.score > best.opportunityFactors.valuation.score, 'value trap may still rank cheapest on valuation');
  assert.ok(trap.opportunityFactors.quality.score <= 20);
  assert.ok(trap.opportunityFactors.growth.score <= 20);
  assert.ok(trap.opportunityFactors.balanceSheet.score <= 20);
  assert.ok(trap.opportunityFactors.momentum.score <= 25);
});

test('equity raw signal extraction uses audited fundamentals and historical market metrics without invented estimates', () => {
  const signals = extractEquityOpportunityRawSignals({
    fundamentals: { metrics: { annualRevenueGrowthPct: 12.5, annualNetMarginPct: 9.2, dilutedSharesChangePct: 2.1 } },
    fundamentalRisk: {
      valuation: { priceToSales: 2.4, priceToBook: 1.8 },
      profitability: { revenue: 1_000_000_000, freeCashFlow: 120_000_000, netMarginPct: 9.2 },
      balanceSheet: { liabilitiesToAssetsPct: 48, cashRunwayYears: 5.5 },
      capitalStructure: { dilutedSharesChangePct: 2.1 },
      flags: [],
    },
    marketMetrics: {
      relativeStrength: { excessReturnPct: 11.2 },
      returnsPct: { d120: 19.4 },
      trend: { distanceFromSma200Pct: 8.1 },
      risk: { maxDrawdown120Pct: -17, annualizedVolatility60Pct: 31 },
      liquidity: { score: 80 },
    },
    catalystScore: 72,
  });

  assert.equal(signals.priceToSales, 2.4);
  assert.equal(signals.revenueGrowthPct, 12.5);
  assert.equal(signals.freeCashFlowMarginPct, 12);
  assert.equal(signals.relativeStrength60Pct, 11.2);
  assert.equal(signals.liquidityScore, 80);
  assert.equal(signals.catalystScore, 72);
});
