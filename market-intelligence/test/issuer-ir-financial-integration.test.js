import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchEuronextAthensFundamentals } from '../src/adapters/euronext-athens-fundamentals.js';
import { resolveCanonicalIssuerFinancialDocuments } from '../src/adapters/issuer-ir-financial-resolver.js';
import { buildPageProvenance } from '../src/pdf-extractor.js';
import { buildStructuredDecisionEvidence } from '../src/decision-evidence.js';

const company = {
  companyId: 'company:test:issuer-ir',
  displayName: 'Example Entertainment',
  legalName: 'Example Entertainment AG',
  issuerId: '777',
  sector: 'Consumer Discretionary',
  website: 'https://www.example.com/',
  investorRelationsUrl: 'https://www.example.com/investors',
  primaryListing: { symbol: 'EXAM', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' },
};

function response(body, options = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    url: options.url || null,
    text: async () => buffer.toString('utf8'),
    arrayBuffer: async () => buffer,
  };
}

function rowWithNote(label, noteColumn, note, current, previous, trailing = '') {
  const padding = ' '.repeat(Math.max(1, noteColumn - label.length));
  return `${label}${padding}${note}          ${current}          ${previous}${trailing}`;
}

function rowWithoutNote(label, currentColumn, current, previous, trailing = '') {
  const padding = ' '.repeat(Math.max(1, currentColumn - label.length));
  return `${label}${padding}${current}          ${previous}${trailing}`;
}

function pages() {
  const noteColumn = 46;
  const currentColumn = 59;
  const incomeHeader = `${' '.repeat(noteColumn)}Note          2026          2025`;
  const balanceHeader = `${' '.repeat(noteColumn)}Note          31/3/2026     31/12/2025`;
  const result = [
    [
      'EXAMPLE ENTERTAINMENT AG',
      'Condensed consolidated interim financial statements for the three months ended 31 March 2026',
      'Amounts in millions of Euro',
      'Condensed consolidated statement of comprehensive income',
      'Three months ended 31 March',
      incomeHeader,
      rowWithNote('Total Revenue', noteColumn, '6', '767', '617', '                    Remeasurement reserve          25          13          –'),
      rowWithoutNote('Profit after tax', currentColumn, '111', '126'),
      rowWithoutNote('Basic and diluted earnings per share in €', currentColumn, '0.28', '0.34'),
    ].join('\n'),
    [
      'EXAMPLE ENTERTAINMENT AG',
      'Condensed consolidated statement of financial position',
      'Amounts in millions of Euro',
      balanceHeader,
      rowWithNote('Cash and cash equivalents', noteColumn, '18', '2,435', '767', '                    Other disclosure          4          3'),
      rowWithoutNote('Total assets', currentColumn, '19,733', '2,181'),
      rowWithoutNote('Total liabilities', currentColumn, '13,197', '1,755'),
      rowWithoutNote('Total equity', currentColumn, '6,536', '426'),
      rowWithoutNote('Total equity and liabilities', currentColumn, '19,733', '2,181'),
    ].join('\n'),
  ];
  while (result.length < 22) result.push(`Notes to the condensed consolidated interim financial statements page ${result.length + 1}`);
  result.push([
    'Earnings per share',
    'Three months ended 31 March 2026 2025',
    'Net profit attributable to owners of the Company 109 123',
    'Weighted average number of ordinary shares 388,691,108 358,603,478',
    'Basic and diluted earnings per share in € 0.28 0.34',
  ].join('\n'));
  return result;
}

function reviewedPdf() {
  const built = buildPageProvenance(pages());
  return { status: 'REVIEWED_PDF', reviewed: true, text: built.text, pages: built.pages, diagnostics: [] };
}

test('canonical issuer IR PDF is discovered generically and retains issuer provenance', async () => {
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('athens.euronext.com') && value.includes('/financial-data')) return response('<table><tbody></tbody></table>', { url: value });
    if (value.includes('athens.euronext.com') && value.includes('/announcements')) return response('<table><tbody></tbody></table>', { url: value });
    if (value === 'https://www.example.com/investors') {
      return response('<a href="/investors-news/q1-2026-condensed-consolidated-interim-financial-statements">Q1 2026 Condensed consolidated interim financial statements</a>', { url: value });
    }
    if (value === 'https://www.example.com/investors-news/q1-2026-condensed-consolidated-interim-financial-statements') {
      return response('<h1>Q1 2026 Condensed consolidated interim financial statements</h1><p>11 June 2026</p><a href="https://cdn.example.com/example_q1_2026_ifrs.pdf">Download PDF</a>', { url: value });
    }
    if (value === 'https://cdn.example.com/example_q1_2026_ifrs.pdf') return response('IFRS_PDF', { url: value });
    return response('', { ok: false, status: 404, url: value });
  };

  const result = await fetchEuronextAthensFundamentals(company, {
    fetchImpl,
    pdfExtractor: async (buffer) => {
      assert.equal(buffer.toString('utf8'), 'IFRS_PDF');
      return reviewedPdf();
    },
    generatedAt: '2026-08-08T14:00:00.000Z',
  });

  assert.ok(result.snapshot);
  assert.equal(result.snapshot.metricsReady, true, JSON.stringify({
    coverage: result.snapshot.coverage,
    metrics: result.snapshot.metrics,
    annual: result.snapshot.annual,
    instant: result.snapshot.instant,
    quality: result.snapshot.quality,
    reporting: result.snapshot.reporting,
    sourceDocument: result.snapshot.sourceDocument,
    diagnostics: result.diagnostics,
  }));
  assert.equal(result.snapshot.sourceDocument.sourceChannel, 'ISSUER_IR_OFFICIAL');
  assert.equal(result.snapshot.sourceDocument.sourceRole, 'PRIMARY_ISSUER_FINANCIAL_DOCUMENT');
  assert.equal(result.snapshot.sourceDocument.identityBinding, 'CANONICAL_ISSUER_IR_DOMAIN');
  assert.equal(result.snapshot.sourceDocument.candidateSelection.reviewedSelected, true);

  assert.deepEqual(result.snapshot.annual.revenue.slice(0, 2).map((fact) => fact.value), [767_000_000, 617_000_000]);
  assert.equal(result.snapshot.annual.revenue[0].provenance.statementColumnPolicy, 'ALIGNED_NOTE_COLUMN_VALUES_V1');
  assert.equal(result.snapshot.annual.dilutedShares[0].value, 388_691_108);
  assert.equal(result.snapshot.instant.cash.value, 2_435_000_000);
  assert.equal(result.snapshot.instant.assets.value, 19_733_000_000);
  assert.equal(result.snapshot.instant.liabilities.value, 13_197_000_000);
  assert.equal(result.snapshot.instant.equity.value, 6_536_000_000);
  assert.equal(result.snapshot.quality.balanceSheetIntegrity.status, 'PASSED');
  assert.ok(result.snapshot.coverage.available >= 6);

  for (const fact of [
    ...result.snapshot.annual.revenue,
    ...result.snapshot.annual.netIncome,
    result.snapshot.instant.cash,
    result.snapshot.instant.assets,
    result.snapshot.instant.liabilities,
    result.snapshot.instant.equity,
  ].filter(Boolean)) {
    assert.equal(fact.provenance.sourceRole, 'PRIMARY_ISSUER_FINANCIAL_DOCUMENT');
    assert.ok(Number(fact.provenance.statementAuthorityScore) > 0);
  }

  const structured = buildStructuredDecisionEvidence({
    company,
    fundamentals: result.snapshot,
    generatedAt: '2026-08-08T14:00:00.000Z',
  });
  const evidence = structured.records.find((record) => record.sourceType === 'STRUCTURED_FUNDAMENTALS');
  assert.ok(evidence);
  assert.equal(evidence.sourceName, 'Issuer reviewed financial statements');
  assert.equal(evidence.document.sourceRole, 'PRIMARY_ISSUER_FINANCIAL_DOCUMENT');
  assert.equal(evidence.eventClaimEligible, false);
});

test('off-domain PDF linked from issuer page is rejected', async () => {
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('athens.euronext.com')) return response('<table><tbody></tbody></table>', { url: value });
    if (value === 'https://www.example.com/investors') {
      return response('<a href="/investors-news/q1-2026-results">Q1 2026 financial results</a>', { url: value });
    }
    if (value === 'https://www.example.com/investors-news/q1-2026-results') {
      return response('<h1>Q1 2026 financial statements</h1><a href="https://evil.example.net/fake.pdf">Download PDF</a>', { url: value });
    }
    return response('', { ok: false, status: 404, url: value });
  };

  const result = await fetchEuronextAthensFundamentals(company, {
    fetchImpl,
    pdfExtractor: async () => { throw new Error('off-domain PDF must never be fetched'); },
    generatedAt: '2026-08-08T14:00:00.000Z',
  });
  assert.equal(result.snapshot, null);
  assert.ok(result.diagnostics.some((item) => item.code === 'ISSUER_IR_FINANCIAL_DOCUMENT_NOT_FOUND'));
});

test('exchange and regulator pages can never become issuer-owned IR channels', async () => {
  const platformCompany = {
    companyId: 'company:test:platform-ir',
    displayName: 'Platform-bound issuer',
    website: 'https://athens.euronext.com/en/market-data/issuers/881',
    investorRelationsUrl: 'https://athens.euronext.com/en/market-data/issuers/881',
    primaryListing: { symbol: 'PPC', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' },
  };
  const result = await resolveCanonicalIssuerFinancialDocuments(platformCompany, {
    fetchImpl: async () => { throw new Error('non-issuer platform must never be fetched as issuer IR'); },
  });
  assert.deepEqual(result.candidates, []);
  const diagnostic = result.diagnostics.find((item) => item.code === 'ISSUER_IR_FINANCIAL_CHANNEL_UNAVAILABLE');
  assert.ok(diagnostic);
  assert.equal(diagnostic.reason, 'NON_ISSUER_PLATFORM_ROOT');
});
