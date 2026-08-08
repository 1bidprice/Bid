import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFinnhubIndependentNews, fetchFinnhubIndependentNews } from '../src/adapters/finnhub-independent-news.js';

const company = {
  companyId: 'company:test:unknown-us-equity',
  displayName: 'Example Space Systems',
  legalName: 'Example Space Systems Inc.',
  country: 'US',
  primaryListing: { symbol: 'TSTX', mic: 'XNYS', exchange: 'NYSE' },
};

const payload = [
  {
    id: 1,
    datetime: 1786204800,
    headline: 'Example Space Systems reports quarterly results',
    summary: 'Example Space Systems reported revenue and free cash flow for the quarter.',
    related: 'TSTX',
    source: 'Reuters',
    url: 'https://www.reuters.com/markets/companies/example-space-results-2026-08-08/',
  },
  {
    id: 2,
    datetime: 1786204800,
    headline: 'Example Space Systems rumor',
    summary: 'Example Space Systems rumor.',
    related: 'TSTX',
    source: 'Unknown Blog',
    url: 'https://unknown.example/blog/example-space',
  },
];

test('Finnhub company-news is discovery only and retains direct URLs solely for allowlisted independent publishers', () => {
  const result = normalizeFinnhubIndependentNews(payload, company, { retrievedAt: '2026-08-08T12:00:00.000Z' });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].sourceName, 'Reuters');
  assert.match(result.records[0].sourceUrl, /^https:\/\/www\.reuters\.com\//);
  assert.equal(result.records[0].claimType, 'ESTIMATE');
  assert.equal(result.records[0].document, undefined);
  assert.equal(result.records[0].discoveryProvider, 'FINNHUB_COMPANY_NEWS');
  assert.equal(result.rejected.length, 1);
});

test('direct publisher article must itself be reviewed before Finnhub-discovered evidence becomes FACT', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://finnhub.io/api/v1/company-news')) {
      return { ok: true, json: async () => [payload[0]] };
    }
    if (String(url).includes('reuters.com')) {
      const body = `<article><h1>Example Space Systems reports quarterly results</h1><p>Example Space Systems reported quarterly financial results including revenue and free cash flow.</p><p>${'Independent reporting and business context. '.repeat(40)}</p></article>`;
      return {
        ok: true,
        url: String(url),
        headers: { get: (name) => String(name).toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null },
        text: async () => body,
      };
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const result = await fetchFinnhubIndependentNews(company, {
    fetchImpl,
    token: 'test-token',
    retrievedAt: '2026-08-08T12:00:00.000Z',
    reviewMinText: 300,
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].claimType, 'FACT');
  assert.equal(result.records[0].document.reviewed, true);
  assert.equal(result.records[0].document.status, 'REVIEWED_NEWS');
  assert.ok(calls.some((url) => url.startsWith('https://finnhub.io/api/v1/company-news')));
  assert.ok(calls.some((url) => url.includes('reuters.com')));
});
