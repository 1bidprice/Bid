import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAthensDiscovery } from '../src/adapters/euronext-athens-discovery.js';

const NOW = '2026-08-05T18:30:00.000Z';
const announcements = `
<div><input name="field_mig_category_2" value="463" /><label>FLEXOPACK S.A.</label></div>
<table><tbody><tr><td>FLEXOPACK S.A.</td><td><a href="/en/node/999001">Financial results</a></td><td>05-08-2026 17:00</td></tr></tbody></table>`;
const firstDirectoryPage = `
<table><tr><th>Issuer</th><th>ISIN Code</th><th>OASIS Code</th><th>Market</th><th>MIFID</th><th>Market Segment</th><th>Product</th><th>Product Name</th></tr>
<tr><td>AEGEAN AIRLINES S.A.</td><td>GRS495003006</td><td>AEGN</td><td>SECURITIES MARKET</td><td>Regulated market</td><td>MAIN MARKET</td><td>Stock</td><td>AEGEAN AIRLINES</td></tr></table>`;
const secondDirectoryPage = `
<table><tr><th>Issuer</th><th>ISIN Code</th><th>OASIS Code</th><th>Market</th><th>MIFID</th><th>Market Segment</th><th>Product</th><th>Product Name</th></tr>
<tr><td>FLEXOPACK S.A.</td><td>GRS550003009</td><td>FLEXO</td><td>SECURITIES MARKET</td><td>Regulated market</td><td>MAIN MARKET</td><td>Stock</td><td>FLEXOPACK</td></tr></table>`;

function fetchFixture(firstPageWithPager) {
  return async (url) => {
    const value = String(url);
    if (value.includes('/market-data/issuers?letter=')) return { ok: true, text: async () => '<html></html>' };
    if (value.endsWith('/market-data/announcements')) return { ok: true, text: async () => announcements };
    if (value.includes('/trading-products/trading-issuers?letter=All&page=1')) return { ok: true, text: async () => secondDirectoryPage };
    if (value.includes('/trading-products/trading-issuers?letter=All')) {
      return { ok: true, text: async () => firstPageWithPager ? `${firstDirectoryPage}<a href="?letter=All&amp;page=1">Last page</a>` : firstDirectoryPage };
    }
    throw new Error(`unexpected url ${value}`);
  };
}

function assertResolved(result, expectedFallback) {
  assert.equal(result.version, 7);
  assert.equal(result.companies.length, 1);
  assert.equal(result.companies[0].primaryListing.symbol, 'FLEXO');
  assert.equal(result.companies[0].identitySource, 'EURONEXT_ATHENS_TRADING_ISSUERS');
  assert.equal(result.companies[0].issuerId, null);
  assert.equal(result.classificationSnapshotCount, 0);
  assert.deepEqual(result.classificationSnapshots, []);
  assert.deepEqual(result.tradingDirectoryHealth, {
    publishedLastPage: expectedFallback ? 0 : 1,
    selectedLastPage: 1,
    fallbackPaginationUsed: expectedFallback,
    requestedPageCount: 2,
    loadedPageCount: 2,
    complete: true,
    instrumentCount: 2,
  });
  assert.equal(result.diagnostics.filter((item) => item.code === 'ATHENS_ICB_ISSUER_ID_REQUIRED').length, 1);
  assert.equal(result.diagnostics.filter((item) => item.code !== 'ATHENS_ICB_ISSUER_ID_REQUIRED').length, 0);
}

test('escaped Athens pager links are decoded and all pages are loaded', async () => {
  const result = await fetchAthensDiscovery({
    fetchImpl: fetchFixture(true),
    generatedAt: NOW,
    tradingDirectoryFallbackLastPage: 1,
  });
  assertResolved(result, false);
});

test('hidden pager falls back to a bounded full official directory traversal', async () => {
  const result = await fetchAthensDiscovery({
    fetchImpl: fetchFixture(false),
    generatedAt: NOW,
    tradingDirectoryFallbackLastPage: 1,
  });
  assertResolved(result, true);
});
