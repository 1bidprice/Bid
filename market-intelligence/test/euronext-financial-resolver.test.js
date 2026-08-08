import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEuronextAthensFinancialDocument } from '../src/adapters/euronext-athens-financial-resolver.js';

const company = {
  companyId: 'company:test:renamed-issuer',
  displayName: 'New Holdings',
  legalName: 'New Holdings S.A.',
  aliases: ['Legacy Industries S.A.'],
  issuerId: '777',
  primaryListing: { symbol: 'NEWH', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' },
  marketData: { euronextIssuerAnnouncementsUrl: 'https://athens.euronext.com/en/market-data/issuers/777/announcements' },
};

function financialIndexHtml() {
  return `<table><tbody><tr><td>Legacy Industries S.A. annual financial statements 2025</td><td>31-03-2026 12:00</td><td><a href="/files/legacy-2025.pdf">DownloadPDF</a></td></tr></tbody></table>`;
}

function announcementsHtml() {
  return `<table><tbody><tr><td>NEW HOLDINGS S.A.</td><td><a href="/en/more-options/announcements/new-holdings-h1-2026">H1 2026 Condensed Consolidated Interim Financial Statements</a></td><td>06-08-2026 12:00</td></tr></tbody></table>`;
}

function detailHtml() {
  return `<main><h1>H1 2026 Condensed Consolidated Interim Financial Statements</h1><a href="/sites/default/files/new-holdings-h1-2026-financial-statements.pdf">Financial statements PDF</a><a href="/sites/default/files/new-holdings-h1-presentation.pdf">Investor presentation PDF</a></main>`;
}

const extractFinancialDocuments = (html) => html.includes('legacy-2025.pdf') ? [{
  title: 'Legacy Industries S.A. annual financial statements 2025',
  modifiedAt: '2026-03-31T09:00:00.000Z',
  pdfUrl: 'https://athens.euronext.com/files/legacy-2025.pdf',
  detailUrl: null,
  identityScore: 100,
  identityVerified: true,
  period: { year: 2025, months: 12, type: 'ANNUAL', periodEnd: '2025-12-31' },
}] : [];

test('newer issuer-scoped announcement financial statement outranks stale predecessor financial-data record without ticker-specific rules', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.includes('/financial-data')) return { ok: true, status: 200, url: value, text: async () => financialIndexHtml() };
    if (value.includes('/announcements') && !value.includes('/more-options/')) return { ok: true, status: 200, url: value, text: async () => announcementsHtml() };
    if (value.includes('/more-options/announcements/new-holdings-h1-2026')) return { ok: true, status: 200, url: value, text: async () => detailHtml() };
    return { ok: false, status: 404, url: value, text: async () => '' };
  };

  const result = await resolveEuronextAthensFinancialDocument(company, {
    fetchImpl,
    financialDataUrl: 'https://athens.euronext.com/en/market-data/issuers/777/financial-data',
    extractFinancialDocuments,
    generatedAt: '2026-08-08T12:00:00.000Z',
  });

  assert.equal(result.document.sourceChannel, 'ISSUER_ANNOUNCEMENT_ATTACHMENT');
  assert.equal(result.document.period.periodEnd, '2026-06-30');
  assert.equal(result.document.identityBinding, 'EURONEXT_ISSUER_SCOPED_ANNOUNCEMENT');
  assert.match(result.document.pdfUrl, /new-holdings-h1-2026-financial-statements\.pdf$/);
  assert.equal(result.invariant, 'ISSUER_SCOPED_REUSABLE_RESOLUTION_NO_TICKER_RULES');
  assert.ok(calls.some((url) => url.includes('/financial-data')));
  assert.ok(calls.some((url) => url.includes('/announcements')));
});

test('presentation PDF is not accepted as the financial statement attachment', async () => {
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('/financial-data')) return { ok: true, status: 200, url: value, text: async () => '<html></html>' };
    if (value.includes('/announcements') && !value.includes('/more-options/')) return { ok: true, status: 200, url: value, text: async () => announcementsHtml() };
    if (value.includes('/more-options/announcements/')) return { ok: true, status: 200, url: value, text: async () => detailHtml() };
    return { ok: false, status: 404, url: value, text: async () => '' };
  };
  const result = await resolveEuronextAthensFinancialDocument(company, { fetchImpl, extractFinancialDocuments, generatedAt: '2026-08-08T12:00:00.000Z' });
  assert.doesNotMatch(result.document.pdfUrl, /presentation/);
  assert.ok(result.document.authorityScore >= 80);
});
