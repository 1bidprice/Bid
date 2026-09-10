import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET_GATEWAY_CLIENT_HEADER,
  gatewayCacheTtlSeconds,
  handleMarketGatewayEdgeRequest,
  normalizeGatewayClientId,
} from '../gateway/src/edge.js';

const CLIENT_ID = 'install_0123456789abcdef0123456789';

function quoteRequest(symbol = 'SPCE.US', clientId = CLIENT_ID) {
  const headers = clientId === null ? {} : { [MARKET_GATEWAY_CLIENT_HEADER]: clientId };
  return new Request(`https://gateway.test/v1/quote?symbol=${encodeURIComponent(symbol)}`, { headers });
}

function fxRequest(clientId = CLIENT_ID) {
  const headers = clientId === null ? {} : { [MARKET_GATEWAY_CLIENT_HEADER]: clientId };
  return new Request('https://gateway.test/v1/fx?pair=EURUSD', { headers });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function liveUsFetch(secret = 'server-secret') {
  return async (url, init = {}) => {
    assert.equal(init.headers?.['X-Finnhub-Token'], secret);
    assert.equal(String(url).includes(secret), false);
    if (String(url).includes('/stock/profile2')) return jsonResponse({ ticker: 'SPCE', currency: 'USD', exchange: 'NYSE', country: 'US', name: 'Virgin Galactic Holdings Inc' });
    if (String(url).includes('/quote')) return jsonResponse({ c: 3.21, pc: 3.1, o: 3.12, h: 3.25, l: 3.05, d: 0.11, dp: 3.5484, t: 1789052340 });
    throw new Error(`Unexpected URL: ${url}`);
  };
}

function limiter(success = true, calls = []) {
  return { async limit({ key }) { calls.push(key); return { success }; } };
}

function memoryCache(initial = null) {
  let stored = initial;
  const puts = [];
  return {
    puts,
    async match() { return stored ? stored.clone() : undefined; },
    async put(key, response) { puts.push({ key: key.url, cacheControl: response.headers.get('Cache-Control') }); stored = response.clone(); },
  };
}

test('edge client identifier is opaque, stable-format only', () => {
  assert.equal(normalizeGatewayClientId(CLIENT_ID), CLIENT_ID);
  assert.equal(normalizeGatewayClientId('too-short'), null);
  assert.equal(normalizeGatewayClientId('install id with spaces 123456'), null);
  assert.equal(normalizeGatewayClientId('a'.repeat(129)), null);
});

test('edge cache TTL is bounded by source cadence', () => {
  assert.equal(gatewayCacheTtlSeconds('SPCE.US'), 5);
  assert.equal(gatewayCacheTtlSeconds('ALWN.GR'), 60);
  assert.equal(gatewayCacheTtlSeconds('EURUSD'), 900);
  assert.equal(gatewayCacheTtlSeconds('UNKNOWN.X'), 0);
});

test('quote route requires an installation id before any provider or limiter work', async () => {
  let limiterCalls = 0;
  let fetchCalls = 0;
  const response = await handleMarketGatewayEdgeRequest(quoteRequest('SPCE.US', null), {
    FINNHUB_TOKEN: 'server-secret',
    MARKET_GATEWAY_CLIENT_RATE_LIMITER: { limit: async () => { limiterCalls += 1; return { success: true }; } },
    MARKET_GATEWAY_UPSTREAM_RATE_LIMITER: { limit: async () => { limiterCalls += 1; return { success: true }; } },
  }, {}, { cache: memoryCache(), coreOptions: { fetchImpl: async () => { fetchCalls += 1; throw new Error('must not run'); } } });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'CLIENT_ID_REQUIRED');
  assert.equal(limiterCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('cache hit bypasses rate-limit counters and upstream providers', async () => {
  const cachedBody = { format: 'investor-control-market-gateway-quote', requestedSymbol: 'SPCE.US', quote: { appSymbol: 'SPCE.US' } };
  const cache = memoryCache(new Response(JSON.stringify(cachedBody), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  let limiterCalls = 0;
  let fetchCalls = 0;
  const response = await handleMarketGatewayEdgeRequest(quoteRequest(), {
    FINNHUB_TOKEN: 'server-secret',
    MARKET_GATEWAY_CLIENT_RATE_LIMITER: { limit: async () => { limiterCalls += 1; return { success: true }; } },
    MARKET_GATEWAY_UPSTREAM_RATE_LIMITER: { limit: async () => { limiterCalls += 1; return { success: true }; } },
  }, {}, { cache, coreOptions: { fetchImpl: async () => { fetchCalls += 1; throw new Error('must not run'); } } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Investor-Control-Cache'), 'HIT');
  assert.equal(response.headers.get('Cache-Control'), 'no-store, max-age=0');
  assert.equal(limiterCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('cache miss applies both limiters, calls canonical core and stores only a five-second US edge copy', async () => {
  const clientCalls = [];
  const upstreamCalls = [];
  const cache = memoryCache();
  const waitUntil = [];
  const response = await handleMarketGatewayEdgeRequest(quoteRequest(), {
    FINNHUB_TOKEN: 'server-secret',
    MARKET_GATEWAY_CLIENT_RATE_LIMITER: limiter(true, clientCalls),
    MARKET_GATEWAY_UPSTREAM_RATE_LIMITER: limiter(true, upstreamCalls),
  }, { waitUntil(promise) { waitUntil.push(promise); } }, { cache, coreOptions: { fetchImpl: liveUsFetch(), now: '2026-09-10T15:00:00.000Z' } });
  await Promise.all(waitUntil);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Investor-Control-Cache'), 'MISS');
  assert.equal(response.headers.get('Cache-Control'), 'no-store, max-age=0');
  assert.deepEqual(clientCalls, [`client:${CLIENT_ID}`]);
  assert.deepEqual(upstreamCalls, ['upstream:US']);
  assert.equal(cache.puts.length, 1);
  assert.equal(cache.puts[0].cacheControl, 'public, max-age=5');
  const body = await response.json();
  assert.equal(body.quote.currency, 'USD');
  assert.equal(body.quote.quoteContract.identityVerified, true);
  assert.equal(JSON.stringify(body).includes('server-secret'), false);
});

test('ECB FX route is client-protected, upstream-limited and cached for fifteen minutes', async () => {
  const clientCalls = [];
  const upstreamCalls = [];
  const cache = memoryCache();
  const waitUntil = [];
  const response = await handleMarketGatewayEdgeRequest(fxRequest(), {
    MARKET_GATEWAY_CLIENT_RATE_LIMITER: limiter(true, clientCalls),
    MARKET_GATEWAY_UPSTREAM_RATE_LIMITER: limiter(true, upstreamCalls),
  }, { waitUntil(promise) { waitUntil.push(promise); } }, {
    cache,
    coreOptions: {
      now: '2026-09-10T17:00:00.000Z',
      fetchImpl: async () => new Response('<?xml version="1.0"?><Cube><Cube time="2026-09-10"><Cube currency="USD" rate="1.1616"/></Cube></Cube>', { status: 200 }),
    },
  });
  await Promise.all(waitUntil);
  assert.equal(response.status, 200);
  assert.deepEqual(clientCalls, [`client:${CLIENT_ID}`]);
  assert.deepEqual(upstreamCalls, ['upstream:FX']);
  assert.equal(cache.puts.length, 1);
  assert.equal(cache.puts[0].cacheControl, 'public, max-age=900');
  const body = await response.json();
  assert.equal(body.reference.rate, 1.1616);
  assert.equal(body.reference.transactionEligible, false);
});

test('client limiter fails closed before upstream quota or provider calls', async () => {
  const clientCalls = [];
  const upstreamCalls = [];
  let fetchCalls = 0;
  const response = await handleMarketGatewayEdgeRequest(quoteRequest(), {
    FINNHUB_TOKEN: 'server-secret',
    MARKET_GATEWAY_CLIENT_RATE_LIMITER: limiter(false, clientCalls),
    MARKET_GATEWAY_UPSTREAM_RATE_LIMITER: limiter(true, upstreamCalls),
  }, {}, { cache: memoryCache(), coreOptions: { fetchImpl: async () => { fetchCalls += 1; throw new Error('must not run'); } } });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, 'CLIENT_RATE_LIMITED');
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.deepEqual(clientCalls, [`client:${CLIENT_ID}`]);
  assert.deepEqual(upstreamCalls, []);
  assert.equal(fetchCalls, 0);
});

test('upstream limiter fails closed before provider calls', async () => {
  const clientCalls = [];
  const upstreamCalls = [];
  let fetchCalls = 0;
  const response = await handleMarketGatewayEdgeRequest(quoteRequest(), {
    FINNHUB_TOKEN: 'server-secret',
    MARKET_GATEWAY_CLIENT_RATE_LIMITER: limiter(true, clientCalls),
    MARKET_GATEWAY_UPSTREAM_RATE_LIMITER: limiter(false, upstreamCalls),
  }, {}, { cache: memoryCache(), coreOptions: { fetchImpl: async () => { fetchCalls += 1; throw new Error('must not run'); } } });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, 'UPSTREAM_RATE_LIMITED');
  assert.deepEqual(upstreamCalls, ['upstream:US']);
  assert.equal(fetchCalls, 0);
});

test('missing edge rate-limit bindings fail closed rather than silently disabling abuse protection', async () => {
  const response = await handleMarketGatewayEdgeRequest(quoteRequest(), { FINNHUB_TOKEN: 'server-secret' }, {}, { cache: memoryCache(), coreOptions: { fetchImpl: liveUsFetch() } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'EDGE_RATE_LIMITER_NOT_CONFIGURED');
});
