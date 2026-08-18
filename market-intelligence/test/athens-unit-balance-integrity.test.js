import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAthensFundamentalSnapshotFromText } from '../src/adapters/euronext-athens-fundamentals.js';

const company = {
  companyId: 'company:xath:flexo-fixture',
  displayName: 'FLEXOPACK S.A.',
  legalName: 'FLEXOPACK S.A.',
  sector: 'Industrials',
  primaryListing: { symbol: 'FLEXO', currency: 'EUR', mic: 'XATH' },
};

const document = {
  title: 'Financial report FLEXOPACK S.A. (2025,Six-Month Statement,Consolidated)',
  identityVerified: true,
  identityScore: 100,
  period: { year: 2025, months: 6, type: 'INTERIM_6M', periodEnd: '2025-06-30' },
  pdfUrl: 'https://athens.euronext.com/flexo-h1-2025.pdf',
};

function validPages() {
  return [
    `FLEXOPACK S.A.\nINTERIM FINANCIAL REPORT\n(Amounts in € thousand)`,
    `Statement of financial position commentary\nGroup assets increased to 132.863 million Euros whereas the cash and cash equivalents settled at 31.622 million Euros.`,
    `Condensed Income Statement\nTurnover    82,435    76,682    63,260    59,428\nNet profit for the period    9,250    8,400\nBasic and diluted    0,4212    0,3890`,
    `Statement of Financial Position\nCash and cash equivalents    31,622    30,000\nTotal Assets    218,947    223,535    191,147    191,288\nTotal Liabilities    86,083    92,381    74,427    75,467\nTotal Equity    132,864    131,154    116,720    115,821\nTotal Equity & Liabilities    218,947    223,535    191,147    191,288`,
  ];
}

test('Athens thousand-scale tables distinguish monetary thousands from EPS decimals and reject narrative label matches', () => {
  const pages = validPages();
  const snapshot = buildAthensFundamentalSnapshotFromText(pages.join('\f'), document, company, { pages });

  assert.equal(snapshot.reporting.scale, 1_000);
  assert.equal(snapshot.annual.revenue[0].value, 82_435_000);
  assert.equal(snapshot.annual.revenue[1].value, 76_682_000);
  assert.equal(snapshot.annual.revenue[0].provenance.numberMode, 'FINANCIAL_AMOUNT');
  assert.equal(snapshot.annual.netIncome[0].value, 9_250_000);
  assert.ok(snapshot.annual.dilutedShares[0].value > 20_000_000);
  assert.ok(snapshot.annual.dilutedShares[0].value < 25_000_000);

  assert.equal(snapshot.instant.cash.value, 31_622_000);
  assert.equal(snapshot.instant.assets.value, 218_947_000);
  assert.equal(snapshot.instant.liabilities.value, 86_083_000);
  assert.equal(snapshot.instant.equity.value, 132_864_000);
  assert.equal(snapshot.instant.cash.provenance.extractedLine.startsWith('Cash and cash equivalents'), true);
  assert.equal(snapshot.instant.equity.provenance.extractedLine.startsWith('Total Equity    '), true);
  assert.equal(snapshot.instant.equity.provenance.extractedLine.includes('& Liabilities'), false);
  assert.equal(snapshot.quality.rowLabelPolicy, 'ROW_LABEL_ANCHORED_V1');
  assert.equal(snapshot.quality.numericSemanticsPolicy, 'FINANCIAL_TABLE_NUMBER_V1');
  assert.equal(snapshot.quality.balanceSheetIntegrity.status, 'PASSED');
  assert.equal(snapshot.quality.balanceSheetIntegrity.balanceEquationDifferencePct, 0);
});

test('balance-sheet sanity fails closed when scale or row selection creates impossible accounting values', () => {
  const pages = [
    `FLEXOPACK S.A.\nINTERIM FINANCIAL REPORT\n(Amounts in € thousand)`,
    `Condensed Income Statement\nTurnover    82,435    76,682\nNet profit for the period    9,250    8,400\nBasic and diluted    0,4212    0,3890`,
    `Statement of Financial Position\nCash and cash equivalents    500,000    450,000\nTotal Assets    218,947    223,535\nTotal Liabilities    86,083    92,381\nTotal Equity    50,000    48,000`,
  ];
  const snapshot = buildAthensFundamentalSnapshotFromText(pages.join('\f'), document, company, { pages });

  assert.equal(snapshot.quality.balanceSheetIntegrity.status, 'FAILED');
  assert.ok(snapshot.quality.balanceSheetIntegrity.issues.includes('CASH_EXCEEDS_ASSETS'));
  assert.ok(snapshot.quality.balanceSheetIntegrity.issues.includes('BALANCE_SHEET_EQUATION_FAILED'));
  assert.equal(snapshot.metricsReady, false);
});

test('row-label anchoring rejects a metric word embedded in prose even on an accounting-statement page', () => {
  const pages = [
    `FLEXOPACK S.A.\n(Amounts in € thousand)`,
    `Statement of Financial Position\nThe Group reported that cash and cash equivalents settled at 31.622 million Euros.\nCash and cash equivalents    31,622    30,000\nTotal Assets    218,947    223,535\nTotal Liabilities    86,083    92,381\nTotal Equity    132,864    131,154`,
    `Condensed Income Statement\nTurnover    82,435    76,682\nNet profit for the period    9,250    8,400\nBasic and diluted    0,4212    0,3890`,
  ];
  const snapshot = buildAthensFundamentalSnapshotFromText(pages.join('\f'), document, company, { pages });

  assert.equal(snapshot.instant.cash.value, 31_622_000);
  assert.equal(snapshot.instant.cash.provenance.extractedLine, 'Cash and cash equivalents    31,622    30,000');
  assert.equal(snapshot.instant.cash.provenance.labelScore, 100);
});
