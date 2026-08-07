function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&euro;|&#8364;/gi, ' € ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLocaleNumber(value) {
  const raw = String(value ?? '').trim().replace(/\s/g, '');
  if (!raw) return null;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const number = Number(normalized.replace(/[^0-9+\-.]/g, ''));
  return Number.isFinite(number) ? number : null;
}

function numberAfterLabel(text, labels, options = {}) {
  const lower = text.toLowerCase();
  for (const label of labels) {
    const index = lower.indexOf(String(label).toLowerCase());
    if (index < 0) continue;
    const slice = text.slice(index + String(label).length, index + String(label).length + Number(options.window || 220));
    const pattern = options.integer
      ? /([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+)/
      : /([+-]?[0-9]{1,5}(?:[.,][0-9]{1,6}))/;
    const match = slice.match(pattern);
    const value = match ? parseLocaleNumber(match[1]) : null;
    if (value !== null) return value;
  }
  return null;
}

export function normalizeEuronextAthensQuote(html, company, options = {}) {
  const generatedAt = new Date(options.generatedAt || Date.now());
  const text = decodeHtml(html);
  const currentPrice = numberAfterLabel(text, [
    'Last Traded Price',
    'Τελευταία Τιμή Διαπραγμάτευσης',
  ]);
  const previousClose = numberAfterLabel(text, [
    'Previous Close',
    'Προηγούμενο Κλείσιμο',
  ]);
  const open = numberAfterLabel(text, ['Opening Price', 'Open Price', 'Τιμή Ανοίγματος']);
  const high = numberAfterLabel(text, ['Daily High Price', 'Day High', 'Ημερήσια Υψηλή Τιμή']);
  const low = numberAfterLabel(text, ['Daily Low Price', 'Day Low', 'Ημερήσια Χαμηλή Τιμή']);
  const volume = numberAfterLabel(text, ['Total Volume', 'Συνολικός Όγκος'], { integer: true });
  const usable = currentPrice !== null && currentPrice > 0;
  const dailyChange = usable && previousClose !== null ? currentPrice - previousClose : null;
  const dailyChangePct = usable && previousClose !== null && previousClose !== 0
    ? ((currentPrice - previousClose) / previousClose) * 100
    : null;
  const symbol = company.primaryListing?.symbol || null;
  const sourceUrl = options.sourceUrl || `https://athens.euronext.com/en/market-data/instruments/stocks/${encodeURIComponent(symbol || '')}`;

  return {
    format: 'investor-control-market-snapshot',
    version: 2,
    companyId: company.companyId,
    companyName: company.displayName || company.legalName,
    listing: company.primaryListing,
    symbol,
    currency: company.currency || company.listings?.[0]?.currency || 'EUR',
    source: 'Euronext Athens delayed market data',
    sourceUrl,
    sourceQuality: 'OFFICIAL_DELAYED',
    advertisedDelayMinutes: 15,
    generatedAt: generatedAt.toISOString(),
    quoteAt: generatedAt.toISOString(),
    quoteTimestampVerified: false,
    timestampMeaning: 'RETRIEVAL_TIME_FOR_OFFICIAL_DELAYED_VALUE',
    ageHours: 0,
    stale: !usable,
    usable,
    currentPrice,
    previousClose,
    open,
    high,
    low,
    volume,
    dailyChange: round(dailyChange),
    dailyChangePct: round(dailyChangePct, 2),
    liquidityMetricsReady: false,
    relativeStrengthMetricsReady: false,
    marketMetricsReady: false,
  };
}

export async function fetchEuronextAthensQuote(company, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Euronext Athens quote adapter requires fetch');
  const symbol = String(company.primaryListing?.symbol || '').trim();
  if (!symbol) return { snapshot: null, diagnostics: [{ code: 'MARKET_SYMBOL_MISSING', companyId: company.companyId }] };

  const baseUrl = `https://athens.euronext.com/en/market-data/instruments/stocks/${encodeURIComponent(symbol)}`;
  const configuredUrl = company.marketData?.euronextInstrumentUrl || baseUrl;
  const urls = [...new Set([configuredUrl, `${baseUrl}/related`, baseUrl])];
  const diagnostics = [];
  let lastSnapshot = null;

  for (const url of urls) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Cache-Control': 'no-cache',
          'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/1.0',
        },
      });
    } catch (error) {
      diagnostics.push({
        code: 'EURONEXT_ATHENS_QUOTE_FETCH_FAILED',
        companyId: company.companyId,
        endpoint: new URL(url).pathname,
        errorClass: 'NETWORK_OR_FETCH_ERROR',
      });
      continue;
    }

    if (!response.ok) {
      diagnostics.push({
        code: 'EURONEXT_ATHENS_QUOTE_HTTP_ERROR',
        companyId: company.companyId,
        status: response.status,
        endpoint: new URL(url).pathname,
      });
      continue;
    }

    const html = await response.text();
    const snapshot = normalizeEuronextAthensQuote(html, company, {
      generatedAt: options.generatedAt,
      sourceUrl: url,
    });
    lastSnapshot = snapshot;
    if (snapshot.usable) {
      if (snapshot.previousClose === null) diagnostics.push({ code: 'EURONEXT_ATHENS_PREVIOUS_CLOSE_MISSING', companyId: company.companyId });
      return { snapshot, diagnostics };
    }
    diagnostics.push({
      code: 'EURONEXT_ATHENS_QUOTE_NOT_PARSED',
      companyId: company.companyId,
      endpoint: new URL(url).pathname,
    });
  }

  return {
    snapshot: lastSnapshot,
    diagnostics: diagnostics.length
      ? diagnostics
      : [{ code: 'EURONEXT_ATHENS_QUOTE_NOT_PARSED', companyId: company.companyId }],
  };
}
