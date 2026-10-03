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
  validateGatewayBatch,
  validateInstrumentCapability,
  validateResearchQueueStatus,
  validateGatewayFx,
  fetchInstrumentCapability,
  requestMinbeisResearch,
  fetchMinbeisResearchQueueStatus,
  fetchCanonicalGatewayQuote,
  fetchCanonicalGatewayFx,
  fetchCanonicalGatewayBatch,
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

function batchPayload(symbols = ['SPCE.US']) {
  return {
    format: 'investor-control-market-gateway-batch',
    version: 1,
    servedAt: '2026-09-10T15:00:00.000Z',
    requestedSymbols: symbols,
    quoteRegistry: Object.fromEntries(symbols.map((symbol) => {
      if (symbol === 'SPCE.US') return [symbol, quotePayload().quote];
      return [symbol, {
        appSymbol: symbol,
        currency: 'EUR',
        quoteContract: { sourceApproved: true, sourceRole: 'PRIMARY_EXCHANGE' },
      }];
    })),
    errors: [],
    fxReference: symbols.some((symbol) => symbol.endsWith('.US')) ? fxPayload().reference : null,
    privacy: {
      acceptedInputs: ['symbols'],
      portfolioQuantityRequired: false,
      portfolioCostRequired: false,
      pnlRequired: false,
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

  const capabilityPayload = {
    format: 'investor-control-instrument-capability',
    version: 1,
    requestedSymbol: 'NVDA.US',
    market: 'US',
    identityVerified: true,
    quoteSupported: true,
    analysisSupported: false,
    onboardingStatus: 'IDENTITY_VERIFIED_ANALYSIS_ONBOARDING_REQUIRED',
    canonicalCompanyId: 'gateway:us:NVDA',
    displayName: 'NVIDIA Corp',
    currency: 'USD',
    limitations: ['FULL_MINBEIS_RESEARCH_NOT_YET_CANONICAL'],
    privacy: {
      acceptedInputs: ['symbol'],
      portfolioQuantityRequired: false,
      portfolioCostRequired: false,
      pnlRequired: false,
    },
  };
  assert.equal(validateInstrumentCapability('NVDA.US', capabilityPayload), null);
  const capabilityCalls = [];
  const capability = await fetchInstrumentCapability('NVDA.US', {
    baseUrl: 'https://quotes.example.com',
    clientId: firstId,
    fetchImpl: async (url, init = {}) => {
      capabilityCalls.push({ url: String(url), headers: init.headers || {} });
      return new Response(JSON.stringify(capabilityPayload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(capability.onboardingStatus, 'IDENTITY_VERIFIED_ANALYSIS_ONBOARDING_REQUIRED');
  assert.equal(capabilityCalls[0].url, 'https://quotes.example.com/v1/instrument?symbol=NVDA.US');
  assert.equal(capabilityCalls[0].headers[MARKET_GATEWAY_CLIENT_HEADER], firstId);
  assert.equal(JSON.stringify(capability).includes('quantity'), false);

  const researchQueuePayload = {
    format: 'investor-control-research-queue-status',
    version: 1,
    requestedSymbol: 'NVDA.US',
    queueStatus: 'QUEUED',
    queued: true,
    firstRequestedAt: '2026-09-10T15:00:00.000Z',
    lastRequestedAt: '2026-09-10T15:00:00.000Z',
    privacy: {
      acceptedInputs: ['symbol'],
      portfolioDataStored: false,
      clientIdentityStored: false,
    },
  };
  assert.equal(validateResearchQueueStatus('NVDA.US', researchQueuePayload), null);
  const researchCalls = [];
  const queued = await requestMinbeisResearch('NVDA.US', {
    baseUrl: 'https://quotes.example.com',
    clientId: firstId,
    fetchImpl: async (url, init = {}) => {
      researchCalls.push({ url: String(url), method: init.method, headers: init.headers || {}, body: init.body });
      return new Response(JSON.stringify(researchQueuePayload), { status: 202, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(queued.queueStatus, 'QUEUED');
  assert.equal(researchCalls[0].url, 'https://quotes.example.com/v1/research-queue');
  assert.equal(researchCalls[0].method, 'POST');
  assert.equal(researchCalls[0].headers[MARKET_GATEWAY_CLIENT_HEADER], firstId);
  assert.deepEqual(JSON.parse(researchCalls[0].body), { symbol: 'NVDA.US' });
  assert.equal(JSON.stringify(researchCalls[0].body).includes('quantity'), false);
  assert.equal(JSON.stringify(researchCalls[0].body).includes('cost'), false);

  const status = await fetchMinbeisResearchQueueStatus('NVDA.US', {
    baseUrl: 'https://quotes.example.com',
    clientId: firstId,
    fetchImpl: async (url, init = {}) => {
      assert.equal(String(url), 'https://quotes.example.com/v1/research-queue?symbol=NVDA.US');
      assert.equal(init.method, 'GET');
      return new Response(JSON.stringify(researchQueuePayload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(status.queueStatus, 'QUEUED');

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

  assert.equal(validateGatewayBatch(['SPCE.US'], batchPayload()), null);
  const directBatchCalls = [];
  const directBatch = await fetchCanonicalGatewayBatch(['SPCE.US'], {
    baseUrl: 'https://quotes.example.com',
    clientId: firstId,
    fetchImpl: async (url, init = {}) => {
      directBatchCalls.push({ url: String(url), method: init.method, body: init.body });
      return new Response(JSON.stringify(batchPayload()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(directBatch.quoteRegistry['SPCE.US'].currency, 'USD');
  assert.equal(directBatch.fxReference.rate, 1.1616);
  assert.equal(directBatchCalls.length, 1);
  assert.equal(directBatchCalls[0].url, 'https://quotes.example.com/v1/quotes');
  assert.equal(directBatchCalls[0].method, 'POST');
  assert.deepEqual(JSON.parse(directBatchCalls[0].body), { symbols: ['SPCE.US'] });

  const snapshotCalls = [];
  const snapshot = await fetchCanonicalGatewayMarketSnapshot(['SPCE.US'], {
    baseUrl: 'https://quotes.example.com',
    clientId: firstId,
    fetchImpl: async (url) => {
      snapshotCalls.push(String(url));
      return new Response(JSON.stringify(batchPayload()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(snapshot.quoteRegistry['SPCE.US'].currency, 'USD');
  assert.equal(snapshot.fxReference.rate, 1.1616);
  assert.equal(snapshot.fxError, undefined);
  assert.equal(snapshotCalls.length, 1);

  const greekOnlyCalls = [];
  const greekOnly = await fetchCanonicalGatewayMarketSnapshot(['ALWN.GR'], {
    baseUrl: 'https://quotes.example.com',
    clientId: firstId,
    fetchImpl: async (url) => {
      greekOnlyCalls.push(String(url));
      return new Response(JSON.stringify(batchPayload(['ALWN.GR'])), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(greekOnly.fxReference, null);
  assert.equal(greekOnlyCalls.length, 1);

  const fallbackCalls = [];
  const fallback = await fetchCanonicalGatewayMarketSnapshot(['SPCE.US'], {
    baseUrl: 'https://quotes.example.com',
    clientId: firstId,
    fetchImpl: async (url) => {
      fallbackCalls.push(String(url));
      if (String(url).endsWith('/v1/quotes')) {
        return new Response(JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED' } }), { status: 405, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(String(url).includes('/v1/fx?') ? fxPayload() : quotePayload()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(fallback.quoteRegistry['SPCE.US'].currency, 'USD');
  assert.equal(fallback.fxReference.rate, 1.1616);
  assert.equal(fallbackCalls.length, 3);

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
