import { handleMarketGatewayRequest, parseGatewaySymbol } from './core.js';

export const MARKET_GATEWAY_CLIENT_HEADER = 'X-Investor-Control-Client';
export const MARKET_GATEWAY_EDGE_VERSION = '2026-10-03.2';
export const MARKET_GATEWAY_BATCH_MAX_SYMBOLS = 50;
export const MARKET_GATEWAY_BATCH_CONCURRENCY = 6;

function jsonError(status, code, message) {
  return new Response(`${JSON.stringify({
    format: 'investor-control-market-gateway-edge-error',
    version: 1,
    error: { code, message },
  })}\n`, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-Investor-Control-Gateway': MARKET_GATEWAY_EDGE_VERSION,
    },
  });
}

export function normalizeGatewayClientId(value) {
  const clientId = String(value || '').trim();
  return /^[A-Za-z0-9_-]{16,128}$/.test(clientId) ? clientId : null;
}

export function gatewayCacheTtlSeconds(resourceKey) {
  if (String(resourceKey || '').startsWith('instrument:')) return 300;
  if (String(resourceKey || '').endsWith('.US')) return 30;
  if (String(resourceKey || '').endsWith('.GR')) return 60;
  if (String(resourceKey || '') === 'EURUSD') return 900;
  return 0;
}

function protectedResource(url) {
  if (url.pathname === '/v1/quote') {
    const parsed = parseGatewaySymbol(url.searchParams.get('symbol'));
    if (!parsed) return null;
    return { resourceKey: parsed.appSymbol, upstreamKey: parsed.market, paramName: 'symbol', paramValue: parsed.appSymbol, pathname: '/v1/quote' };
  }
  if (url.pathname === '/v1/instrument') {
    const parsed = parseGatewaySymbol(url.searchParams.get('symbol'));
    if (!parsed) return null;
    return { resourceKey: `instrument:${parsed.appSymbol}`, upstreamKey: parsed.market, paramName: 'symbol', paramValue: parsed.appSymbol, pathname: '/v1/instrument' };
  }
  if (url.pathname === '/v1/fx' && String(url.searchParams.get('pair') || '').trim().toUpperCase() === 'EURUSD') {
    return { resourceKey: 'EURUSD', upstreamKey: 'FX', paramName: 'pair', paramValue: 'EURUSD', pathname: '/v1/fx' };
  }
  return null;
}

function cacheKeyFor(request, resource) {
  const url = new URL(request.url);
  url.pathname = resource.pathname;
  url.search = '';
  url.searchParams.set(resource.paramName, resource.paramValue);
  return new Request(url.toString(), { method: 'GET' });
}

function clientResponse(response, cacheStatus) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, max-age=0');
  headers.set('X-Investor-Control-Cache', cacheStatus);
  headers.set('X-Investor-Control-Gateway', MARKET_GATEWAY_EDGE_VERSION);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function cacheableResponse(response, ttlSeconds) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', `public, max-age=${ttlSeconds}`);
  headers.set('X-Investor-Control-Cache', 'STORED');
  headers.set('X-Investor-Control-Gateway', MARKET_GATEWAY_EDGE_VERSION);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function rateLimit(limiter, key) {
  if (!limiter || typeof limiter.limit !== 'function') return null;
  return limiter.limit({ key });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

function batchJson(body, status = 200) {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-Investor-Control-Gateway': MARKET_GATEWAY_EDGE_VERSION,
    },
  });
}

function normalizeBatchSymbols(values) {
  if (!Array.isArray(values)) return { ok: false, error: 'BATCH_SYMBOLS_ARRAY_REQUIRED', symbols: [] };
  if (values.length < 1) return { ok: false, error: 'BATCH_SYMBOLS_EMPTY', symbols: [] };
  if (values.length > MARKET_GATEWAY_BATCH_MAX_SYMBOLS) return { ok: false, error: 'BATCH_SYMBOL_LIMIT_EXCEEDED', symbols: [] };
  const symbols = [];
  for (const value of values) {
    const parsed = parseGatewaySymbol(value);
    if (!parsed) return { ok: false, error: 'BATCH_SYMBOL_INVALID', symbols: [] };
    if (!symbols.includes(parsed.appSymbol)) symbols.push(parsed.appSymbol);
  }
  return { ok: true, symbols };
}

export async function handleMarketGatewayEdgeRequest(request, env = {}, ctx = {}, options = {}) {
  const url = new URL(request.url);

  if (url.pathname === '/v1/quotes' && request.method === 'POST') {
    const clientId = normalizeGatewayClientId(request.headers.get(MARKET_GATEWAY_CLIENT_HEADER));
    if (!clientId) {
      return jsonError(400, 'CLIENT_ID_REQUIRED', `${MARKET_GATEWAY_CLIENT_HEADER} must contain a stable opaque installation identifier.`);
    }
    let payload = null;
    try {
      payload = await request.clone().json();
    } catch {
      return jsonError(400, 'BATCH_JSON_INVALID', 'Batch quote requests require a JSON body.');
    }
    const keys = Object.keys(payload || {});
    if (keys.length !== 1 || keys[0] !== 'symbols') {
      return jsonError(400, 'BATCH_PRIVACY_CONTRACT_INVALID', 'Only canonical symbols may be submitted in a batch quote request.');
    }
    const normalized = normalizeBatchSymbols(payload.symbols);
    if (!normalized.ok) {
      return jsonError(400, normalized.error, `Batch quote request rejected. Maximum ${MARKET_GATEWAY_BATCH_MAX_SYMBOLS} canonical symbols per request.`);
    }

    const clientLimiter = options.clientLimiter || env.MARKET_GATEWAY_CLIENT_RATE_LIMITER;
    if (!clientLimiter) {
      return jsonError(503, 'EDGE_RATE_LIMITER_NOT_CONFIGURED', 'Gateway abuse protection is not configured.');
    }
    const clientLimit = await rateLimit(clientLimiter, `client:${clientId}`);
    if (!clientLimit?.success) {
      const response = jsonError(429, 'CLIENT_RATE_LIMITED', 'Client request rate limit exceeded.');
      response.headers.set('Retry-After', '60');
      return response;
    }

    const quoteResults = await mapWithConcurrency(
      normalized.symbols,
      MARKET_GATEWAY_BATCH_CONCURRENCY,
      async (symbol) => {
        const quoteUrl = new URL(request.url);
        quoteUrl.pathname = '/v1/quote';
        quoteUrl.search = '';
        quoteUrl.searchParams.set('symbol', symbol);
        const subRequest = new Request(quoteUrl.toString(), {
          method: 'GET',
          headers: { [MARKET_GATEWAY_CLIENT_HEADER]: clientId, Accept: 'application/json' },
        });
        const response = await handleMarketGatewayEdgeRequest(subRequest, env, ctx, {
          ...options,
          skipClientRateLimit: true,
        });
        let body = null;
        try { body = await response.json(); } catch {}
        return { symbol, status: response.status, body };
      },
    );

    const quoteRegistry = {};
    const errors = [];
    for (const result of quoteResults) {
      if (result.status === 200 && result.body?.quote?.appSymbol === result.symbol) {
        quoteRegistry[result.symbol] = result.body.quote;
      } else {
        errors.push({
          symbol: result.symbol,
          code: String(result.body?.error?.code || `HTTP_${result.status}`),
        });
      }
    }

    let fxReference = null;
    let fxError = null;
    if (normalized.symbols.some((symbol) => symbol.endsWith('.US'))) {
      const fxUrl = new URL(request.url);
      fxUrl.pathname = '/v1/fx';
      fxUrl.search = '';
      fxUrl.searchParams.set('pair', 'EURUSD');
      const fxRequest = new Request(fxUrl.toString(), {
        method: 'GET',
        headers: { [MARKET_GATEWAY_CLIENT_HEADER]: clientId, Accept: 'application/json' },
      });
      const fxResponse = await handleMarketGatewayEdgeRequest(fxRequest, env, ctx, {
        ...options,
        skipClientRateLimit: true,
      });
      let fxBody = null;
      try { fxBody = await fxResponse.json(); } catch {}
      if (fxResponse.status === 200 && fxBody?.reference?.pair === 'EURUSD') fxReference = fxBody.reference;
      else fxError = String(fxBody?.error?.code || `HTTP_${fxResponse.status}`);
    }

    return batchJson({
      format: 'investor-control-market-gateway-batch',
      version: 1,
      servedAt: new Date().toISOString(),
      requestedSymbols: normalized.symbols,
      quoteRegistry,
      errors,
      fxReference,
      ...(fxError ? { fxError } : {}),
      privacy: {
        acceptedInputs: ['symbols'],
        portfolioQuantityRequired: false,
        portfolioCostRequired: false,
        pnlRequired: false,
      },
    });
  }

  if (url.pathname === '/v1/research-queue' && ['GET', 'POST'].includes(request.method)) {
    const clientId = normalizeGatewayClientId(request.headers.get(MARKET_GATEWAY_CLIENT_HEADER));
    if (!clientId) {
      return jsonError(400, 'CLIENT_ID_REQUIRED', `${MARKET_GATEWAY_CLIENT_HEADER} must contain a stable opaque installation identifier.`);
    }
    const clientLimiter = options.clientLimiter || env.MARKET_GATEWAY_CLIENT_RATE_LIMITER;
    if (!clientLimiter) {
      return jsonError(503, 'EDGE_RATE_LIMITER_NOT_CONFIGURED', 'Gateway abuse protection is not configured.');
    }
    const clientLimit = await rateLimit(clientLimiter, `client:${clientId}`);
    if (!clientLimit?.success) {
      const response = jsonError(429, 'CLIENT_RATE_LIMITED', 'Client request rate limit exceeded.');
      response.headers.set('Retry-After', '60');
      return response;
    }
    return handleMarketGatewayRequest(request, env, options.coreOptions || {});
  }

  if (request.method !== 'GET') return handleMarketGatewayRequest(request, env, options.coreOptions || {});

  const resource = protectedResource(url);
  if (!resource) return handleMarketGatewayRequest(request, env, options.coreOptions || {});

  const clientId = normalizeGatewayClientId(request.headers.get(MARKET_GATEWAY_CLIENT_HEADER));
  if (!clientId) {
    return jsonError(400, 'CLIENT_ID_REQUIRED', `${MARKET_GATEWAY_CLIENT_HEADER} must contain a stable opaque installation identifier.`);
  }

  const cache = options.cache || globalThis.caches?.default || null;
  const cacheKey = cacheKeyFor(request, resource);
  if (cache && typeof cache.match === 'function') {
    const cached = await cache.match(cacheKey);
    if (cached) return clientResponse(cached, 'HIT');
  }

  const clientLimiter = options.clientLimiter || env.MARKET_GATEWAY_CLIENT_RATE_LIMITER;
  const upstreamLimiter = options.upstreamLimiter || env.MARKET_GATEWAY_UPSTREAM_RATE_LIMITER;
  const skipClientRateLimit = options.skipClientRateLimit === true;
  if ((!skipClientRateLimit && !clientLimiter) || !upstreamLimiter) {
    return jsonError(503, 'EDGE_RATE_LIMITER_NOT_CONFIGURED', 'Gateway abuse protection is not configured.');
  }

  if (!skipClientRateLimit) {
    const clientLimit = await rateLimit(clientLimiter, `client:${clientId}`);
    if (!clientLimit?.success) {
      const response = jsonError(429, 'CLIENT_RATE_LIMITED', 'Client request rate limit exceeded.');
      response.headers.set('Retry-After', '60');
      return response;
    }
  }

  const upstreamLimit = await rateLimit(upstreamLimiter, `upstream:${resource.upstreamKey}`);
  if (!upstreamLimit?.success) {
    const response = jsonError(429, 'UPSTREAM_RATE_LIMITED', 'Market-data upstream protection limit exceeded.');
    response.headers.set('Retry-After', '60');
    return response;
  }

  const upstreamResponse = await handleMarketGatewayRequest(request, env, options.coreOptions || {});
  if (upstreamResponse.status !== 200) return clientResponse(upstreamResponse, 'MISS');

  const ttlSeconds = gatewayCacheTtlSeconds(resource.resourceKey);
  if (cache && ttlSeconds > 0 && typeof cache.put === 'function') {
    const putPromise = cache.put(cacheKey, cacheableResponse(upstreamResponse.clone(), ttlSeconds));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(putPromise);
    else await putPromise;
  }

  return clientResponse(upstreamResponse, 'MISS');
}
