import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchEuronextAthensFundamentals } from '../src/adapters/euronext-athens-fundamentals.js';
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

function pages() {
  const result = [
    `EXAMPLE ENTERTAINMENT AG\nCondensed consolidated interim financial statements for the three months ended 31 March 2026\nAmounts in millions of Euro\nCondensed consolidated statement of comprehensive income\nThree months ended 31 March\nNote 2026 2025\nTotal Revenue 6 767 617\nProfit after tax 111 126\nBasic and diluted earnings per share in € 0.28 0.34`,
    `EXAMPLE ENTERTAINMENT AG\nCondensed consolidated statement of financial position\nAmounts in millions of Euro\nNote 31/3/2026 31/12/2025\nCash and cash equivalents 18 2,435 767\nTotal assets 19,733 2,181\nTotal liabilities 13,197 1,755\nTotal equity 6,536 426\nTotal equity and liabilities 19,733 2,181`,
  ];
  while (result.length < 22) result.push(`Notes to the condensed consolidated interim financial statements page ${result.length + 1}`);
  result.push(`Earnings per share\nThree months ended 31 March 2026 2025\nNet profit attributable to owners of the Company 109 123\nWeighted average number of ordinary shares 388,691,108 358,603,478\nBasic and diluted earnings per share in € 0.28 0.34`);
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
  assert.equal(result.snapshot.metricsReady, true);
  assert.equal(result.snapshot.sourceDocument.sourceChannel, 'ISSUER_IR_OFFICIAL');
  assert.equal(result.snapshot.sourceDocument.sourceRole, 'PRIMARY_ISSUER_FINANCIAL_DOCUMENT');
  assert.equal(result.snapshot.sourceDocument.identityBinding, 'CANONICAL_ISSUER_IR_DOMAIN');
  assert.equal(result.snapshot.sourceDocument.candidateSelection.reviewedSelected, true);
  assert.equal(result.snapshot.annual.dilutedShares[0].value, 388691108);
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
