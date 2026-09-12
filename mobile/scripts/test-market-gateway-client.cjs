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
  validateGatewayFx,
  fetchCanonicalGatewayQuote,
  fetchCanonicalGatewayFx,
  fetchCanonicalGatewayQuotes,
  fetchCanonicalGatewayMarketSnapshot,
} = require('../src/market-gateway-client.js');

function quotePayload() {
  return {
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
  };
}

function fxPayload() {
  return {
    format: 'investor-control-market-gateway-fx',
    version: 1,
    reference: {
      pair: 'EURUSD',
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: 1.1616,
      referenceDate: '2026-09-10',
      source: 'European Central Bank euro foreign exchange reference rates',
      sourceQuality: 'OFFICIAL_DAILY_REFERENCE',
      rateMeaning: 'USD per EUR',
      valuationReferenceEligible: true,
      transactionEligible: false,
      decisionEligible: false,
    },
  };
}

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

  const quoteCalls = [];
  const quote = await fetchCanonicalGatewayQuote('SPCE.US', {
    baseUrl: 'https://quotes.example.com',
    clientId: firstId,
    fetchImpl: async (url, init = {}) => {
      quoteCalls.push({ url: String(url), headers: init.headers || {} });
      return new Response(JSON.stringify(quotePayload()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(quote.currency, 'USD');
  assert.equal(quoteCalls.length, 1);
  assert.equal(quoteCalls[0].headers[MARKET_GATEWAY_CLIENT_HEADER], firstId);
  assert.equal(quoteCalls[0].url, 'https://quotes.example.com/v1/quote?symbol=SPCE.US');
  assert.equal(/token=|finnhub/i.test(quoteCalls[0].url), false);

  await assert.rejects(
    fetchCanonicalGatewayQuote('SPCE.US', {
      baseUrl: 'https://quotes.example.com',
      clientId: firstId,
      fetchImpl: async () => {
        const payload = quotePayload();
        payload.quote.quoteContract.identityVerified = false;
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    }),
    /GATEWAY_US_IDENTITY_NOT_VERIFIED/,
  );

  assert.equal(validateGatewayFx(fxPayload()), null);
  const invalidFx = fxPayload();
  invalidFx.reference.transactionEligible = true;
  assert.equal(validateGatewayFx(invalidFx), 'GATEWAY_FX_TRANSACTION_CONTRACT_INVALID');

  const fxCalls = [];
  const fx = await fetchCanonicalGatewayFx({
    baseUrl: 'https://quotes.example.com',
    clientId: firstId,
    fetchImpl: async (url, init = {}) => {
      fxCalls.push({ url: String(url), headers: init.headers || {} });
      return new Response(JSON.stringify(fxPayload()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(fx.rate, 1.1616);
  assert.equal(fx.referenceDate, '2026-09-10');
  assert.equal(fx.sourceQuality, 'OFFICIAL_DAILY_REFERENCE');
  assert.equal(fx.valuationReferenceEligible, true);
  assert.equal(fx.transactionEligible, false);
  assert.equal(fx.decisionEligible, false);
  assert.equal(fxCalls[0].url, 'https://quotes.example.com/v1/fx?pair=EURUSD');
  assert.equal(fxCalls[0].headers[MARKET_GATEWAY_CLIENT_HEADER], firstId);

  const batch = await fetchCanonicalGatewayQuotes(['SPCE.US', 'BAD'], {
    baseUrl: 'https://quotes.example.com',
    clientId: firstId,
    fetchImpl: async () => new Response(JSON.stringify(quotePayload()), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  assert.ok(batch.quoteRegistry['SPCE.US']);
  assert.equal(Object.keys(batch.quoteRegistry).length, 1);
  assert.deepEqual(batch.errors, []);

  const snapshotCalls = [];
  const snapshot = await fetchCanonicalGatewayMarketSnapshot(['SPCE.US'], {
    baseUrl: 'https://quotes.example.com',
    clientId: firstId,
    fetchImpl: async (url) => {
      snapshotCalls.push(String(url));
      const payload = String(url).includes('/v1/fx?') ? fxPayload() : quotePayload();
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(snapshot.quoteRegistry['SPCE.US'].currency, 'USD');
  assert.equal(snapshot.fxReference.rate, 1.1616);
  assert.equal(snapshot.fxError, undefined);
  assert.equal(snapshotCalls.length, 2);

  const greekOnlyCalls = [];
  const greekOnly = await fetchCanonicalGatewayMarketSnapshot(['ALWN.GR'], {
    baseUrl: 'https://quotes.example.com',
    clientId: firstId,
    fetchImpl: async (url) => {
      greekOnlyCalls.push(String(url));
      return new Response(JSON.stringify({
        format: 'investor-control-market-gateway-quote',
        requestedSymbol: 'ALWN.GR',
        quote: { appSymbol: 'ALWN.GR', currency: 'EUR', quoteContract: { sourceApproved: true, sourceRole: 'PRIMARY_EXCHANGE' } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(greekOnly.fxReference, null);
  assert.equal(greekOnlyCalls.length, 1);

  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'market-gateway-client.js'), 'utf8');
  assert.equal(source.includes('FINNHUB_TOKEN'), false);
  assert.equal(source.includes('finnhub.io'), false);
  assert.equal(source.includes('EURUSD=X'), false);
  assert.equal(source.includes('ecb.europa.eu'), false);
  assert.equal(source.includes('api/v1/quote'), false);

  const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'market-gateway-runtime.js'), 'utf8');
  assert.match(runtimeSource, /process\.env\.EXPO_PUBLIC_MARKET_GATEWAY_URL/);
  assert.equal(runtimeSource.includes('EXPO_PUBLIC_FINNHUB'), false);
  assert.equal(runtimeSource.includes('FINNHUB_TOKEN'), false);
  assert.equal(runtimeSource.includes('EURUSD=X'), false);
  assert.equal(runtimeSource.includes('finnhub.io'), false);
  assert.equal(runtimeSource.includes('ecb.europa.eu'), false);

  console.log('market gateway mobile quote + FX client/runtime contract: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
