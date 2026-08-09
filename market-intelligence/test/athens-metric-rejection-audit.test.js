import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAthensFundamentalSnapshotFromText } from '../src/adapters/euronext-athens-fundamentals.js';

const company = {
  companyId: 'company:test:rejection-audit',
  displayName: 'Audit Fixture S.A.',
  legalName: 'Audit Fixture S.A.',
  sector: 'Industrials',
  primaryListing: { symbol: 'AUDIT', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' },
};

const document = {
  title: 'Audit Fixture 2026 Six-Month Statement Consolidated',
  pdfUrl: 'https://athens.euronext.com/audit-fixture.pdf',
  identityVerified: true,
  period: { year: 2026, months: 6, type: 'INTERIM_6M', periodEnd: '2026-06-30' },
};

test('missing accounting metrics expose bounded rejection reasons without changing accepted facts', () => {
  const pages = [
    [
      'Interim financial statements',
      'Condensed consolidated income statement',
      'Amounts in EUR thousands',
      'Revenue 100 90',
      'Profit after tax 10 9',
      'Weighted average number of ordinary shares 1000000 900000',
    ].join('\n'),
    [
      'Interim financial statements',
      'Condensed consolidated statement of financial position',
      'Amounts in EUR thousands',
      'Cash and cash equivalents at end of period 120 110',
      'Total assets 500',
      'Total liabilities details 300 280',
      'Total equity 200 180',
    ].join('\n'),
    [
      'Interim financial statements',
      'Condensed consolidated statement of cash flows',
      'Amounts in EUR thousands',
      'Net cash generated from operating activities 20 18',
      'Acquisition of property, plant and equipment and intangible assets related to expansion (5) (4)',
    ].join('\n'),
  ];

  const snapshot = buildAthensFundamentalSnapshotFromText(pages.join('\f'), document, company, {
    pages,
    extractionStatus: 'REVIEWED_PDF',
    generatedAt: '2026-08-09T10:00:00.000Z',
  });

  assert.equal(snapshot.instant.equity.value, 200_000, 'accepted accounting facts must remain unchanged');
  assert.equal(snapshot.instant.cash, null);
  assert.equal(snapshot.instant.assets, null);
  assert.equal(snapshot.instant.liabilities, null);
  assert.equal(snapshot.annual.capitalExpenditure.length, 0);

  const audit = snapshot.quality.metricRejectionAudit;
  assert.ok(audit && typeof audit === 'object');
  assert.equal(audit.equity, undefined, 'accepted metrics must not create rejection audit noise');
  assert.ok(audit.cash.some((item) => item.reason === 'EXCLUDED_VARIANT'));
  assert.ok(audit.assets.some((item) => item.reason === 'INSUFFICIENT_NUMBERS'));
  assert.ok(audit.liabilities.some((item) => item.reason === 'ROW_TAIL_REJECTED'));
  assert.ok(audit.capitalExpenditure.some((item) => item.reason === 'ROW_TAIL_REJECTED'));

  for (const entries of Object.values(audit)) {
    assert.ok(entries.length <= 12);
    for (const item of entries) {
      assert.ok(String(item.physicalLine || '').length <= 360);
      assert.ok(String(item.scopedLine || '').length <= 280);
    }
  }
});
