function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function normalizeCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function companyCurrency(company = {}) {
  return normalizeCurrency(
    company.currency
      || company.primaryListing?.currency
      || company.listings?.[0]?.currency
      || null,
  );
}

export function normalizeFinnhubCompanyProfile(payload, options = {}) {
  const requestedSymbol = String(options.requestedSymbol || '').trim().toUpperCase();
  const ticker = String(payload?.ticker || '').trim().toUpperCase();
  const currency = normalizeCurrency(payload?.currency);
  const tickerMatches = Boolean(requestedSymbol && ticker && ticker === requestedSymbol);
  const checkedAt = new Date(options.checkedAt || Date.now()).toISOString();

  return {
    requestedSymbol: requestedSymbol || null,
    ticker: ticker || null,
    currency,
    exchange: String(payload?.exchange || '').trim() || null,
    country: String(payload?.country || '').trim() || null,
    name: String(payload?.name || '').trim() || null,
    tickerMatches,
    verified: tickerMatches && Boolean(currency),
    source: 'Finnhub Company Profile 2',
    sourceUrl: requestedSymbol
      ? `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(requestedSymbol)}`
      : null,
    checkedAt,
  };
}

async function fetchFinnhubCompanyProfile(symbol, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const token = String(options.token || '').trim();
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'X-Finnhub-Token': token,
    },
  });
  if (!response.ok) throw new Error(`Finnhub company profile request failed: ${response.status}`);
  const payload = await response.json();
  return normalizeFinnhubCompanyProfile(payload, {
    requestedSymbol: symbol,
    checkedAt: options.generatedAt,
  });
}

export function normalizeFinnhubQuote(payload, company, options = {}) {
  const currentPrice = numeric(payload?.c);
  const previousClose = numeric(payload?.pc);
  const quoteTimestampSeconds = numeric(payload?.t);
  const generatedAt = new Date(options.generatedAt || Date.now());
  const quoteAt = quoteTimestampSeconds && quoteTimestampSeconds > 0
    ? new Date(quoteTimestampSeconds * 1000)
    : null;
  const ageHours = quoteAt
    ? (generatedAt.getTime() - quoteAt.getTime()) / 3_600_000
    : null;
  const staleAfterHours = Number(options.staleAfterHours ?? 72);
  const currency = companyCurrency(company);
  const symbol = String(company.primaryListing?.symbol || '').trim().toUpperCase();
  const defaultIdentityEvidence = {
    verificationMode: 'CANONICAL_LISTING_BINDING',
    requestedSymbol: symbol || null,
    ticker: symbol || null,
    currency,
    verified: Boolean(symbol && currency),
  };
  const identityEvidence = options.identityEvidence || defaultIdentityEvidence;
  const quoteIdentityVerified = identityEvidence?.verified === true;
  const usable = currentPrice !== null
    && currentPrice > 0
    && previousClose !== null
    && previousClose > 0
    && Boolean(quoteAt)
    && Boolean(currency)
    && quoteIdentityVerified;
  const dailyChange = numeric(payload?.d) ?? (usable ? currentPrice - previousClose : null);
  const dailyChangePct = numeric(payload?.dp) ?? (
    usable && previousClose !== 0 ? ((currentPrice - previousClose) / previousClose) * 100 : null
  );

  return {
    format: 'investor-control-market-snapshot',
    version: 1,
    companyId: company.companyId,
    companyName: company.displayName || company.legalName,
    listing: company.primaryListing,
    symbol: company.primaryListing?.symbol || null,
    currency,
    source: 'Finnhub Quote API',
    sourceUrl: `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(company.primaryListing?.symbol || '')}`,
    sourceQuality: 'PRIMARY_LICENSED',
    generatedAt: generatedAt.toISOString(),
    quoteAt: quoteAt ? quoteAt.toISOString() : null,
    quoteTimestampVerified: Boolean(quoteAt),
    quoteIdentityVerified,
    identityEvidence,
    ageHours: ageHours === null ? null : round(ageHours, 2),
    stale: ageHours === null ? true : ageHours > staleAfterHours,
    usable: Boolean(usable),
    currentPrice,
    previousClose,
    open: numeric(payload?.o),
    high: numeric(payload?.h),
    low: numeric(payload?.l),
    dailyChange: round(dailyChange),
    dailyChangePct: round(dailyChangePct, 2),
    liquidityMetricsReady: false,
    relativeStrengthMetricsReady: false,
    marketMetricsReady: false,
  };
}

export async function fetchFinnhubQuote(company, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Finnhub quote adapter requires fetch');

  const token = String(options.token || '').trim();
  if (!token) {
    return {
      snapshot: null,
      diagnostics: [{ code: 'FINNHUB_TOKEN_MISSING', companyId: company.companyId }],
    };
  }

  if (company.country !== 'US') {
    return {
      snapshot: null,
      diagnostics: [{ code: 'FINNHUB_QUOTE_UNSUPPORTED_MARKET', companyId: company.companyId }],
    };
  }

  const symbol = String(company.primaryListing?.symbol || '').trim().toUpperCase();
  if (!symbol) {
    return {
      snapshot: null,
      diagnostics: [{ code: 'MARKET_SYMBOL_MISSING', companyId: company.companyId }],
    };
  }

  let currency = companyCurrency(company);
  let identityEvidence = null;
  if (!currency) {
    try {
      identityEvidence = await fetchFinnhubCompanyProfile(symbol, {
        fetchImpl,
        token,
        generatedAt: options.generatedAt,
      });
    } catch (error) {
      return {
        snapshot: null,
        diagnostics: [{
          code: 'FINNHUB_IDENTITY_LOOKUP_FAILED',
          companyId: company.companyId,
          symbol,
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }

    if (!identityEvidence.tickerMatches) {
      return {
        snapshot: null,
        diagnostics: [{
          code: 'FINNHUB_IDENTITY_MISMATCH',
          companyId: company.companyId,
          symbol,
          providerTicker: identityEvidence.ticker,
        }],
      };
    }
    if (!identityEvidence.currency) {
      return {
        snapshot: null,
        diagnostics: [{ code: 'FINNHUB_CURRENCY_UNVERIFIED', companyId: company.companyId, symbol }],
      };
    }
    currency = identityEvidence.currency;
  }

  const effectiveCompany = {
    ...company,
    currency,
  };
  if (!identityEvidence) {
    identityEvidence = {
      verificationMode: 'CANONICAL_LISTING_BINDING',
      requestedSymbol: symbol,
      ticker: symbol,
      currency,
      verified: true,
    };
  }

  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'X-Finnhub-Token': token,
    },
  });
  if (!response.ok) throw new Error(`Finnhub quote request failed: ${response.status}`);

  const payload = await response.json();
  const snapshot = normalizeFinnhubQuote(payload, effectiveCompany, {
    generatedAt: options.generatedAt,
    staleAfterHours: options.staleAfterHours,
    identityEvidence,
  });

  return {
    snapshot,
    diagnostics: snapshot.usable
      ? snapshot.stale
        ? [{ code: 'MARKET_QUOTE_STALE', companyId: company.companyId, ageHours: snapshot.ageHours }]
        : []
      : [{ code: 'MARKET_QUOTE_INVALID', companyId: company.companyId }],
  };
}
