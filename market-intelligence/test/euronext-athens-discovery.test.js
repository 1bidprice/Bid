import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATHENS_ISSUERS_URL,
  extractAthensAnnouncements,
  extractAthensIssuerUniverse,
  extractAthensRelatedInstrument,
  extractAthensSearchIdentity,
  fetchAthensDiscovery,
} from '../src/adapters/euronext-athens-discovery.js';

const NOW = '2026-08-04T13:30:00.000Z';

const issuerHtml = `
  <div><a href="/en/market-data/issuers/623">QUEST HOLDINGS S.A.</a></div>
  <div><a href="/en/market-data/issuers/410">ALPHA TRUST ANDROMEDA SA</a></div>
`;

const announcementHtml = `
  <div class="form-radios">
    <div><input name="field_mig_category_2" value="340" class="form-radio" /><label>QUEST HOLDINGS S.A.</label></div>
    <div><input name="field_mig_category_2" value="549" class="form-radio" /><label>ALPHA TRUST ANDROMEDA SA</label></div>
  </div>
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

const searchQuest = `
  <div class="result"><a href="/en/market-data/issuers/623">QUEST HOLDINGS S.A.</a><a href="/en/market-data/instruments/stocks/QUEST">QUEST</a></div>
`;

const searchAndro = `
  <div class="result"><a href="/en/market-data/issuers/410">ALPHA TRUST ANDROMEDA SA</a><a href="/en/market-data/instruments/stocks/ANDRO">ANDRO</a></div>
`;

test('issuer universe uses official issuer identifiers and no invented symbols', () => {
  const result = extractAthensIssuerUniverse(issuerHtml, { generatedAt: NOW });
  assert.equal(result.companies.length, 2);
  assert.equal(result.companies[0].companyId, 'company:xath:issuer-623');
  assert.equal(result.companies[0].primaryListing.mic, 'XATH');
  assert.equal(result.companies[0].primaryListing.symbol, null);
  assert.ok(ATHENS_ISSUERS_URL.includes('letter='));
});

test('live announcement filter taxonomy creates a complete official issuer registry', () => {
  const result = extractAthensIssuerUniverse(announcementHtml, { generatedAt: NOW });
  assert.equal(result.companies.length, 2);
  assert.equal(result.companies[0].companyId, 'company:xath:term-340');
  assert.equal(result.companies[0].taxonomyTermId, '340');
  assert.equal(result.diagnostics.length, 0);
});

test('announcement rows become primary exchange evidence linked to taxonomy-backed issuer identity', () => {
  const universe = extractAthensIssuerUniverse(announcementHtml, { generatedAt: NOW });
  const result = extractAthensAnnouncements(announcementHtml, universe.companies, { retrievedAt: NOW });
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].companyId, 'company:xath:term-340');
  assert.equal(result.records[0].taxonomyTermId, '340');
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

test('official Euronext search resolves issuer page and stock symbol without changing stable taxonomy company id', () => {
  const company = extractAthensIssuerUniverse(announcementHtml, { generatedAt: NOW }).companies[0];
  const resolved = extractAthensSearchIdentity(searchQuest, company);
  assert.equal(resolved.companyId, 'company:xath:term-340');
  assert.equal(resolved.issuerId, '623');
  assert.equal(resolved.primaryListing.symbol, 'QUEST');
});

test('Athens discovery fetches taxonomy registry, announcements and official identities', async () => {
  const fetchImpl = async (url) => {
    const value = decodeURIComponent(String(url));
    if (value.includes('/market-data/issuers?letter=')) return { ok: true, text: async () => '<html>No server-rendered issuer rows</html>' };
    if (value.endsWith('/market-data/announcements')) return { ok: true, text: async () => announcementHtml };
    if (value.includes('/trading-products/trading-issuers')) throw new Error('directory unavailable in unit fixture');
    if (value.includes('QUEST HOLDINGS')) return { ok: true, text: async () => searchQuest };
    if (value.includes('ALPHA TRUST ANDROMEDA')) return { ok: true, text: async () => searchAndro };
    throw new Error(`unexpected url ${value}`);
  };

  const result = await fetchAthensDiscovery({
    fetchImpl,
    generatedAt: NOW,
    tradingDirectoryFallbackLastPage: 0,
  });
  assert.equal(result.version, 6);
  assert.equal(result.records.length, 2);
  assert.equal(result.companies.length, 2);
  assert.equal(result.companies.find((item) => item.taxonomyTermId === '340').issuerId, '623');
  assert.equal(result.companies.find((item) => item.taxonomyTermId === '340').primaryListing.symbol, 'QUEST');
  assert.equal(result.companies.find((item) => item.taxonomyTermId === '549').primaryListing.symbol, 'ANDRO');
  const unexpectedDiagnostics = result.diagnostics.filter((item) => ![
    'ATHENS_TRADING_DIRECTORY_EMPTY',
    'ATHENS_LETTER_DIRECTORY_FETCH_FAILED',
  ].includes(item.code));
  assert.equal(unexpectedDiagnostics.length, 0);
});
