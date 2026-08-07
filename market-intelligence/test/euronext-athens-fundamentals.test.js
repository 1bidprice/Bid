import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAthensFundamentalSnapshotFromText,
  extractAthensFinancialDocuments,
} from '../src/adapters/euronext-athens-fundamentals.js';
import { assessFundamentalRisk } from '../src/fundamental-risk.js';

const kri = {
  companyId: 'company:xath:issuer-965',
  displayName: 'KRI-KRI SA',
  legalName: 'KRI-KRI S.A.',
  sector: 'Consumer Staples',
  issuerId: '965',
  primaryListing: { symbol: 'KRI', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' },
};

const kriHtml = `
<table><tbody>
<tr>
<td><a href="/en/node/966699">Financial statement KRI-KRI S.A. (2026,Three-Month Statement,Parent)</a></td>
<td>27-05-2026 17:44</td>
<td><a href="/sites/default/files/hermes_3/2026-05/kri-2026-q1.pdf">DownloadPDF</a></td>
</tr>
<tr>
<td><a href="/en/node/old">Financial report KRI-KRI S.A. (2025,Six-Month Statement,Parent)</a></td>
<td>18-09-2025 17:32</td>
<td><a href="/sites/default/files/hermes_3/2025-09/kri-2025-h1.pdf">DownloadPDF</a></td>
</tr>
</tbody></table>`;

const kriPages = [
`KRI-KRI MILK INDUSTRY S.A.
INTERIM FINANCIAL STATEMENTS
01.01.2026 – 31.03.2026
(Amounts in €)`,
`Condensed Statement of Comprehensive Income
Note. 1/1-31/3/2026 1/1-31/3/2025
Sales C.1 89.898.940 66.378.993
Profit before taxes 17.826.852 8.977.250
Net profit for the period (A) 13.894.424 7.246.005
- Basic and diluted (in €) 0,4212 0,2197`,
`Condensed Statement of Financial Position
Note 31/3/2026 31/12/2025
Cash and cash equivalents 23.000.723 24.067.688
Total assets 243.131.345 219.796.991
Total equity 161.907.975 148.013.550
Total liabilities 81.223.370 71.783.442`,
`Condensed Statement of cash flows
Cash flow from operating activities (a) 5.324.747 (6.469.946)
Purchase of tangible and intangible assets (3.331.702) (3.699.015)`,
];

test('Athens financial index selects the newest identity-verified official PDF', () => {
  const documents = extractAthensFinancialDocuments(kriHtml, kri);
  assert.equal(documents.length, 2);
  assert.equal(documents[0].identityVerified, true);
  assert.equal(documents[0].period.type, 'INTERIM_3M');
  assert.equal(documents[0].period.periodEnd, '2026-03-31');
  assert.ok(documents[0].pdfUrl.endsWith('kri-2026-q1.pdf'));
});

test('Athens fundamental passport extracts statement metrics with page-level provenance and derives diluted shares from reported EPS', () => {
  const document = extractAthensFinancialDocuments(kriHtml, kri)[0];
  const snapshot = buildAthensFundamentalSnapshotFromText(kriPages.join('\f'), document, kri, {
    generatedAt: '2026-08-07T12:00:00.000Z',
    pages: kriPages,
    extractionStatus: 'REVIEWED_PDF',
  });

  assert.equal(snapshot.metricsReady, true);
  assert.equal(snapshot.reporting.periodMonths, 3);
  assert.equal(snapshot.reporting.annualComparable, false);
  assert.equal(snapshot.annual.revenue[0].value, 89_898_940);
  assert.equal(snapshot.annual.netIncome[0].value, 13_894_424);
  assert.equal(snapshot.instant.cash.value, 23_000_723);
  assert.equal(snapshot.instant.assets.value, 243_131_345);
  assert.equal(snapshot.instant.liabilities.value, 81_223_370);
  assert.equal(snapshot.instant.equity.value, 161_907_975);
  assert.ok(snapshot.annual.dilutedShares[0].value > 32_000_000);
  assert.ok(snapshot.annual.dilutedShares[0].value < 34_000_000);
  assert.equal(snapshot.annual.revenue[0].provenance.pageNumber, 2);
  assert.equal(snapshot.metrics.latestFreeCashFlow, 1_993_045);
});

test('interim fundamentals never masquerade as annual valuation inputs', () => {
  const document = extractAthensFinancialDocuments(kriHtml, kri)[0];
  const snapshot = buildAthensFundamentalSnapshotFromText(kriPages.join('\f'), document, kri, { pages: kriPages });
  const risk = assessFundamentalRisk(snapshot, 29.15, { companyId: kri.companyId, currency: 'EUR' });
  assert.equal(risk.metricsReady, true);
  assert.equal(risk.profitability.flowPeriodMonths, 3);
  assert.equal(risk.profitability.annualComparable, false);
  assert.equal(risk.valuation.priceToSales, null);
  assert.equal(risk.balanceSheet.cashRunwayYears, null);
});

test('issuer transition mismatch is fail-closed: OPAP historical documents are not silently treated as Allwyn fundamentals', () => {
  const allwyn = {
    companyId: 'company:allwyn-ag',
    displayName: 'Allwyn',
    legalName: 'Allwyn AG',
    issuerId: '863',
    primaryListing: { symbol: 'ALWN', mic: 'XATH', exchange: 'Euronext Athens' },
  };
  const html = `<table><tr><td><a href="/en/node/1">Financial statement OPAP SA (2025,Nine-Month Statement,Consolidated)</a></td><td>25-11-2025 17:52</td><td><a href="/files/opap.pdf">DownloadPDF</a></td></tr></table>`;
  const documents = extractAthensFinancialDocuments(html, allwyn);
  assert.equal(documents.length, 1);
  assert.equal(documents[0].identityVerified, false);
});

test('Athens parser rejects table-of-contents numbers and preserves the first real financial columns', () => {
  const premia = {
    companyId: 'company:xath:term-357',
    displayName: 'PREMIA REAL ESTATE INVESTMENT COMPANY SOCIETE ANOMYME',
    legalName: 'PREMIA R.E.I.C.',
    sector: 'Real Estate',
    primaryListing: { symbol: 'PREMIA', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' },
  };
  const document = {
    title: 'Financial report PREMIA R.E.I.C. (2025,Six-Month Statement,Consolidated)',
    identityVerified: true,
    period: { year: 2025, months: 6, type: 'INTERIM_6M', periodEnd: '2025-06-30' },
    pdfUrl: 'https://athens.euronext.com/premia-h1-2025.pdf',
  };
  const pages = [
    `PREMIA R.E.I.C.\nINTERIM FINANCIAL REPORT\n(Amounts in €)`,
    `TABLE OF CONTENTS\n6.25 Revenue from sale of inventories ........................................................................ 57\n6.11 Cash and cash equivalents ................................................................................... 49`,
    `Profit after tax was formed at € 9.25 million against profit € 18.06 million in the corresponding half of 2024, presenting a decrease.`,
    `Statement of comprehensive income\nRevenue from sale of inventories    12.500.000    10.000.000\nStatement of financial position\nCash and cash equivalents    6.110.000    5.500.000\nTotal assets    500.000.000    470.000.000    450.000.000\nTotal liabilities    250.000.000    240.000.000\nTotal equity    250.000.000    230.000.000`,
  ];

  const snapshot = buildAthensFundamentalSnapshotFromText(pages.join('\f'), document, premia, { pages, extractionStatus: 'REVIEWED_PDF' });

  assert.equal(snapshot.annual.revenue[0].value, 12_500_000);
  assert.equal(snapshot.annual.revenue[1].value, 10_000_000);
  assert.equal(snapshot.annual.netIncome[0].value, 9_250_000);
  assert.equal(snapshot.annual.netIncome[1].value, 18_060_000);
  assert.equal(snapshot.instant.cash.value, 6_110_000);
  assert.equal(snapshot.instant.assets.value, 500_000_000);
  assert.equal(snapshot.instant.assets.provenance.extractedLine.includes('500.000.000'), true);
  assert.notEqual(snapshot.annual.revenue[0].value, 6.25);
  assert.notEqual(snapshot.annual.netIncome[1].value, 2024);
});

test('fundamental risk infers EUR from the audited Athens snapshot and fails closed on a currency mismatch', () => {
  const document = extractAthensFinancialDocuments(kriHtml, kri)[0];
  const snapshot = buildAthensFundamentalSnapshotFromText(kriPages.join('\f'), document, kri, { pages: kriPages });

  const inferred = assessFundamentalRisk(snapshot, 29.15, { companyId: kri.companyId });
  assert.equal(inferred.currency, 'EUR');
  assert.equal(inferred.reportedCurrency, 'EUR');
  assert.equal(inferred.currencyConsistent, true);
  assert.equal(inferred.metricsReady, true);

  const mismatch = assessFundamentalRisk(snapshot, 29.15, { companyId: kri.companyId, currency: 'USD' });
  assert.equal(mismatch.currency, 'USD');
  assert.equal(mismatch.reportedCurrency, 'EUR');
  assert.equal(mismatch.currencyConsistent, false);
  assert.equal(mismatch.metricsReady, false);
  assert.equal(mismatch.riskDataStatus, 'INSUFFICIENT_DATA');
});
