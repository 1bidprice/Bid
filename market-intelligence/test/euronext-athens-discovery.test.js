import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAthensAnnouncements,
  extractAthensIssuerUniverse,
  extractAthensRelatedInstrument,
  fetchAthensDiscovery,
} from '../src/adapters/euronext-athens-discovery.js';

const NOW = '2026-08-04T13:30:00.000Z';

const issuerHtml = `
  <div><a href="/en/market-data/issuers/623">QUEST HOLDINGS S.A.</a></div>
  <div><a href="/en/market-data/issuers/410">ALPHA TRUST ANDROMEDA SA</a></div>
`;

const announcementHtml = `
  <table><tbody>
    <tr>
      <td>QUEST HOLDINGS S.A.</td>
      <td><a href="/en/node/968584">Purchase of own shares</a></td>
      <td>04-08-2026 12:03</td>
    </tr>
    <tr>
      <td>ALPHA TRUST ANDROMEDA SA</td>
      <td><a href="/en/node/968600">ACQUISITION OF TREASURY SHARES</a></td>
      <td>04-08-2026 13:39</td>
    </tr>
  </tbody></table>
`;

const relatedQuest = `
  <table><tr><th>Symbol</th><th>Product</th></tr><tr><td><a href="/en/market-data/instruments/stocks/QUEST">QUEST</a></td><td>Stock</td></tr></table>
`;

const relatedAndro = `
  <table><tr><th>Symbol</th><th>Product</th></tr><tr><td><a href="/en/market-data/instruments/stocks/ANDRO">ANDRO</a></td><td>Stock</td></tr></table>
`;

test('issuer universe uses official issuer identifiers and no invented symbols', () => {
  const result = extractAthensIssuerUniverse(issuerHtml, { generatedAt: NOW });
  assert.equal(result.companies.length, 2);
  assert.equal(result.companies[0].companyId, 'company:xath:623');
  assert.equal(result.companies[0].primaryListing.mic, 'XATH');
  assert.equal(result.companies[0].primaryListing.symbol, null);
});

test('announcement rows become primary exchange evidence linked to canonical issuer identity', () => {
  const universe = extractAthensIssuerUniverse(issuerHtml, { generatedAt: NOW });
  const result = extractAthensAnnouncements(announcementHtml, universe.companies, { retrievedAt: NOW });
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].companyId, 'company:xath:623');
  assert.equal(result.records[0].form, 'ATHEX_ANNOUNCEMENT');
  assert.equal(result.records[0].isPrimarySource, true);
  assert.equal(result.records[0].sourceUrl, 'https://athens.euronext.com/en/node/968584');
});

test('related instruments resolves an official OASIS symbol before deep analysis', () => {
  const company = extractAthensIssuerUniverse(issuerHtml, { generatedAt: NOW }).companies[0];
  const resolved = extractAthensRelatedInstrument(relatedQuest, company);
  assert.equal(resolved.primaryListing.symbol, 'QUEST');
  assert.ok(resolved.aliases.includes('QUEST'));
});

test('Athens discovery fetches issuers, announcements and only then related instruments', async () => {
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.endsWith('/market-data/issuers')) return { ok: true, text: async () => issuerHtml };
    if (value.endsWith('/market-data/announcements')) return { ok: true, text: async () => announcementHtml };
    if (value.includes('/issuers/623/related-instruments')) return { ok: true, text: async () => relatedQuest };
    if (value.includes('/issuers/410/related-instruments')) return { ok: true, text: async () => relatedAndro };
    throw new Error(`unexpected url ${value}`);
  };

  const result = await fetchAthensDiscovery({ fetchImpl, generatedAt: NOW });
  assert.equal(result.records.length, 2);
  assert.equal(result.companies.length, 2);
  assert.equal(result.companies.find((item) => item.issuerId === '623').primaryListing.symbol, 'QUEST');
  assert.equal(result.companies.find((item) => item.issuerId === '410').primaryListing.symbol, 'ANDRO');
  assert.equal(result.diagnostics.length, 0);
});
