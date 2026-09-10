import { handleMarketGatewayRequest, parseGatewaySymbol } from './core.js';

export const MARKET_GATEWAY_CLIENT_HEADER = 'X-Investor-Control-Client';
export const MARKET_GATEWAY_EDGE_VERSION = '2026-09-10.1';

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

export function gatewayCacheTtlSeconds(appSymbol) {
  if (String(appSymbol || '').endsWith('.US')) return 5;
  if (String(appSymbol || '').endsWith('.GR')) return 60;
  return 0;
}

function cacheKeyFor(request, appSymbol) {
  const url = new URL(request.url);
  url.pathname = '/v1/quote';
  url.search = '';
  url.searchParams.set('symbol', appSymbol);
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

export async function handleMarketGatewayEdgeRequest(request, env = {}, ctx = {}, options = {}) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/v1/quote') {
    return handleMarketGatewayRequest(request, env, options.coreOptions || {});
  }

  const parsed = parseGatewaySymbol(url.searchParams.get('symbol'));
  if (!parsed) {
    return handleMarketGatewayRequest(request, env, options.coreOptions || {});
  }

  const clientId = normalizeGatewayClientId(request.headers.get(MARKET_GATEWAY_CLIENT_HEADER));
  if (!clientId) {
    return jsonError(400, 'CLIENT_ID_REQUIRED', `${MARKET_GATEWAY_CLIENT_HEADER} must contain a stable opaque installation identifier.`);
  }

  const cache = options.cache || globalThis.caches?.default || null;
  const cacheKey = cacheKeyFor(request, parsed.appSymbol);
  if (cache && typeof cache.match === 'function') {
    const cached = await cache.match(cacheKey);
    if (cached) return clientResponse(cached, 'HIT');
  }

  const clientLimiter = options.clientLimiter || env.MARKET_GATEWAY_CLIENT_RATE_LIMITER;
  const upstreamLimiter = options.upstreamLimiter || env.MARKET_GATEWAY_UPSTREAM_RATE_LIMITER;
  if (!clientLimiter || !upstreamLimiter) {
    return jsonError(503, 'EDGE_RATE_LIMITER_NOT_CONFIGURED', 'Gateway abuse protection is not configured.');
  }

  const clientLimit = await rateLimit(clientLimiter, `client:${clientId}`);
  if (!clientLimit?.success) {
    const response = jsonError(429, 'CLIENT_RATE_LIMITED', 'Client request rate limit exceeded.');
    response.headers.set('Retry-After', '60');
    return response;
  }

  const upstreamLimit = await rateLimit(upstreamLimiter, `upstream:${parsed.market}`);
  if (!upstreamLimit?.success) {
    const response = jsonError(429, 'UPSTREAM_RATE_LIMITED', 'Market-data upstream protection limit exceeded.');
    response.headers.set('Retry-After', '60');
    return response;
  }

  const upstreamResponse = await handleMarketGatewayRequest(request, env, options.coreOptions || {});
  if (upstreamResponse.status !== 200) return clientResponse(upstreamResponse, 'MISS');

  const ttlSeconds = gatewayCacheTtlSeconds(parsed.appSymbol);
  if (cache && ttlSeconds > 0 && typeof cache.put === 'function') {
    const putPromise = cache.put(cacheKey, cacheableResponse(upstreamResponse.clone(), ttlSeconds));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(putPromise);
    else await putPromise;
  }

  return clientResponse(upstreamResponse, 'MISS');
}
