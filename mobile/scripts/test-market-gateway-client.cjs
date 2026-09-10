'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MARKET_GATEWAY_CLIENT_HEADER,
  MARKET_GATEWAY_CLIENT_STORAGE_KEY,
  canonicalSymbol,
  normalizeGatewayBaseUrl,
  createOpaqueInstallationId,
  getOrCreateInstallationId,
  fetchCanonicalGatewayQuote,
  fetchCanonicalGatewayQuotes,
} = require('../src/market-gateway-client.cjs');

async function main() {
  assert.equal(canonicalSymbol('spce.us'), 'SPCE.US');
  assert.equal(canonicalSymbol('SPCE'), null);
  assert.equal(normalizeGatewayBaseUrl('https://quotes.example.com/'), 'https://quotes.example.com');
  assert.equal(normalizeGatewayBaseUrl('http://quotes.example.com'), null);
  assert.equal(normalizeGatewayBaseUrl('https://user:pass@quotes.example.com'), null);
  assert.equal(normalizeGatewayBaseUrl('https://quotes.example.com?token=x'), null);

  const id = createOpaqueInstallationId({ now: () => 1789077600000, random: () => 0.123456789 });
  assert.match(id, /^[A-Za-z0-9_-]{16,128}$/);

  const memory = new Map();
  const storage = {
    async getItem(key) { return memory.get(key) || null; },
    async setItem(key, value) { memory.set(key, value); },
  };
  const firstId = await getOrCreateInstallationId(storage, { now: () => 1789077600000, random: () => 0.314159265 });
  const secondId = await getOrCreateInstallationId(storage, { now: () => 1, random: () => 0.9 });
  assert.equal(firstId, secondId);
  assert.equal(memory.get(MARKET_GATEWAY_CLIENT_STORAGE_KEY), firstId);

  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    return new Response(JSON.stringify({
      format: 'investor-control-market-gateway-quote',
      version: 1,
      requestedSymbol: 'SPCE.US',
      quote: {
        appSymbol: 'SPCE.US',
        price: 3.21,
        previousClose: 3.10,
        currency: 'USD',
        quoteAt: '2026-09-10T15:00:00.000Z',
        source: 'Finnhub',
        quoteContract: {
          sourceApproved: true,
          identityVerified: true,
          sourceRole: 'LICENSED_MARKET_DATA',
          timestampVerified: true,
          valuationEligible: true,
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const quote = await fetchCanonicalGatewayQuote('SPCE.US', {
    baseUrl: 'https://quotes.example.com',
    clientId: firstId,
    fetchImpl,
  });
  assert.equal(quote.currency, 'USD');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers[MARKET_GATEWAY_CLIENT_HEADER], firstId);
  assert.equal(calls[0].url, 'https://quotes.example.com/v1/quote?symbol=SPCE.US');
  assert.equal(/token=|finnhub/i.test(calls[0].url), false);

  await assert.rejects(
    fetchCanonicalGatewayQuote('SPCE.US', {
      baseUrl: 'https://quotes.example.com',
      clientId: firstId,
      fetchImpl: async () => new Response(JSON.stringify({
        format: 'investor-control-market-gateway-quote',
        requestedSymbol: 'SPCE.US',
        quote: { appSymbol: 'SPCE.US', currency: 'USD', quoteContract: { sourceApproved: true, identityVerified: false } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    }),
    /GATEWAY_US_IDENTITY_NOT_VERIFIED/,
  );

  const batch = await fetchCanonicalGatewayQuotes(['SPCE.US', 'BAD'], {
    baseUrl: 'https://quotes.example.com',
    clientId: firstId,
    fetchImpl,
  });
  assert.ok(batch.quoteRegistry['SPCE.US']);
  assert.equal(Object.keys(batch.quoteRegistry).length, 1);
  assert.deepEqual(batch.errors, []);

  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'market-gateway-client.cjs'), 'utf8');
  assert.equal(source.includes('FINNHUB_TOKEN'), false);
  assert.equal(source.includes('finnhub.io'), false);
  assert.equal(source.includes('api/v1/quote'), false);

  console.log('market gateway mobile client contract: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
