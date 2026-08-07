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

test('Athens extractor rejects narrative ordinals and dates and uses actual statement rows', () => {
  const pages = [
    `ELLAKTOR S.A.\nINTERIM FINANCIAL REPORT\n(Amounts in € thousand)`,
    `The Group's consolidated revenues for the 1st half of 2025 amounted to EUR 49.6 million, of which EUR 12.4 million related to a subsidiary.\nThe Group's cash and cash equivalents as of 30.06.2025 stood at €262.1 million.`,
    `Condensed income statement\nRevenue    49.600    44.100\nNet profit for the period    8.500    7.900\nBasic and diluted    0,10    0,09`,
    `Statement of financial position\nCash and cash equivalents    262.100    210.000\nTotal assets    1.200.000    1.150.000\nTotal liabilities    700.000    690.000\nTotal equity    500.000    460.000`,
  ];

  const snapshot = buildAthensFundamentalSnapshotFromText(pages.join('\f'), document, company, { pages });

  assert.equal(snapshot.annual.revenue[0].value, 49_600_000);
  assert.equal(snapshot.annual.revenue[1].value, 44_100_000);
  assert.equal(snapshot.annual.revenue[0].provenance.pageNumber, 3);
  assert.equal(snapshot.instant.cash.value, 262_100_000);
  assert.equal(snapshot.instant.cash.provenance.pageNumber, 4);
  assert.notEqual(snapshot.annual.revenue[0].value, 1_000_000);
  assert.notEqual(snapshot.instant.cash.value, 30_062_025_000);
});
