import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFinnhubQuote, normalizeFinnhubQuote } from '../src/adapters/finnhub-quote.js';

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
