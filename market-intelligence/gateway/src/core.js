import { fetchEuronextAthensQuote } from '../../src/adapters/euronext-athens-quote.js';
import { fetchFinnhubQuote } from '../../src/adapters/finnhub-quote.js';
import { buildCanonicalQuoteRegistry, canonicalizeMarketSnapshot } from '../../src/canonical-market-quote.js';
import { fetchEcbEurUsdReference } from './ecb-reference-fx.js';

export const MARKET_GATEWAY_CONTRACT_VERSION = '2026-09-11.1';

const ATHENS_COMPANIES = Object.freeze({
  ALWN: Object.freeze({
    companyId: 'company:allwyn-ag',
    displayName: 'Allwyn',
    country: 'GR',
    currency: 'EUR',
    primaryListing: Object.freeze({ symbol: 'ALWN', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' }),
  }),
  CREDIA: Object.freeze({
    companyId: 'company:crediabank',
    displayName: 'CrediaBank',
    country: 'GR',
    currency: 'EUR',
    primaryListing: Object.freeze({ symbol: 'CREDIA', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' }),
  }),
});

const CORS_HEADERS = 'Content-Type, X-Investor-Control-Client';

function json(body, status = 200) {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': CORS_HEADERS,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function gatewayError(status, code, message, details = undefined) {
  return json({
    format: 'investor-control-market-gateway-error',
    version: 1,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  }, status);
}

export function parseGatewaySymbol(value) {
  const raw = String(value || '').trim().toUpperCase();
  const match = raw.match(/^([A-Z0-9][A-Z0-9.-]{0,19})\.(US|GR)$/);
  if (!match) return null;
  return { symbol: match[1], market: match[2], appSymbol: `${match[1]}.${match[2]}` };
}

const CANONICAL_US_COMPANIES = Object.freeze({
  SPCE: Object.freeze({
    companyId: 'company:virgin-galactic-holdings',
    displayName: 'Virgin Galactic',
    country: 'US',
    currency: 'USD',
    active: true,
    primaryListing: Object.freeze({
      exchange: 'New York Stock Exchange',
      symbol: 'SPCE',
      mic: 'XNYS',
      currency: 'USD',
    }),
  }),
});

function usCompany(symbol) {
  const canonical = CANONICAL_US_COMPANIES[symbol];
  if (canonical) return canonical;
  return {
    companyId: `gateway:us:${symbol}`,
    displayName: symbol,
    country: 'US',
    active: true,
    primaryListing: { symbol },
  };
}

function validateCanonicalQuote(quote, parsed) {
  if (!quote) return { ok: false, code: 'CANONICAL_QUOTE_MISSING' };
  if (quote.appSymbol !== parsed.appSymbol) return { ok: false, code: 'CANONICAL_SYMBOL_MISMATCH' };
  if (!quote.currency) return { ok: false, code: 'CANONICAL_CURRENCY_MISSING' };
  if (quote.quoteContract?.sourceApproved !== true) return { ok: false, code: 'CANONICAL_SOURCE_NOT_APPROVED' };
  if (parsed.market === 'US' && quote.quoteContract?.identityVerified !== true) {
    return { ok: false, code: 'CANONICAL_US_IDENTITY_NOT_VERIFIED' };
  }
  if (parsed.market === 'GR') {
    if (quote.currency !== 'EUR') return { ok: false, code: 'CANONICAL_ATHENS_CURRENCY_INVALID' };
    if (quote.quoteContract?.sourceRole !== 'PRIMARY_EXCHANGE') return { ok: false, code: 'CANONICAL_ATHENS_SOURCE_INVALID' };
    if (Number(quote.quoteContract?.advertisedDelayMinutes || 0) < 15) {
      return { ok: false, code: 'CANONICAL_ATHENS_DELAY_NOT_DISCLOSED' };
    }
  }
  return { ok: true };
}

export async function resolveCanonicalGatewayQuote(appSymbol, env = {}, options = {}) {
  const parsed = parseGatewaySymbol(appSymbol);
  if (!parsed) {
    return { status: 400, error: { code: 'SYMBOL_INVALID', message: 'Use canonical symbols such as SPCE.US or ALWN.GR.' } };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { status: 503, error: { code: 'FETCH_RUNTIME_UNAVAILABLE', message: 'Server fetch runtime is unavailable.' } };
  }
  const generatedAt = new Date(options.now || Date.now()).toISOString();

  let company;
  let result;
  if (parsed.market === 'US') {
    const token = String(env.FINNHUB_TOKEN || '').trim();
    if (!token) {
      return { status: 503, error: { code: 'US_PROVIDER_NOT_CONFIGURED', message: 'US market-data provider is not configured server-side.' } };
    }
    company = usCompany(parsed.symbol);
    try {
      result = await fetchFinnhubQuote(company, { fetchImpl, token, generatedAt });
    } catch (error) {
      return {
        status: 502,
        error: { code: 'US_PROVIDER_REQUEST_FAILED', message: 'Authoritative US quote request failed.', details: error instanceof Error ? error.message : String(error) },
      };
    }
  } else {
    company = ATHENS_COMPANIES[parsed.symbol] || null;
    if (!company) {
      return {
        status: 400,
        error: {
          code: 'ATHENS_SYMBOL_NOT_ALLOWED',
          message: 'Athens gateway v1 only serves exchange identities that are explicitly canonicalized.',
          details: { allowedSymbols: Object.keys(ATHENS_COMPANIES).map((symbol) => `${symbol}.GR`) },
        },
      };
    }
    try {
      result = await fetchEuronextAthensQuote(company, { fetchImpl, generatedAt });
    } catch (error) {
      return {
        status: 502,
        error: { code: 'ATHENS_PROVIDER_REQUEST_FAILED', message: 'Official Euronext Athens quote request failed.', details: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  if (!result?.snapshot) {
    return {
      status: 502,
      error: {
        code: 'QUOTE_UNAVAILABLE',
        message: 'No authoritative quote passed provider identity and integrity checks.',
        details: { diagnostics: result?.diagnostics || [] },
      },
    };
  }

  const canonical = canonicalizeMarketSnapshot(result.snapshot, company, { generatedAt });
  const registry = buildCanonicalQuoteRegistry(canonical ? [canonical] : []);
  const quote = registry[parsed.appSymbol] || null;
  const validation = validateCanonicalQuote(quote, parsed);
  if (!validation.ok) {
    return {
      status: 502,
      error: {
        code: validation.code,
        message: 'Provider data did not satisfy the canonical quote contract.',
        details: { diagnostics: result?.diagnostics || [] },
      },
    };
  }

  return {
    status: 200,
    body: {
      format: 'investor-control-market-gateway-quote',
      version: 1,
      contractVersion: MARKET_GATEWAY_CONTRACT_VERSION,
      servedAt: generatedAt,
      requestedSymbol: parsed.appSymbol,
      quote,
      diagnostics: result?.diagnostics || [],
    },
  };
}


export async function resolveInstrumentCapability(appSymbol, env = {}, options = {}) {
  const parsed = parseGatewaySymbol(appSymbol);
  if (!parsed) {
    return { status: 400, error: { code: 'SYMBOL_INVALID', message: 'Use canonical symbols such as SPCE.US or ALWN.GR.' } };
  }

  const canonicalFocus = parsed.market === 'US'
    ? CANONICAL_US_COMPANIES[parsed.symbol] || null
    : ATHENS_COMPANIES[parsed.symbol] || null;

  let quoteResult = null;
  try {
    quoteResult = await resolveCanonicalGatewayQuote(parsed.appSymbol, env, options);
  } catch (error) {
    quoteResult = {
      status: 502,
      error: {
        code: 'QUOTE_CAPABILITY_CHECK_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const quoteSupported = quoteResult?.status === 200;
  const quote = quoteSupported ? quoteResult.body.quote : null;
  const identityVerified = quote?.quoteContract?.identityVerified === true
    || (parsed.market === 'GR' && quote?.quoteContract?.sourceRole === 'PRIMARY_EXCHANGE');

  const analysisSupported = Boolean(canonicalFocus);
  const onboardingStatus = analysisSupported
    ? 'READY'
    : identityVerified
      ? 'IDENTITY_VERIFIED_ANALYSIS_ONBOARDING_REQUIRED'
      : 'IDENTITY_NOT_VERIFIED';

  return {
    status: 200,
    body: {
      format: 'investor-control-instrument-capability',
      version: 1,
      servedAt: new Date(options.now || Date.now()).toISOString(),
      requestedSymbol: parsed.appSymbol,
      market: parsed.market,
      identityVerified,
      quoteSupported,
      analysisSupported,
      onboardingStatus,
      canonicalCompanyId: canonicalFocus?.companyId || quote?.companyId || null,
      displayName: canonicalFocus?.displayName || quote?.companyName || parsed.symbol,
      currency: quote?.currency || canonicalFocus?.currency || null,
      quoteContract: quote?.quoteContract || null,
      limitations: analysisSupported
        ? []
        : identityVerified
          ? ['FULL_MINBEIS_RESEARCH_NOT_YET_CANONICAL']
          : ['CANONICAL_INSTRUMENT_IDENTITY_REQUIRED'],
      privacy: {
        acceptedInputs: ['symbol'],
        portfolioQuantityRequired: false,
        portfolioCostRequired: false,
        pnlRequired: false,
      },
    },
  };
}

function researchQueueBinding(env = {}) {
  const queue = env.MINBEIS_RESEARCH_QUEUE;
  return queue && typeof queue.get === 'function' && typeof queue.put === 'function' ? queue : null;
}

export async function enqueueResearchRequest(appSymbol, env = {}, options = {}) {
  const parsed = parseGatewaySymbol(appSymbol);
  if (!parsed) {
    return { status: 400, error: { code: 'SYMBOL_INVALID', message: 'Use a canonical symbol such as NVDA.US or ALWN.GR.' } };
  }

  const capability = await resolveInstrumentCapability(parsed.appSymbol, env, options);
  if (capability.status !== 200) return capability;
  const body = capability.body;

  if (body.analysisSupported === true) {
    return {
      status: 200,
      body: {
        format: 'investor-control-research-queue-status',
        version: 1,
        requestedSymbol: parsed.appSymbol,
        queueStatus: 'ALREADY_SUPPORTED',
        analysisSupported: true,
        queued: false,
        privacy: { acceptedInputs: ['symbol'], portfolioDataStored: false, clientIdentityStored: false },
      },
    };
  }

  if (body.identityVerified !== true) {
    return {
      status: 409,
      error: {
        code: 'CANONICAL_IDENTITY_REQUIRED',
        message: 'Research onboarding is blocked until the instrument identity is canonically verified.',
      },
    };
  }

  const queue = researchQueueBinding(env);
  if (!queue) {
    return {
      status: 503,
      error: {
        code: 'RESEARCH_QUEUE_NOT_CONFIGURED',
        message: 'Persistent MINBEIS research queue storage is not configured on the gateway.',
      },
    };
  }

  const now = new Date(options.now || Date.now()).toISOString();
  const key = `research:${parsed.appSymbol}`;
  let previous = null;
  try {
    const raw = await queue.get(key);
    previous = raw ? JSON.parse(raw) : null;
  } catch {
    previous = null;
  }
  const record = {
    format: 'minbeis-research-queue-record',
    version: 1,
    symbol: parsed.appSymbol,
    market: parsed.market,
    canonicalCompanyId: body.canonicalCompanyId || null,
    displayName: body.displayName || parsed.symbol,
    currency: body.currency || null,
    status: previous?.status === 'COMPLETED' ? 'COMPLETED' : 'QUEUED',
    firstRequestedAt: previous?.firstRequestedAt || now,
    lastRequestedAt: now,
    requestCount: Math.max(1, Number(previous?.requestCount || 0) + 1),
    source: 'INVESTOR_CONTROL_APP',
    privacy: {
      storesSymbolOnly: true,
      storesPortfolioData: false,
      storesClientIdentity: false,
    },
  };
  await queue.put(key, JSON.stringify(record));

  return {
    status: 202,
    body: {
      format: 'investor-control-research-queue-status',
      version: 1,
      requestedSymbol: parsed.appSymbol,
      queueStatus: record.status,
      queued: record.status === 'QUEUED',
      firstRequestedAt: record.firstRequestedAt,
      lastRequestedAt: record.lastRequestedAt,
      privacy: { acceptedInputs: ['symbol'], portfolioDataStored: false, clientIdentityStored: false },
    },
  };
}

export async function resolveResearchQueueStatus(appSymbol, env = {}) {
  const parsed = parseGatewaySymbol(appSymbol);
  if (!parsed) {
    return { status: 400, error: { code: 'SYMBOL_INVALID', message: 'Use a canonical symbol such as NVDA.US or ALWN.GR.' } };
  }
  const queue = researchQueueBinding(env);
  if (!queue) {
    return {
      status: 503,
      error: { code: 'RESEARCH_QUEUE_NOT_CONFIGURED', message: 'Persistent MINBEIS research queue storage is not configured on the gateway.' },
    };
  }
  const raw = await queue.get(`research:${parsed.appSymbol}`);
  if (!raw) {
    return {
      status: 200,
      body: {
        format: 'investor-control-research-queue-status',
        version: 1,
        requestedSymbol: parsed.appSymbol,
        queueStatus: 'NOT_QUEUED',
        queued: false,
        privacy: { acceptedInputs: ['symbol'], portfolioDataStored: false, clientIdentityStored: false },
      },
    };
  }
  const record = JSON.parse(raw);
  return {
    status: 200,
    body: {
      format: 'investor-control-research-queue-status',
      version: 1,
      requestedSymbol: parsed.appSymbol,
      queueStatus: record.status || 'QUEUED',
      queued: record.status === 'QUEUED',
      firstRequestedAt: record.firstRequestedAt || null,
      lastRequestedAt: record.lastRequestedAt || null,
      privacy: { acceptedInputs: ['symbol'], portfolioDataStored: false, clientIdentityStored: false },
    },
  };
}

export async function resolveCanonicalGatewayFx(pair, options = {}) {
  const normalizedPair = String(pair || '').trim().toUpperCase();
  if (normalizedPair !== 'EURUSD') {
    return { status: 400, error: { code: 'FX_PAIR_INVALID', message: 'Gateway v1 only supports the canonical EURUSD reference pair.' } };
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { status: 503, error: { code: 'FETCH_RUNTIME_UNAVAILABLE', message: 'Server fetch runtime is unavailable.' } };
  }
  const generatedAt = new Date(options.now || Date.now()).toISOString();
  const result = await fetchEcbEurUsdReference({ fetchImpl, generatedAt });
  if (!result?.reference) {
    return {
      status: 502,
      error: {
        code: 'FX_REFERENCE_UNAVAILABLE',
        message: 'Official ECB EUR/USD reference rate is unavailable or unverifiable.',
        details: { diagnostics: result?.diagnostics || [] },
      },
    };
  }
  return {
    status: 200,
    body: {
      format: 'investor-control-market-gateway-fx',
      version: 1,
      contractVersion: MARKET_GATEWAY_CONTRACT_VERSION,
      servedAt: generatedAt,
      reference: result.reference,
      diagnostics: result?.diagnostics || [],
    },
  };
}

export async function handleMarketGatewayRequest(request, env = {}, options = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': CORS_HEADERS } });

  const url = new URL(request.url);
  if (url.pathname === '/v1/research-queue' && request.method === 'POST') {
    let payload = null;
    try {
      payload = await request.json();
    } catch {
      return gatewayError(400, 'JSON_BODY_INVALID', 'Research queue requests require a JSON body.');
    }
    const allowedKeys = Object.keys(payload || {});
    if (allowedKeys.length !== 1 || allowedKeys[0] !== 'symbol') {
      return gatewayError(400, 'RESEARCH_QUEUE_PRIVACY_CONTRACT_INVALID', 'Only the canonical symbol may be submitted for research onboarding.');
    }
    const result = await enqueueResearchRequest(payload.symbol, env, options);
    if (![200, 202].includes(result.status)) return gatewayError(result.status, result.error.code, result.error.message, result.error.details);
    return json(result.body, result.status);
  }
  if (url.pathname === '/v1/research-queue' && request.method === 'GET') {
    const result = await resolveResearchQueueStatus(url.searchParams.get('symbol'), env);
    if (result.status !== 200) return gatewayError(result.status, result.error.code, result.error.message, result.error.details);
    return json(result.body, 200);
  }
  if (request.method !== 'GET') return gatewayError(405, 'METHOD_NOT_ALLOWED', 'Only GET and the symbol-only research queue POST are supported.');
  if (url.pathname === '/health') {
    return json({
      format: 'investor-control-market-gateway-health',
      version: 1,
      status: 'ok',
      contractVersion: MARKET_GATEWAY_CONTRACT_VERSION,
      providers: {
        us: String(env.FINNHUB_TOKEN || '').trim() ? 'configured' : 'not_configured',
        athens: 'official_delayed_15m',
        fx: 'ecb_official_daily_reference',
      },
    });
  }
  if (url.pathname === '/v1/instrument') {
    const result = await resolveInstrumentCapability(url.searchParams.get('symbol'), env, options);
    if (result.status !== 200) return gatewayError(result.status, result.error.code, result.error.message, result.error.details);
    return json(result.body, 200);
  }
  if (url.pathname === '/v1/fx') {
    const result = await resolveCanonicalGatewayFx(url.searchParams.get('pair'), options);
    if (result.status !== 200) return gatewayError(result.status, result.error.code, result.error.message, result.error.details);
    return json(result.body, 200);
  }
  if (url.pathname !== '/v1/quote') return gatewayError(404, 'NOT_FOUND', 'Unknown gateway route.');

  const result = await resolveCanonicalGatewayQuote(url.searchParams.get('symbol'), env, options);
  if (result.status !== 200) {
    return gatewayError(result.status, result.error.code, result.error.message, result.error.details);
  }
  return json(result.body, 200);
}
