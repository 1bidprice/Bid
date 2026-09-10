import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMarketGatewayRequest, parseGatewaySymbol } from '../gateway/src/core.js';

function request(symbol, path = '/v1/quote') {
  const suffix = symbol === undefined ? '' : `?symbol=${encodeURIComponent(symbol)}`;
  return new Request(`https://gateway.test${path}${suffix}`);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('gateway parses canonical app symbols and rejects ambiguous raw tickers', () => {
  assert.deepEqual(parseGatewaySymbol('spce.us'), { symbol: 'SPCE', market: 'US', appSymbol: 'SPCE.US' });
  assert.deepEqual(parseGatewaySymbol('brk.b.us'), { symbol: 'BRK.B', market: 'US', appSymbol: 'BRK.B.US' });
  assert.equal(parseGatewaySymbol('SPCE'), null);
  assert.equal(parseGatewaySymbol('SPCE.NYSE'), null);
});

test('US quote is identity-verified server-side and never exposes the Finnhub secret', async () => {
  const calls = [];
  const secret = 'server-only-finnhub-secret';
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    assert.equal(init.headers?.['X-Finnhub-Token'], secret);
    assert.equal(String(url).includes(secret), false);
    if (String(url).includes('/stock/profile2')) {
      return jsonResponse({ ticker: 'SPCE', currency: 'USD', exchange: 'NYSE', country: 'US', name: 'Virgin Galactic Holdings Inc' });
    }
    if (String(url).includes('/quote')) {
      return jsonResponse({
        c: 3.21,
        pc: 3.1,
        o: 3.12,
        h: 3.25,
        l: 3.05,
        d: 0.11,
        dp: 3.5484,
        t: Math.floor(Date.parse('2026-09-10T14:59:00.000Z') / 1000),
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const response = await handleMarketGatewayRequest(request('SPCE.US'), { FINNHUB_TOKEN: secret }, {
    fetchImpl,
    now: '2026-09-10T15:00:00.000Z',
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.requestedSymbol, 'SPCE.US');
  assert.equal(body.quote.appSymbol, 'SPCE.US');
  assert.equal(body.quote.currency, 'USD');
  assert.equal(body.quote.quoteContract.identityVerified, true);
  assert.equal(body.quote.quoteContract.sourceApproved, true);
  assert.equal(body.quote.quoteContract.sourceRole, 'LICENSED_MARKET_DATA');
  assert.equal(body.quote.quoteContract.valuationEligible, true);
  assert.equal(JSON.stringify(body).includes(secret), false);
  assert.equal(calls.length, 2);
});

test('US ticker mismatch fails closed before the quote endpoint is called', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ ticker: 'WRONG', currency: 'USD', exchange: 'NASDAQ', country: 'US' });
  };
  const response = await handleMarketGatewayRequest(request('NVDA.US'), { FINNHUB_TOKEN: 'secret' }, {
    fetchImpl,
    now: '2026-09-10T15:00:00.000Z',
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error.code, 'QUOTE_UNAVAILABLE');
  assert.equal(body.error.details.diagnostics[0].code, 'FINNHUB_IDENTITY_MISMATCH');
  assert.equal(calls, 1);
});

test('US missing provider currency fails closed instead of assuming USD', async () => {
  const fetchImpl = async () => jsonResponse({ ticker: 'NVDA', currency: '', exchange: 'NASDAQ', country: 'US' });
  const response = await handleMarketGatewayRequest(request('NVDA.US'), { FINNHUB_TOKEN: 'secret' }, {
    fetchImpl,
    now: '2026-09-10T15:00:00.000Z',
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error.details.diagnostics[0].code, 'FINNHUB_CURRENCY_UNVERIFIED');
});

test('US route requires Finnhub credential only on the server', async () => {
  let called = false;
  const response = await handleMarketGatewayRequest(request('SPCE.US'), {}, {
    fetchImpl: async () => { called = true; throw new Error('should not run'); },
    now: '2026-09-10T15:00:00.000Z',
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, 'US_PROVIDER_NOT_CONFIGURED');
  assert.equal(called, false);
});

test('Athens quote stays official delayed analysis-only and retains EUR', async () => {
  const html = `
    <html><body>
      <div>Last Traded Price 13,64</div>
      <div>Previous Close 13,45</div>
      <div>Opening Price 13,50</div>
      <div>Daily High Price 13,70</div>
      <div>Daily Low Price 13,40</div>
      <div>Total Volume 123.456</div>
    </body></html>`;
  const fetchImpl = async (url) => {
    assert.match(String(url), /^https:\/\/athens\.euronext\.com\//);
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
  };
  const response = await handleMarketGatewayRequest(request('ALWN.GR'), {}, {
    fetchImpl,
    now: '2026-09-10T10:00:00.000Z',
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.quote.appSymbol, 'ALWN.GR');
  assert.equal(body.quote.currency, 'EUR');
  assert.equal(body.quote.sourceQuality, 'OFFICIAL_DELAYED');
  assert.equal(body.quote.quoteContract.sourceRole, 'PRIMARY_EXCHANGE');
  assert.equal(body.quote.quoteContract.timestampVerified, false);
  assert.equal(body.quote.quoteContract.advertisedDelayMinutes, 15);
  assert.equal(body.quote.quoteContract.analysisReferenceEligible, true);
  assert.equal(body.quote.quoteContract.executionFreshnessEligible, false);
  assert.equal(body.quote.quoteContract.decisionEligible, false);
});

test('unknown Athens symbol is rejected before any external request', async () => {
  let called = false;
  const response = await handleMarketGatewayRequest(request('UNKNOWN.GR'), {}, {
    fetchImpl: async () => { called = true; throw new Error('should not run'); },
    now: '2026-09-10T10:00:00.000Z',
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, 'ATHENS_SYMBOL_NOT_ALLOWED');
  assert.deepEqual(body.error.details.allowedSymbols, ['ALWN.GR', 'CREDIA.GR']);
  assert.equal(called, false);
});

test('health reports provider configuration without exposing secret value', async () => {
  const response = await handleMarketGatewayRequest(request(undefined, '/health'), { FINNHUB_TOKEN: 'secret-value' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.providers.us, 'configured');
  assert.equal(body.providers.athens, 'official_delayed_15m');
  assert.equal(JSON.stringify(body).includes('secret-value'), false);
});
