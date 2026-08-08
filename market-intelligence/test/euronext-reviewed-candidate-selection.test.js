import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchEuronextAthensFundamentals } from '../src/adapters/euronext-athens-fundamentals.js';
import { buildPageProvenance } from '../src/pdf-extractor.js';

const company = {
  companyId: 'company:test:reviewed-candidate',
  displayName: 'Example Industries',
  legalName: 'Example Industries S.A.',
  sector: 'Industrials',
  issuerId: '991',
  primaryListing: { symbol: 'EXAM', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' },
};

function financialIndexHtml() {
  return `<table><tbody>
    <tr><td>Example Industries S.A. 2026 Six-Month Financial Statements</td><td>08-08-2026 12:00</td><td><a href="/files/example-h1-2026-image.pdf">DownloadPDF</a></td></tr>
    <tr><td>Example Industries S.A. 2025 Six-Month Financial Statements</td><td>30-09-2025 12:00</td><td><a href="/files/example-h1-2025-full.pdf">DownloadPDF</a></td></tr>
  </tbody></table>`;
}

function fullStatementPages() {
  return [
    `EXAMPLE INDUSTRIES S.A.\nSummary interim financial statements\nAmounts in EUR thousands, unless otherwise stated\nStatement of Financial Position\nGROUP COMPANY\nNote 30-Jun-25 31-Dec-24 30-Jun-25 31-Dec-24\nCash and cash equivalents 11 201,685 172,892 16,972 3,859\nTOTAL ASSETS 1,286,447 1,503,248 450,969 579,099\nTotal equity 432,317 776,796 404,474 464,673\nTotal liabilities 854,130 726,452 46,495 114,426`,
    `EXAMPLE INDUSTRIES S.A.\nSummary interim financial statements\nAmounts in EUR thousands, unless otherwise stated\nIncome Statement H1 2025 and 2024\nGROUP\n1-Jan to\nNote 30-Jun-25 30-Jun-24\nContinuing Discontinued Total Continuing\noperations operations operations\nDiscontinued\noperations\nTotal\nSales 5 8,945 40,613 49,558 113,974 78,699 192,673\nNet profit/(loss) for the period (33,200) 3,266 (29,934) 39,746 7,085 46,831`,
  ];
}

function reviewedExtraction(pages) {
  const built = buildPageProvenance(pages);
  return {
    status: 'REVIEWED_PDF',
    reviewed: true,
    text: built.text,
    pages: built.pages,
    diagnostics: [],
  };
}

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

test('candidate review skips a newer image-only PDF and selects the next reviewed financial statement', async () => {
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('/financial-data')) return response(financialIndexHtml(), { url: value });
    if (value.includes('/announcements')) return response('<table><tbody></tbody></table>', { url: value });
    if (value.endsWith('/files/example-h1-2026-image.pdf')) return response('IMAGE_ONLY');
    if (value.endsWith('/files/example-h1-2025-full.pdf')) return response('FULL_STATEMENT');
    return response('', { ok: false, status: 404, url: value });
  };

  const pdfExtractor = async (buffer) => {
    const marker = buffer.toString('utf8');
    if (marker === 'IMAGE_ONLY') {
      return {
        status: 'PDF_TEXT_TOO_SHORT',
        reviewed: false,
        text: 'image only',
        pages: [],
        diagnostics: [{ code: 'PDF_TEXT_TOO_SHORT', textLength: 10, pageCount: 19 }],
      };
    }
    if (marker === 'FULL_STATEMENT') return reviewedExtraction(fullStatementPages());
    throw new Error(`Unexpected PDF marker ${marker}`);
  };

  const result = await fetchEuronextAthensFundamentals(company, {
    fetchImpl,
    pdfExtractor,
    generatedAt: '2026-08-08T13:00:00.000Z',
  });

  assert.ok(result.snapshot);
  assert.match(result.snapshot.sourceUrl, /example-h1-2025-full\.pdf$/);
  assert.equal(result.snapshot.sourceDocument.candidateSelection.reviewedSelected, true);
  assert.equal(result.snapshot.sourceDocument.candidateSelection.candidateRank, 2);
  assert.ok(result.snapshot.coverage.available >= 3);
  assert.ok(result.diagnostics.some((item) => item.code === 'EURONEXT_FINANCIAL_CANDIDATE_REJECTED' && item.candidateRank === 1 && item.reason === 'PDF_NOT_REVIEWED'));
  assert.ok(result.diagnostics.some((item) => item.code === 'EURONEXT_FINANCIAL_REVIEWED_CANDIDATE_SELECTED' && item.candidateRank === 2));
});

test('reviewed prose with zero accounting coverage is rejected before a real statement is selected', async () => {
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('/financial-data')) return response(financialIndexHtml(), { url: value });
    if (value.includes('/announcements')) return response('<table><tbody></tbody></table>', { url: value });
    if (value.endsWith('/files/example-h1-2026-image.pdf')) return response('PROSE_ONLY');
    if (value.endsWith('/files/example-h1-2025-full.pdf')) return response('FULL_STATEMENT');
    return response('', { ok: false, status: 404, url: value });
  };

  const pdfExtractor = async (buffer) => {
    const marker = buffer.toString('utf8');
    if (marker === 'PROSE_ONLY') {
      const prose = 'Investor update and management commentary without accounting statements. '.repeat(20);
      return reviewedExtraction([prose]);
    }
    if (marker === 'FULL_STATEMENT') return reviewedExtraction(fullStatementPages());
    throw new Error(`Unexpected PDF marker ${marker}`);
  };

  const result = await fetchEuronextAthensFundamentals(company, {
    fetchImpl,
    pdfExtractor,
    generatedAt: '2026-08-08T13:00:00.000Z',
  });

  assert.ok(result.snapshot);
  assert.equal(result.snapshot.sourceDocument.candidateSelection.candidateRank, 2);
  assert.ok(result.diagnostics.some((item) => item.code === 'EURONEXT_FINANCIAL_CANDIDATE_REJECTED' && item.candidateRank === 1 && item.reason === 'INSUFFICIENT_FINANCIAL_STATEMENT_CONTENT'));
});
