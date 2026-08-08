import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAthensFundamentalSnapshotFromText } from '../src/adapters/euronext-athens-fundamentals.js';

const document = {
  title: 'Financial report PREMIA R.E.I.C. (2025,Year Statement,Consolidated)',
  identityVerified: true,
  identityScore: 100,
  period: { year: 2025, months: 12, type: 'ANNUAL', periodEnd: '2025-12-31' },
  pdfUrl: 'https://athens.euronext.com/premia-2025.pdf',
};

const pages = [
  `PREMIA R.E.I.C.\nANNUAL FINANCIAL REPORT\n(Amounts in €)`,
  `Statement of comprehensive income\nRevenue 100.000.000 90.000.000\nNet profit for the period 30.000.000 25.000.000\nBasic and diluted 0,50 0,42`,
  `Statement of financial position\nCash and cash equivalents 20.000.000 18.000.000\nTotal assets 1.000.000.000 950.000.000\nTotal liabilities 600.000.000 570.000.000\nTotal equity 400.000.000 380.000.000`,
];

test('Athens real-estate issuer keeps raw audited facts but suppresses the generic operating-company model', () => {
  const premia = {
    companyId: 'company:xath:premia',
    displayName: 'PREMIA REAL ESTATE INVESTMENT COMPANY',
    legalName: 'PREMIA R.E.I.C.',
    sector: 'Real Estate',
    primaryListing: { symbol: 'PREMIA', currency: 'EUR', mic: 'XATH' },
  };
  const snapshot = buildAthensFundamentalSnapshotFromText(pages.join('\f'), document, premia, { pages });

  assert.equal(snapshot.model.type, 'REAL_ESTATE');
  assert.equal(snapshot.model.specializedModelRequired, true);
  assert.equal(snapshot.reporting.genericModelEligible, false);
  assert.equal(snapshot.annual.revenue[0].value, 100_000_000);
  assert.equal(snapshot.annual.netIncome[0].value, 30_000_000);
  assert.equal(snapshot.metrics.annualRevenueGrowthPct, null);
  assert.equal(snapshot.metrics.annualNetMarginPct, null);
  assert.equal(snapshot.metrics.latestFreeCashFlow, null);
  assert.equal(snapshot.quality.genericMetricsSuppressed, true);
  assert.equal(snapshot.metricsReady, false);
});
