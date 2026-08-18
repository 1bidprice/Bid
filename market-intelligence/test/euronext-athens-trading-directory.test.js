import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATHENS_TRADING_ISSUERS_URL,
  extractAthensTradingDirectory,
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
