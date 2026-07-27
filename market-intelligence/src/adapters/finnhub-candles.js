function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeFinnhubCandles(payload, options = {}) {
  if (payload?.s !== 'ok') {
    return {
      format: 'investor-control-market-series',
      version: 1,
      symbol: options.symbol || null,
      currency: options.currency || null,
      source: 'Finnhub Stock Candles',
      sourceUrl: options.sourceUrl || null,
      generatedAt: new Date(options.generatedAt || Date.now()).toISOString(),
      candles: [],
      usable: false,
      status: payload?.s || 'no_data',
    };
  }

  const timestamps = Array.isArray(payload?.t) ? payload.t : [];
  const closes = Array.isArray(payload?.c) ? payload.c : [];
  const opens = Array.isArray(payload?.o) ? payload.o : [];
  const highs = Array.isArray(payload?.h) ? payload.h : [];
  const lows = Array.isArray(payload?.l) ? payload.l : [];
  const volumes = Array.isArray(payload?.v) ? payload.v : [];
  const length = Math.min(timestamps.length, closes.length);
  const candles = [];

  for (let index = 0; index < length; index += 1) {
    const timestamp = finite(timestamps[index]);
    const close = finite(closes[index]);
    if (timestamp === null || close === null || close <= 0) continue;
    candles.push({
      timestamp,
      close,
      open: finite(opens[index]),
      high: finite(highs[index]),
      low: finite(lows[index]),
      volume: finite(volumes[index]),
    });
  }

  candles.sort((a, b) => a.timestamp - b.timestamp);
  return {
    format: 'investor-control-market-series',
    version: 1,
    symbol: options.symbol || null,
    currency: options.currency || null,
    source: 'Finnhub Stock Candles',
    sourceUrl: options.sourceUrl || null,
    generatedAt: new Date(options.generatedAt || Date.now()).toISOString(),
    candles,
    usable: candles.length > 0,
    status: candles.length ? 'ok' : 'no_data',
  };
}

export async function fetchhubCandlesForSymbol(symbolInput, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Finnhub candles adapter requires fetch');

  const token = String(options.token || '').trim();
  const symbol = String(symbolInput || '').trim();
  if (!token) {
    return { series: null, diagnostics: [{ code: 'FINNHUB_TOKEN_MISSING', symbol }] };
  }
  if (!symbol) {
    return { series: null, diagnostics: [{ code: 'MARKET_SYMBOL_MISSING' }] };
  }

  const nowSeconds = Math.floor(new Date(options.generatedAt || Date.now()).getTime() / 1000);
  const fromSeconds = Number(options.fromSeconds || nowSeconds - (Number(options.lookbackDays || 420) * 86_400));
  const resolution = options.resolution || 'D';
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(resolution)}&from=${Math.floor(fromSeconds)}&to=${nowSeconds}`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'X-Finnhub-Token': token,
    },
  });

  if (!response.ok) {
    const diagnostic = response.status === 403
      ? 'FINNHUB_CANDLES_PREMIUM_REQUIRED'
      : response.status === 429
        ? 'FINNHUB_RATE_LIMITED'
        : 'FINNHUB_CANDLES_HTTP_ERROR';
    return {
      series: null,
      diagnostics: [{ code: diagnostic, symbol, status: response.status }],
    };
  }

  const payload = await response.json();
  const series = normalizeFinnhubCandles(payload, {
    companyId: options.companyId,
    symbol,
    currency: options.currency,
    sourceUrl: url,
    generatedAt: options.generatedAt,
    resolution,
  });

  return {
    series,
    diagnostics: series.usable
      ? []
      : [{ code: payload?.s === 'no_data' ? 'MARKET_HISTORY_NO_DATA' : 'MARKET_HISTORY_INVALID', symbol }],
  };
}

export function fetchFinnhubCompanyCandles(company, options = {}) {
  if (company.country !== 'US') {
    return Promise.resolve({
      series: null,
      diagnostics: [{ code: 'FINNHUB_CANDLES_UNSUPPORTED_MARKET', companyId: company.companyId }],
    });
  }
  return fetchFinnhubCandlesForSymbol(company.primaryListing?.symbol, {
    ...options,
    companyId: company.companyId,
    currency: company.currency || company.listings?.[0]?.currency || null,
  });
}
