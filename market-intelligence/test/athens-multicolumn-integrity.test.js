import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAthensFundamentalSnapshotFromText } from '../src/adapters/euronext-athens-fundamentals.js';

const company = {
  companyId: 'company:xath:ellaktor-fixture',
  displayName: 'ELLAKTOR S.A.',
  legalName: 'ELLAKTOR S.A.',
  sector: 'Industrials',
  primaryListing: { symbol: 'ELLAKTOR', currency: 'EUR', mic: 'XATH' },
};

const document = {
  title: 'Financial report ELLAKTOR S.A. (2025,Six-Month Statement,Consolidated)',
  identityVerified: true,
  identityScore: 100,
  period: { year: 2025, months: 6, type: 'INTERIM_6M', periodEnd: '2025-06-30' },
  pdfUrl: 'https://athens.euronext.com/ellaktor-h1-2025.pdf',
};

test('Athens parser selects Group Total columns from Continuing/Discontinued income statements', () => {
  const pages = [
    `ELLAKTOR S.A.\nSummary interim financial statements\nAmounts in EUR thousands, unless otherwise stated`,
    `Income Statement H1 2025 and 2024\nGROUP\n1-Jan to 30-Jun-25 30-Jun-24\nContinuing operations Discontinued operations Total Continuing operations Discontinued operations Total\nSales 5 8,945 40,613 49,558 113,974 78,699 192,673\nNet profit/ (loss) for the period 21 (33,200) 3,266 (29,934) 39,746 7,085 46,831\nRestated basic earnings per share (in EUR) 21 (0.0840) 0.0052 (0.0789) 0.0619 0.0220 0.0840`,
    `Statement of Financial Position\nGROUP COMPANY\n30-Jun-25 31-Dec-24 30-Jun-25 31-Dec-24\nCash and cash equivalents 11 201,685 340,645 191,460 226,400\nTOTAL ASSETS 1,286,447 1,621,906 1,191,189 1,433,931\nTotal liabilities related to assets held for sale 14 205,326 438,814 - -\nTOTAL LIABILITIES 854,130 1,078,012 550,792 694,881\nTOTAL EQUITY 432,317 543,894 640,397 739,050\nTOTAL LIABILITIES AND EQUITY 1,286,447 1,621,906 1,191,189 1,433,931`,
  ];

  const snapshot = buildAthensFundamentalSnapshotFromText(pages.join('\f'), document, company, { pages });

  assert.equal(snapshot.reporting.scale, 1_000);
  assert.equal(snapshot.annual.revenue[0].value, 49_558_000);
  assert.equal(snapshot.annual.revenue[1].value, 192_673_000);
  assert.equal(snapshot.annual.revenue[0].provenance.statementColumnPolicy, 'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1');
  assert.equal(snapshot.annual.netIncome[0].value, -29_934_000);
  assert.equal(snapshot.annual.netIncome[1].value, 46_831_000);

  assert.equal(snapshot.instant.cash.value, 201_685_000);
  assert.equal(snapshot.instant.assets.value, 1_286_447_000);
  assert.equal(snapshot.instant.liabilities.value, 854_130_000);
  assert.equal(snapshot.instant.equity.value, 432_317_000);
  assert.equal(snapshot.instant.cash.provenance.statementColumnPolicy, 'GROUP_CURRENT_COMPARATIVE_V1');
  assert.equal(snapshot.instant.liabilities.provenance.extractedLine, 'TOTAL LIABILITIES 854,130 1,078,012 550,792 694,881');
  assert.equal(snapshot.instant.equity.provenance.extractedLine, 'TOTAL EQUITY 432,317 543,894 640,397 739,050');
  assert.equal(snapshot.quality.balanceSheetIntegrity.status, 'PASSED');
  assert.equal(snapshot.quality.balanceSheetIntegrity.balanceEquationDifferencePct, 0);

  // Complex continuing/discontinued EPS cannot be combined with total net income
  // to infer diluted shares because the EPS numerator is attributable-to-parent.
  assert.equal(snapshot.annual.dilutedShares.length, 0);
  assert.equal(snapshot.metricsReady, false);
});

test('metric row tail gate rejects descriptive sub-rows even when they begin with the target label', () => {
  const pages = [
    `ELLAKTOR S.A.\nAmounts in EUR thousands, unless otherwise stated`,
    `Income Statement\nSales 49,558 192,673\nNet profit for the period (29,934) 46,831\nBasic and diluted (in EUR) (0.0789) 0.0840`,
    `Statement of Financial Position\nCash and cash equivalents at period start 207,708 302,893\nCash and cash equivalents 201,685 340,645\nTotal Assets 1,286,447 1,621,906\nTotal liabilities related to assets held for sale 205,326 438,814\nTotal Liabilities 854,130 1,078,012\nTotal Equity 432,317 543,894\nTotal Equity and Liabilities 1,286,447 1,621,906`,
  ];
  const snapshot = buildAthensFundamentalSnapshotFromText(pages.join('\f'), document, company, { pages });

  assert.equal(snapshot.instant.cash.value, 201_685_000);
  assert.equal(snapshot.instant.liabilities.value, 854_130_000);
  assert.equal(snapshot.instant.equity.value, 432_317_000);
  assert.equal(snapshot.instant.cash.provenance.extractedLine, 'Cash and cash equivalents 201,685 340,645');
  assert.equal(snapshot.quality.balanceSheetIntegrity.status, 'PASSED');
});
