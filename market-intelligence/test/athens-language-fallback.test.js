import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchEuronextAthensFundamentals } from '../src/adapters/euronext-athens-fundamentals.js';

function htmlResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body; },
  };
}

function pdfResponse() {
  return {
    ok: true,
    status: 200,
    async arrayBuffer() { return new Uint8Array([37, 80, 68, 70]).buffer; },
  };
}

const credia = {
  companyId: 'company:crediabank',
  displayName: 'CrediaBank',
  legalName: 'CrediaBank S.A.',
  issuerId: '50',
  sector: 'Financials',
  primaryListing: { symbol: 'CREDIA', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' },
};

const staleEnglish = `
<table><tbody>
<tr><td><a href="/en/node/653793">Figures and Information (HCMC), ATTICA BANK S.A. (2016/Nine-Month Statement/Consolidated)</a></td><td>19-12-2016 18:16</td><td></td></tr>
</tbody></table>`;

const currentGreek = `
<table><tbody>
<tr>
<td><a href="/el/more-options/announcements/oikonomiki-katastasi-crediabank-ate-2026examiniaiaenopoiimeni">Οικονομική κατάσταση CrediaBank Α.Τ.Ε. (2026,Εξαμηνιαία,Ενοποιημένη)</a></td>
<td>06-08-2026 17:49</td>
<td><a href="https://athens.euronext.com/sites/default/files/hermes_3/2026-08/el/crediabank-h1-2026.pdf">Λήψη<br><span>PDF</span></a></td>
</tr>
</tbody></table>`;

const pages = [
  'CrediaBank A.T.E.\nInterim financial statements\nAmounts in EUR thousands',
  'Income Statement\nRevenue 100,000 90,000\nNet profit for the period 10,000 8,000',
  'Statement of Financial Position\nCash and cash equivalents 50,000 45,000\nTotal assets 1,000,000 950,000\nTotal liabilities 900,000 860,000\nTotal equity 100,000 90,000',
];
const text = pages.join('\f');

test('Athens fundamentals fall back from stale English index to the current official Greek issuer index', async () => {
  const calls = [];
  const result = await fetchEuronextAthensFundamentals(credia, {
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('/en/market-data/issuers/50/financial-data')) return htmlResponse(staleEnglish);
      if (String(url).includes('/el/market-data/issuers/50/financial-data')) return htmlResponse(currentGreek);
      if (String(url).includes('crediabank-h1-2026.pdf')) return pdfResponse();
      throw new Error(`unexpected URL ${url}`);
    },
    pdfExtractor: async () => ({
      reviewed: true,
      status: 'REVIEWED_PDF',
      text,
      pages: pages.map((page, index) => {
        const textStart = pages.slice(0, index).reduce((sum, item) => sum + item.length + 1, 0);
        return { pageNumber: index + 1, textStart, textEnd: textStart + page.length };
      }),
      diagnostics: [],
    }),
    generatedAt: '2026-08-07T21:05:00.000Z',
  });

  assert.ok(result.snapshot);
  assert.equal(result.snapshot.companyId, credia.companyId);
  assert.match(result.snapshot.sourceDocument.title, /CrediaBank/);
  assert.match(result.snapshot.sourceDocument.indexUrl, /\/el\/market-data\/issuers\/50\/financial-data/);
  assert.equal(result.snapshot.sourceDocument.period.type, 'INTERIM_6M');
  assert.equal(result.snapshot.sourceDocument.period.periodEnd, '2026-06-30');
  assert.equal(result.snapshot.sourceDocument.identityVerified, true);
  assert.equal(calls.some((url) => url.includes('/en/market-data/issuers/50/financial-data')), true);
  assert.equal(calls.some((url) => url.includes('/el/market-data/issuers/50/financial-data')), true);
  assert.equal(calls.some((url) => url.includes('crediabank-h1-2026.pdf')), true);
});
