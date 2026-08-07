import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAthensFundamentalSnapshotFromText } from '../src/adapters/euronext-athens-fundamentals.js';

const company = {
  companyId: 'company:xath:ellaktor-authority-fixture',
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

test('primary consolidated statements outrank Board Report/APM summaries and Company continuation rows', () => {
  const pages = [
    `ELLAKTOR S.A.\nSemi-annual Financial Report\nAmounts in EUR thousands, unless otherwise stated\nB. Semi-annual Board of Directors Report\nReview of H1 2025 results\nRemarks on Key Figures of the H1 2025 Income Statement and Balance Sheet\nProfitability Ratios\nAmounts in EUR million H1 2025 H1 2024 Total\nSales 49.6 192.7\nDefinitions of Financial Figures: Operating Results in the Group's Income Statement`,
    `ELLAKTOR S.A.\nSummary interim financial statements\nAmounts in EUR thousands, unless otherwise stated\nStatement of Financial Position\nGROUP COMPANY\nNote 30-Jun-25 31-Dec-24 30-Jun-25 31-Dec-24\nCash and cash equivalents 11 201,685 172,892 16,972 3,859\nTOTAL ASSETS 1,286,447 1,503,248 450,969 579,099\nTotal equity 432,317 776,796 404,474 464,673\nTotal liabilities 854,130 726,452 46,495 114,426`,
    `ELLAKTOR S.A.\nSummary interim financial statements\nAmounts in EUR thousands, unless otherwise stated\nIncome Statement H1 2025 and 2024\nGROUP\nContinuing operations Discontinued operations Total Continuing operations Discontinued operations Total\nSales 5 8,945 40,613 49,558 113,974 78,699 192,673\nNet profit/(loss) for the period (33,200) 3,266 (29,934) 39,746 7,085 46,831\nRestated basic earnings per share (in EUR) 21 (0.0840) 0.0052 (0.0789) 0.0619 0.0220 0.0840`,
    `ELLAKTOR S.A.\nSummary interim financial statements\nAmounts in EUR thousands, unless otherwise stated\nStatement of Comprehensive Income H1 2025 and 2024\nGROUP\nContinuing operations Discontinued operations Total Continuing operations Discontinued operations Total\nNet profit/(loss) for the period (33,200) 3,266 (29,934) 39,746 7,085 46,831\nCOMPANY\nNet profit/(loss) for the period 236,286 (13,644)`,
  ];

  const snapshot = buildAthensFundamentalSnapshotFromText(pages.join('\f'), document, company, { pages });

  assert.equal(snapshot.reporting.scale, 1_000);
  assert.equal(snapshot.annual.revenue[0].value, 49_558_000);
  assert.equal(snapshot.annual.revenue[1].value, 192_673_000);
  assert.equal(snapshot.annual.netIncome[0].value, -29_934_000);
  assert.equal(snapshot.annual.netIncome[1].value, 46_831_000);
  assert.equal(snapshot.annual.revenue[0].provenance.statementColumnPolicy, 'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1');
  assert.ok(snapshot.annual.revenue[0].provenance.statementAuthorityScore >= 300);
  assert.equal(snapshot.annual.netIncome[0].provenance.statementColumnPolicy, 'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1');
  assert.equal(snapshot.annual.dilutedShares.length, 0);

  assert.equal(snapshot.instant.cash.value, 201_685_000);
  assert.equal(snapshot.instant.assets.value, 1_286_447_000);
  assert.equal(snapshot.instant.liabilities.value, 854_130_000);
  assert.equal(snapshot.instant.equity.value, 432_317_000);
  assert.equal(snapshot.quality.balanceSheetIntegrity.status, 'PASSED');
  assert.equal(snapshot.metricsReady, false);

  assert.notEqual(snapshot.annual.revenue[0].value, 49_600);
  assert.notEqual(snapshot.annual.netIncome[0].value, 236_286_000);
});
