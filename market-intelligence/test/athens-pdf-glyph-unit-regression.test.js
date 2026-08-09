import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAthensFundamentalSnapshotFromText } from '../src/adapters/euronext-athens-fundamentals.js';

const company = {
  companyId: 'company:test:pdf-glyphs',
  displayName: 'Glyph Test Holdings',
  legalName: 'Glyph Test Holdings AG',
  sector: 'Consumer Discretionary',
  primaryListing: { symbol: 'GLYPH', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' },
};

const document = {
  title: 'Q1 2026 Condensed consolidated interim financial statements',
  pdfUrl: 'https://cdn.example.com/q1-2026-ifrs.pdf',
  identityVerified: true,
  sourceChannel: 'ISSUER_IR_OFFICIAL',
  identityBinding: 'CANONICAL_ISSUER_IR_DOMAIN',
  period: { year: 2026, months: 3, type: 'INTERIM_3M', periodEnd: '2026-03-31' },
};

test('late million-unit marker and common PDF glyph substitutions preserve accounting semantics', () => {
  const longFrontMatter = 'x'.repeat(10_500);
  const pages = [
    [
      longFrontMatter,
      'Amounts in millions of Euro',
      'Condensed consolidated statement of comprehensive income',
      'Three months ended 31 March',
      '2026 2025',
      'Total Revenue 767 617',
      'Profit after tax 111 126',
      'Weighted average number of ordinary shares 388,691,108 358,603,478',
    ].join('\n'),
    [
      'Condensed consolidated statement of financial posiƟon',
      'Amounts in millions of Euro',
      '31/3/2026 31/12/2025',
      'Cash and cash equivalents 2,435 767',
      'Total assets 19,733 2,181',
      'Total liabiliƟes 13,197 1,755',
      'Total equity 6,536 426',
      'Total equity and liabiliƟes 19,733 2,181',
    ].join('\n'),
    [
      'Condensed consolidated statement of cash flows',
      'Amounts in millions of Euro',
      '2026 2025',
      'Net cash generated from (+)/used in (-) operaƟng acƟviƟes 198 183',
      'AcquisiƟon of property, plant and equipment and intangible assets (23) (16)',
    ].join('\n'),
  ];

  const snapshot = buildAthensFundamentalSnapshotFromText(pages.join('\n\n'), document, company, {
    pages,
    extractionStatus: 'REVIEWED_PDF',
    generatedAt: '2026-08-08T15:00:00.000Z',
  });

  assert.equal(snapshot.reporting.scale, 1_000_000);
  assert.deepEqual(snapshot.annual.revenue.slice(0, 2).map((fact) => fact.value), [767_000_000, 617_000_000]);
  assert.deepEqual(snapshot.annual.netIncome.slice(0, 2).map((fact) => fact.value), [111_000_000, 126_000_000]);
  assert.equal(snapshot.annual.dilutedShares[0].value, 388_691_108, 'share counts must remain unscaled');
  assert.ok(snapshot.instant.cash, JSON.stringify({
    instant: snapshot.instant,
    coverage: snapshot.coverage,
    quality: snapshot.quality,
    annual: snapshot.annual,
    reporting: snapshot.reporting,
  }));
  assert.equal(snapshot.instant.cash.value, 2_435_000_000);
  assert.equal(snapshot.instant.assets.value, 19_733_000_000);
  assert.equal(snapshot.instant.liabilities.value, 13_197_000_000);
  assert.ok(snapshot.instant.equity, JSON.stringify({
    instant: snapshot.instant,
    coverage: snapshot.coverage,
    quality: snapshot.quality,
    annual: snapshot.annual,
  }));
  assert.equal(snapshot.instant.equity.value, 6_536_000_000);
  assert.equal(snapshot.quality.balanceSheetIntegrity.status, 'PASSED');
  assert.equal(snapshot.metricsReady, true);
  assert.equal(snapshot.annual.operatingCashFlow[0].value, 198_000_000);
  assert.equal(snapshot.annual.capitalExpenditure[0].value, -23_000_000);
});