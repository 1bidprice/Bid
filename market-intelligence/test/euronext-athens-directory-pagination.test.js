import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAthensDiscovery } from '../src/adapters/euronext-athens-discovery.js';

const NOW = '2026-08-05T18:30:00.000Z';
const announcements = `
<div><input name="field_mig_category_2" value="463" /><label>FLEXOPACK S.A.</label></div>
<table><tbody><tr><td>FLEXOPACK S.A.</td><td><a href="/en/node/999001">Financial results</a></td><td>05-08-2026 17:00</td></tr></tbody></table>`;
const firstDirectoryPage = `
<table><tr><th>Issuer</th><th>ISIN Code</th><th>OASIS Code</th><th>Market</th><th>MIFID</th><th>Market Segment</th><th>Product</th><th>Product Name</th></tr>
<tr><td>AEGEAN AIRLINES S.A.</td><td>GRS495003006</td><td>AEGN</td><td>SECURITIES MARKET</td><td>Regulated market</td><td>MAIN MARKET</td><td>Stock</td><td>AEGEAN AIRLINES</td></tr></table>
<a href="?letter=All&page=1">Last page</a>`;
const secondDirectoryPage = `
<table><tr><th>Issuer</th><th>ISIN Code</th><th>OASIS Code</th><th>Market</th><th>MIFID</th><th>Market Segment</th><th>Product</th><th>Product Name</th></tr>
<tr><td>FLEXOPACK S.A.</td><td>GRS550003009</td><td>FLEXO</td><td>SECURITIES MARKET</td><td>Regulated market</td><td>MAIN MARKET</td><td>Stock</td><td>FLEXOPACK</td></tr></table>`;

test('complete Athens directory pagination resolves an issuer absent from page zero', async () => {
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('/market-data/issuers?letter=')) return { ok: true, text: async () => '<html></html>' };
    if (value.endsWith('/market-data/announcements')) return { ok: true, text: async () => announcements };
    if (value.includes('/trading-products/trading-issuers?letter=All&page=1')) return { ok: true, text: async () => secondDirectoryPage };
    if (value.includes('/trading-products/trading-issuers?letter=All')) return { ok: true, text: async () => firstDirectoryPage };
    throw new Error(`unexpected url ${value}`);
  };

  const result = await fetchAthensDiscovery({ fetchImpl, generatedAt: NOW });
  assert.equal(result.version, 5);
  assert.equal(result.companies.length, 1);
  assert.equal(result.companies[0].primaryListing.symbol, 'FLEXO');
  assert.equal(result.companies[0].identitySource, 'EURONEXT_ATHENS_TRADING_ISSUERS');
  assert.deepEqual(result.tradingDirectoryHealth, {
    requestedPageCount: 2,
    loadedPageCount: 2,
    complete: true,
    instrumentCount: 2,
  });
  assert.equal(result.diagnostics.length, 0);
});
