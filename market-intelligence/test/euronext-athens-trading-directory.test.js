import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATHENS_TRADING_ISSUERS_URL,
  extractAthensTradingDirectory,
  fetchAthensCompaniesBySymbols,
} from '../src/adapters/euronext-athens-discovery.js';

const directoryHtml = `
<table>
  <thead><tr><th>Issuer</th><th>ISIN Code</th><th>OASIS Code</th><th>Market</th><th>MIFID</th><th>Market Segment</th><th>Product</th><th>Product Name</th></tr></thead>
  <tbody>
    <tr><td>QUEST HOLDINGS S.A.</td><td>GRS310003009</td><td><a href="/en/market-data/instruments/stocks/QUEST">QUEST</a></td><td>ATHEX</td><td>SHRS</td><td>MAIN MARKET</td><td>Stock</td><td>QUEST HOLDINGS</td></tr>
    <tr><td>CENERGY HOLDINGS S.A.</td><td>BE0974303357</td><td><a href="/en/market-data/instruments/stocks/CENER">CENER</a></td><td>ATHEX</td><td>SHRS</td><td>MAIN MARKET</td><td>Stock</td><td>CENERGY HOLDINGS</td></tr>
    <tr><td>PAPOUTSANIS S.A.</td><td>GRS065003000</td><td>PAP</td><td>ATHEX</td><td>SHRS</td><td>MAIN MARKET</td><td>Stock</td><td>PAPOUTSANIS</td></tr>
    <tr><td>GREEK GOVERNMENT</td><td>GR0124040743</td><td>GR0124040743</td><td>ATHEX</td><td>BOND</td><td>BONDS</td><td>Bond</td><td>Government Bond</td></tr>
  </tbody>
</table>`;

test('official trading issuers directory maps issuer names to OASIS stock symbols', () => {
  const result = extractAthensTradingDirectory(directoryHtml);
  assert.equal(result.records.length, 3);
  assert.equal(result.records.find((item) => item.issuerName === 'QUEST HOLDINGS S.A.').symbol, 'QUEST');
  assert.equal(result.records.find((item) => item.issuerName === 'CENERGY HOLDINGS S.A.').symbol, 'CENER');
  assert.equal(result.records.find((item) => item.issuerName === 'PAPOUTSANIS S.A.').symbol, 'PAP');
  assert.equal(result.diagnostics.length, 0);
  assert.ok(ATHENS_TRADING_ISSUERS_URL.includes('/trading-issuers'));
});


test('symbol resolver uses official ISIN as a stable canonical identity when issuer link is absent', async () => {
  const result = await fetchAthensCompaniesBySymbols(['QUEST'], {
    fetchImpl: async (url) => {
      assert.match(String(url), /trading-products\/trading-issuers/);
      return { ok: true, text: async () => directoryHtml };
    },
    generatedAt: '2026-10-03T12:00:00.000Z',
    tradingDirectoryFallbackLastPage: 0,
  });
  assert.equal(result.companies.length, 1);
  assert.equal(result.companies[0].companyId, 'company:xath:isin:GRS310003009');
  assert.equal(result.companies[0].isin, 'GRS310003009');
  assert.equal(result.companies[0].primaryListing.symbol, 'QUEST');
  assert.equal(result.companies[0].primaryListing.mic, 'XATH');
  assert.equal(result.companies[0].activeTradingVerified, true);
  assert.equal(result.companies[0].identitySource, 'EURONEXT_ATHENS_TRADING_ISSUERS');
});


test('trading directory preserves multiple official stock identities for the same issuer', () => {
  const html = `
  <table><tbody>
    <tr><td>EXAMPLE HOLDINGS S.A.</td><td>GRS000000001</td><td><a href="/en/market-data/instruments/stocks/EXA">EXA</a></td><td>ATHEX</td><td>SHRS</td><td>MAIN MARKET</td><td>Stock</td><td>EXAMPLE A</td></tr>
    <tr><td>EXAMPLE HOLDINGS S.A.</td><td>GRS000000019</td><td><a href="/en/market-data/instruments/stocks/EXB">EXB</a></td><td>ATHEX</td><td>SHRS</td><td>MAIN MARKET</td><td>Stock</td><td>EXAMPLE B</td></tr>
  </tbody></table>`;
  const result = extractAthensTradingDirectory(html);
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records.map((x) => x.symbol).sort(), ['EXA', 'EXB']);
  assert.deepEqual(result.records.map((x) => x.isin).sort(), ['GRS000000001', 'GRS000000019']);
});

test('symbol resolver selects the exact instrument when one issuer has multiple stock symbols', async () => {
  const html = `
  <table><tbody>
    <tr><td>EXAMPLE HOLDINGS S.A.</td><td>GRS000000001</td><td><a href="/en/market-data/instruments/stocks/EXA">EXA</a></td><td>ATHEX</td><td>SHRS</td><td>MAIN MARKET</td><td>Stock</td><td>EXAMPLE A</td></tr>
    <tr><td>EXAMPLE HOLDINGS S.A.</td><td>GRS000000019</td><td><a href="/en/market-data/instruments/stocks/EXB">EXB</a></td><td>ATHEX</td><td>SHRS</td><td>MAIN MARKET</td><td>Stock</td><td>EXAMPLE B</td></tr>
  </tbody></table>`;
  const result = await fetchAthensCompaniesBySymbols(['EXB'], {
    fetchImpl: async () => ({ ok: true, text: async () => html }),
    generatedAt: '2026-10-03T12:00:00.000Z',
    tradingDirectoryFallbackLastPage: 0,
  });
  assert.equal(result.companies.length, 1);
  assert.equal(result.companies[0].primaryListing.symbol, 'EXB');
  assert.equal(result.companies[0].isin, 'GRS000000019');
  assert.equal(result.companies[0].companyId, 'company:xath:isin:GRS000000019');
});
