import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFinnhubQuote, normalizeFinnhubCompanyProfile, normalizeFinnhubQuote } from '../src/adapters/finnhub-quote.js';

const SPCE = {
  companyId: 'company:virgin-galactic-holdings',
  legalName: 'Virgin Galactic Holdings, Inc.',
  displayName: 'Virgin Galactic',
  country: 'US',
  currency: 'USD',
  primaryListing: { exchange: 'New York Stock Exchange', symbol: 'SPCE', mic: 'XNYS' },
};

const ALLWYN = {
  companyId: 'company:allwyn-ag',
  legalName: 'Allwyn AG',
  displayName: 'Allwyn',
  country: 'CH',
  currency: 'EUR',
  primaryListing: { exchange: 'Euronext Athens', symbol: 'ALWN', mic: 'XATH' },
};

test('Finnhub quote normalization calculates daily move but does not pretend liquidity is known', () => {
  const snapshot = normalizeFinnhubQuote({
    c: 2.5,
    pc: 2.4,
    o: 2.42,
    h: 2.55,
    l: 2.38,
    t: 1785120000,
  }, SPCE, {
    generatedAt: '2026-07-27T12:00:00.000Z',
  });

  assert.equal(snapshot.currentPrice, 2.5);
  assert.equal(snapshot.dailyChange, 0.1);
  assert.equal(snapshot.dailyChangePct, 4.17);
  assert.equal(snapshot.usable, true);
  assert.equal(snapshot.marketMetricsReady, false);
  assert.equal(snapshot.liquidityMetricsReady, false);
  assert.equal(snapshot.relativeStrengthMetricsReady, false);
});

test('Finnhub adapter refuses to fetch without a token', async () => {
  const result = await fetchFinnhubQuote(SPCE, {
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  assert.equal(result.snapshot, null);
  assert.ok(result.diagnostics.some((item) => item.code === 'FINNHUB_TOKEN_MISSING'));
});

test('Finnhub adapter blocks unsupported non-US market coverage', async () => {
  const result = await fetchFinnhubQuote(ALLWYN, {
    token: 'test-token',
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  assert.equal(result.snapshot, null);
  assert.ok(result.diagnostics.some((item) => item.code === 'FINNHUB_QUOTE_UNSUPPORTED_MARKET'));
});

test('Finnhub adapter authenticates using header and returns a guarded quote', async () => {
  let requestedUrl = null;
  let tokenHeader = null;
  const fetchImpl = async (url, options) => {
    requestedUrl = String(url);
    tokenHeader = options.headers['X-Finnhub-Token'];
    return {
      ok: true,
      status: 200,
      json: async () => ({ c: 2.5, pc: 2.4, o: 2.42, h: 2.55, l: 2.38, t: 1785120000 }),
    };
  };

  const result = await fetchFinnhubQuote(SPCE, {
    fetchImpl,
    token: 'secret-test-token',
    generatedAt: '2026-07-27T12:00:00.000Z',
  });

  assert.match(requestedUrl, /finnhub\.io\/api\/v1\/quote\?symbol=SPCE/);
  assert.equal(tokenHeader, 'secret-test-token');
  assert.equal(result.snapshot.usable, true);
  assert.equal(result.snapshot.marketMetricsReady, false);
});


test('Finnhub normalization preserves authoritative primary-listing currency for discovered US symbols', () => {
  const discovered = {
    companyId: 'company:dynamic:nvda',
    displayName: 'NVIDIA Corporation',
    country: 'US',
    primaryListing: { exchange: 'Nasdaq', symbol: 'NVDA', mic: 'XNAS', currency: 'USD' },
  };
  const snapshot = normalizeFinnhubQuote({ c: 180, pc: 178, t: 1785120000 }, discovered, {
    generatedAt: '2026-07-27T12:00:00.000Z',
  });
  assert.equal(snapshot.currency, 'USD');
  assert.equal(snapshot.quoteIdentityVerified, true);
  assert.equal(snapshot.usable, true);
});

test('Finnhub Company Profile 2 binds missing currency to the exact requested ticker before quote retrieval', async () => {
  const company = {
    companyId: 'company:dynamic:nvda',
    displayName: 'NVIDIA Corporation',
    country: 'US',
    primaryListing: { exchange: 'Nasdaq', symbol: 'NVDA', mic: 'XNAS' },
  };
  const requested = [];
  const fetchImpl = async (url, options) => {
    requested.push(String(url));
    assert.equal(options.headers['X-Finnhub-Token'], 'server-token');
    if (String(url).includes('/stock/profile2?')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ticker: 'NVDA', currency: 'USD', exchange: 'NASDAQ NMS - GLOBAL MARKET', country: 'US', name: 'NVIDIA Corp' }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ c: 180, pc: 178, o: 179, h: 181, l: 177, t: 1785120000 }),
    };
  };

  const result = await fetchFinnhubQuote(company, {
    fetchImpl,
    token: 'server-token',
    generatedAt: '2026-07-27T12:00:00.000Z',
  });

  assert.equal(requested.length, 2);
  assert.match(requested[0], /finnhub\.io\/api\/v1\/stock\/profile2\?symbol=NVDA/);
  assert.match(requested[1], /finnhub\.io\/api\/v1\/quote\?symbol=NVDA/);
  assert.equal(result.snapshot.currency, 'USD');
  assert.equal(result.snapshot.quoteIdentityVerified, true);
  assert.equal(result.snapshot.identityEvidence.source, 'Finnhub Company Profile 2');
  assert.equal(result.snapshot.identityEvidence.ticker, 'NVDA');
  assert.equal(result.snapshot.usable, true);
});

test('Finnhub identity lookup fails closed on ticker mismatch and never requests the quote', async () => {
  const company = {
    companyId: 'company:dynamic:nvda',
    displayName: 'NVIDIA Corporation',
    country: 'US',
    primaryListing: { exchange: 'Nasdaq', symbol: 'NVDA', mic: 'XNAS' },
  };
  let calls = 0;
  const result = await fetchFinnhubQuote(company, {
    token: 'server-token',
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ ticker: 'OTHER', currency: 'USD' }) };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.snapshot, null);
  assert.ok(result.diagnostics.some((item) => item.code === 'FINNHUB_IDENTITY_MISMATCH'));
});

test('Finnhub identity lookup fails closed when provider currency is absent', async () => {
  const company = {
    companyId: 'company:dynamic:nvda',
    displayName: 'NVIDIA Corporation',
    country: 'US',
    primaryListing: { exchange: 'Nasdaq', symbol: 'NVDA', mic: 'XNAS' },
  };
  const result = await fetchFinnhubQuote(company, {
    token: 'server-token',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ticker: 'NVDA', currency: '' }) }),
  });
  assert.equal(result.snapshot, null);
  assert.ok(result.diagnostics.some((item) => item.code === 'FINNHUB_CURRENCY_UNVERIFIED'));
});

test('Finnhub Company Profile 2 normalization never treats a different ticker as verified identity', () => {
  const profile = normalizeFinnhubCompanyProfile({ ticker: 'NVDA', currency: 'USD' }, {
    requestedSymbol: 'NVDAA',
    checkedAt: '2026-07-27T12:00:00.000Z',
  });
  assert.equal(profile.tickerMatches, false);
  assert.equal(profile.verified, false);
});
