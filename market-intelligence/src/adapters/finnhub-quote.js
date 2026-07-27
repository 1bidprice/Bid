function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
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
  const usable = currentPrice !== null && currentPrice > 0 && previousClose !== null && previousClose > 0 && quoteAt;
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
    currency: company.currency || company.listings?.[0]?.currency || null,
    source: 'Finnhub Quote API',
    sourceUrl: `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(company.primaryListing?.symbol || '')}`,
    generatedAt: generatedAt.toISOString(),
    quoteAt: quoteAt ? quoteAt.toISOString() : null,
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

  const symbol = String(company.primaryListing?.symbol || '').trim();
  if (!symbol) {
    return {
      snapshot: null,
      diagnostics: [{ code: 'MARKET_SYMBOL_MISSING', companyId: company.companyId }],
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
  const snapshot = normalizeFinnhubQuote(payload, company, {
    generatedAt: options.generatedAt,
    staleAfterHours: options.staleAfterHours,
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
