import test from 'node:test';
import assert from 'node:assert/strict';
import { assessFundamentalRisk } from '../src/fundamental-risk.js';

function fact(value) {
  return { value, unit: 'USD', end: '2025-12-31', filed: '2026-02-20', accession: '0000000000-26-000001' };
}

test('fundamental risk calculates valuation, runway, dilution and balance-sheet flags', () => {
  const snapshot = {
    companyId: 'company:test',
    metricsReady: true,
    annual: {
      revenue: [fact(100_000_000)],
      netIncome: [fact(-60_000_000)],
      dilutedShares: [{ ...fact(50_000_000), unit: 'shares' }],
    },
    instant: {
      cash: fact(30_000_000),
      assets: fact(120_000_000),
      liabilities: fact(100_000_000),
      equity: fact(20_000_000),
    },
    metrics: {
      latestAnnualFreeCashFlowUSD: -40_000_000,
      dilutedSharesChangePct: 25,
    },
  };

  const result = assessFundamentalRisk(snapshot, 10, {
    companyId: 'company:test',
    generatedAt: '2026-07-27T12:00:00.000Z',
  });

  assert.equal(result.valuation.marketCapitalization, 500_000_000);
  assert.equal(result.valuation.priceToSales, 5);
  assert.equal(result.balanceSheet.cashRunwayYears, 0.75);
  assert.equal(result.balanceSheet.liabilitiesToAssetsPct, 83.33);
  assert.ok(result.flags.includes('CASH_RUNWAY_UNDER_ONE_YEAR'));
  assert.ok(result.flags.includes('SEVERE_DILUTION'));
  assert.ok(result.flags.includes('HIGH_LIABILITIES_TO_ASSETS'));
  assert.ok(result.flags.includes('SEVERE_NEGATIVE_NET_MARGIN'));
  assert.equal(result.metricsReady, true);
  assert.ok(result.riskScore >= 80);
});

test('valuation cannot be marked ready without price and share count', () => {
  const result = assessFundamentalRisk({
    companyId: 'company:test',
    metricsReady: true,
    annual: { revenue: [fact(100)], netIncome: [], dilutedShares: [] },
    instant: { cash: null, assets: null, liabilities: null, equity: null },
    metrics: {},
  }, null);
  assert.equal(result.metricsReady, false);
  assert.equal(result.valuation.marketCapitalization, null);
});
