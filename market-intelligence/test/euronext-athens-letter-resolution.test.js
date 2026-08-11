import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAthensDiscovery } from '../src/adapters/euronext-athens-discovery.js';

const NOW = '2026-08-05T19:00:00.000Z';
const announcements = `
<div><input name="field_mig_category_2" value="463" /><label>FLEXOPACK S.A.</label></div>
<table><tbody><tr><td>FLEXOPACK S.A.</td><td><a href="/en/node/999001">Financial results</a></td><td>05-08-2026 17:00</td></tr></tbody></table>`;
const allDirectoryPage = `
<table><tr><th>Issuer</th><th>ISIN Code</th><th>OASIS Code</th><th>Market</th><th>MIFID</th><th>Market Segment</th><th>Product</th><th>Product Name</th></tr>
<tr><td>AEGEAN AIRLINES S.A.</td><td>GRS495003006</td><td>AEGN</td><td>SECURITIES MARKET</td><td>Regulated market</td><td>MAIN MARKET</td><td>Stock</td><td>AEGEAN AIRLINES</td></tr></table>`;
const flexoDirectoryPage = `
<table><tr><th>Issuer</th><th>ISIN Code</th><th>OASIS Code</th><th>Market</th><th>MIFID</th><th>Market Segment</th><th>Product</th><th>Product Name</th></tr>
<tr><td>FLEXOPACK S.A.</td><td>GRS259003002</td><td>FLEXO</td><td>SECURITIES MARKET</td><td>Regulated market</td><td>MAIN MARKET</td><td>Stock</td><td>FLEXOPACK S.A. (CR)</td></tr></table>`;

test('unresolved issuer is recovered from its official Euronext letter directory', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.includes('/market-data/issuers?letter=')) return { ok: true, text: async () => '<html></html>' };
    if (value.endsWith('/market-data/announcements')) return { ok: true, text: async () => announcements };
    if (value.includes('/trading-products/trading-issuers?letter=All')) return { ok: true, text: async () => allDirectoryPage };
    if (value.includes('/trading-products/trading-issuers?letter=F')) return { ok: true, text: async () => flexoDirectoryPage };
    throw new Error(`unexpected url ${value}`);
  };

  const result = await fetchAthensDiscovery({ fetchImpl, generatedAt: NOW });
  assert.equal(result.version, 7);
  assert.equal(result.companies.length, 1);
  assert.equal(result.companies[0].primaryListing.symbol, 'FLEXO');
  assert.equal(result.companies[0].identitySource, 'EURONEXT_ATHENS_TRADING_ISSUERS');
  assert.equal(result.companies[0].issuerId, null);
  assert.equal(result.classificationSnapshotCount, 0);
  assert.deepEqual(result.classificationSnapshots, []);
  assert.ok(calls.some((url) => url.includes('?letter=F')));
  assert.equal(result.diagnostics.filter((item) => item.code === 'ATHENS_ISSUER_ID_NOT_RESOLVED').length, 0);
  assert.equal(result.diagnostics.filter((item) => item.code === 'ATHENS_ICB_ISSUER_ID_REQUIRED').length, 1);
});
