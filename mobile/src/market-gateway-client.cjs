'use strict';

const MARKET_GATEWAY_CLIENT_HEADER = 'X-Investor-Control-Client';
const MARKET_GATEWAY_CLIENT_STORAGE_KEY = 'investor-control.market-gateway-client.v1';

function canonicalSymbol(value) {
  const raw = String(value || '').trim().toUpperCase();
  return /^([A-Z0-9][A-Z0-9.-]{0,19})\.(US|GR)$/.test(raw) ? raw : null;
}

function normalizeClientId(value) {
  const raw = String(value || '').trim();
  return /^[A-Za-z0-9_-]{16,128}$/.test(raw) ? raw : null;
}

function normalizeGatewayBaseUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch (_) {
    return null;
  }
}

function createOpaqueInstallationId({ now = Date.now, random = Math.random } = {}) {
  const timePart = Number(now()).toString(36);
  const randomPart = () => Math.floor(Number(random()) * Number.MAX_SAFE_INTEGER).toString(36).padStart(10, '0');
  return `ic_${timePart}_${randomPart()}${randomPart()}`.slice(0, 96);
}

async function getOrCreateInstallationId(storage, options = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new Error('MARKET_GATEWAY_STORAGE_UNAVAILABLE');
  }
  const key = options.storageKey || MARKET_GATEWAY_CLIENT_STORAGE_KEY;
  const existing = normalizeClientId(await storage.getItem(key));
  if (existing) return existing;
  const created = normalizeClientId(createOpaqueInstallationId(options));
  if (!created) throw new Error('MARKET_GATEWAY_CLIENT_ID_GENERATION_FAILED');
  await storage.setItem(key, created);
  return created;
}

function validateGatewayQuote(appSymbol, payload) {
  if (payload?.format !== 'investor-control-market-gateway-quote') return 'GATEWAY_FORMAT_INVALID';
  if (payload?.requestedSymbol !== appSymbol) return 'GATEWAY_REQUEST_SYMBOL_MISMATCH';
  const quote = payload?.quote;
  if (!quote || quote.appSymbol !== appSymbol) return 'GATEWAY_QUOTE_SYMBOL_MISMATCH';
  if (!/^[A-Z]{3}$/.test(String(quote.currency || ''))) return 'GATEWAY_CURRENCY_INVALID';
  if (quote?.quoteContract?.sourceApproved !== true) return 'GATEWAY_SOURCE_NOT_APPROVED';
  if (appSymbol.endsWith('.US') && quote?.quoteContract?.identityVerified !== true) return 'GATEWAY_US_IDENTITY_NOT_VERIFIED';
  if (appSymbol.endsWith('.GR') && quote?.quoteContract?.sourceRole !== 'PRIMARY_EXCHANGE') return 'GATEWAY_ATHENS_SOURCE_INVALID';
  return null;
}

async function fetchCanonicalGatewayQuote(appSymbol, options = {}) {
  const symbol = canonicalSymbol(appSymbol);
  if (!symbol) throw new Error('MARKET_GATEWAY_SYMBOL_INVALID');
  const baseUrl = normalizeGatewayBaseUrl(options.baseUrl);
  if (!baseUrl) throw new Error('MARKET_GATEWAY_URL_INVALID');
  const clientId = normalizeClientId(options.clientId);
  if (!clientId) throw new Error('MARKET_GATEWAY_CLIENT_ID_INVALID');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('MARKET_GATEWAY_FETCH_UNAVAILABLE');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 10_000));
  try {
    const url = `${baseUrl}/v1/quote?symbol=${encodeURIComponent(symbol)}`;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        [MARKET_GATEWAY_CLIENT_HEADER]: clientId,
      },
      signal: controller.signal,
    });
    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      const code = String(payload?.error?.code || `HTTP_${response.status}`);
      const error = new Error(code);
      error.status = response.status;
      error.gatewayCode = code;
      throw error;
    }
    const validationError = validateGatewayQuote(symbol, payload);
    if (validationError) throw new Error(validationError);
    return payload.quote;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCanonicalGatewayQuotes(symbols, options = {}) {
  const clean = [...new Set((symbols || []).map(canonicalSymbol).filter(Boolean))];
  const quoteRegistry = {};
  const errors = [];
  await Promise.all(clean.map(async (symbol) => {
    try {
      quoteRegistry[symbol] = await fetchCanonicalGatewayQuote(symbol, options);
    } catch (error) {
      errors.push({ symbol, code: String(error?.gatewayCode || error?.message || 'MARKET_GATEWAY_REQUEST_FAILED') });
    }
  }));
  return { quoteRegistry, errors, checkedAt: new Date().toISOString() };
}

module.exports = {
  MARKET_GATEWAY_CLIENT_HEADER,
  MARKET_GATEWAY_CLIENT_STORAGE_KEY,
  canonicalSymbol,
  normalizeClientId,
  normalizeGatewayBaseUrl,
  createOpaqueInstallationId,
  getOrCreateInstallationId,
  validateGatewayQuote,
  fetchCanonicalGatewayQuote,
  fetchCanonicalGatewayQuotes,
};
