import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSecFramesBroadEquityScreen } from '../src/adapters/sec-frames-broad-equity-screen.js';

const instruments = [
  { instrumentId: 'listing:XNAS:AAA', displayName: 'Alpha Inc. - Common Stock', assetClass: 'EQUITY', primaryListing: { symbol: 'AAA', mic: 'XNAS', exchange: 'Nasdaq', currency: 'USD' } },
  { instrumentId: 'listing:XNYS:BBB', displayName: 'Beta Inc. Common Stock', assetClass: 'EQUITY', primaryListing: { symbol: 'BBB', mic: 'XNYS', exchange: 'New York Stock Exchange', currency: 'USD' } },
  { instrumentId: 'listing:XNAS:ETF1', displayName: 'ETF One', assetClass: 'ETF', primaryListing: { symbol: 'ETF1', mic: 'XNAS', exchange: 'Nasdaq', currency: 'USD' } },
];

function frame(tag, ccp, values) {
  return { taxonomy: 'us-gaap', tag, ccp, uom: 'USD', data: values.map(([cik, val]) => ({ cik, val, accn: `000${cik}-26-1`, filed: '2026-08-01' })) };
}

function payloadFor(url) {
  if (url.includes('company_tickers_exchange.json')) {
    return { fields: ['cik', 'name', 'ticker', 'exchange'], data: [[1, 'Alpha Inc.', 'AAA', 'Nasdaq'], [2, 'Beta Inc.', 'BBB', 'NYSE'], [3, 'ETF One', 'ETF1', 'Nasdaq']] };
  }
  const current = url.includes('CY2026Q2');
  const prior = url.includes('CY2025Q2');
  if (url.includes('/RevenueFromContractWithCustomerExcludingAssessedTax/')) {
    return current ? frame('RevenueFromContractWithCustomerExcludingAssessedTax', 'CY2026Q2', [[1, 140], [2, 90]]) : prior ? frame('RevenueFromContractWithCustomerExcludingAssessedTax', 'CY2025Q2', [[1, 100], [2, 100]]) : null;
  }
  if (url.includes('/Revenues/') || url.includes('/SalesRevenueNet/')) return { taxonomy: 'us-gaap', tag: 'Unused', ccp: current ? 'CY2026Q2' : 'CY2025Q2', uom: 'USD', data: [] };
  if (url.includes('/NetIncomeLoss/')) return frame('NetIncomeLoss', 'CY2026Q2', [[1, 28], [2, -18]]);
  if (url.includes('/ProfitLoss/')) return { taxonomy: 'us-gaap', tag: 'ProfitLoss', ccp: 'CY2026Q2', uom: 'USD', data: [] };
  if (url.includes('/Assets/')) return frame('Assets', 'CY2026Q2I', [[1, 500], [2, 300]]);
  if (url.includes('/Liabilities/')) return frame('Liabilities', 'CY2026Q2I', [[1, 180], [2, 275]]);
  if (url.includes('/StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest/')) return { taxonomy: 'us-gaap', tag: 'EquityAlt', ccp: 'CY2026Q2I', uom: 'USD', data: [] };
  if (url.includes('/StockholdersEquity/')) return frame('StockholdersEquity', 'CY2026Q2I', [[1, 320], [2, 25]]);
  return null;
}

const fetchImpl = async (url) => {
  const payload = payloadFor(String(url));
  return payload
    ? { ok: true, json: async () => payload }
    : { ok: false, status: 404, json: async () => ({}) };
};

test('SEC frames broad screen ranks stronger quality-growth-balance candidate and never emits a final action', async () => {
  const result = await buildSecFramesBroadEquityScreen(instruments, {
    fetchImpl,
    userAgent: 'Investor Control test contact@example.com',
    now: '2026-08-09T12:00:00.000Z',
    period: { year: 2026, quarter: 2 },
    limit: 10,
  });

  assert.equal(result.secIdentityMatchCount, 2, 'ETF must not enter equity fundamental screen');
  assert.equal(result.scorableCount, 2);
  assert.equal(result.candidates[0].primaryListing.symbol, 'AAA');
  assert.equal(result.candidates[0].broadScreen.rawSignals.revenueGrowthPct, 40);
  assert.equal(result.candidates[0].broadScreen.rawSignals.netMarginPct, 20);
  assert.equal(result.candidates[0].broadScreen.finalActionEligible, false);
  const beta = result.candidates.find((item) => item.primaryListing.symbol === 'BBB');
  assert.ok(beta.broadScreen.preliminaryRiskScore > result.candidates[0].broadScreen.preliminaryRiskScore);
  assert.ok(beta.broadScreen.riskFlags.includes('VERY_HIGH_LIABILITIES_TO_ASSETS'));
});

test('missing SEC user agent fails closed without network calls', async () => {
  let called = false;
  const result = await buildSecFramesBroadEquityScreen(instruments, { fetchImpl: async () => { called = true; throw new Error('should not call'); }, userAgent: '' });
  assert.equal(called, false);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.diagnostics[0].code, 'SEC_USER_AGENT_MISSING');
});
