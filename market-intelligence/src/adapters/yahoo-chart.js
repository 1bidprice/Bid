const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const ATHEX_BENCHMARK_PROVIDER_SYMBOLS = ['GD.AT', 'ATG.AT', '^ATG'];

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeTimestamp(value) {
  const number = finite(value);
  if (number === null || number <= 0) return null;
  return number > 10_000_000_000 ? Math.floor(number / 1000) : Math.floor(number);
}

function marketSessionIncomplete(meta, generatedAt) {
  const nowSeconds = Math.floor(new Date(generatedAt || Date.now()).getTime() / 1000);
  const regular = meta?.currentTradingPeriod?.regular;
  const start = finite(regular?.start);
  const end = finite(regular?.end);
  return start !== null && end !== null && nowSeconds >= start && nowSeconds < end;
}

export function normalizeYahooChart(payload, options = {}) {
  const result = payload?.chart?.result?.[0] || null;
  const providerError = payload?.chart?.error || null;
  const generatedAt = new Date(options.generatedAt || Date.now()).toISOString();
  const providerSymbol = options.providerSymbol || result?.meta?.symbol || null;
  const base = {
    format: 'investor-control-market-series',
    version: 2,
    symbol: options.symbol || providerSymbol,
    providerSymbol,
    currency: options.currency || result?.meta?.currency || null,
    source: 'Yahoo Finance Chart',
    sourceUrl: options.sourceUrl || null,
    generatedAt,
    sourceQuality: 'SECONDARY_VALIDATED',
    adjustment: 'ADJUSTED_CLOSE_WHEN_AVAILABLE',
  };

  if (!result || providerError) {
    return {
      ...base,
      candles: [],
      usable: false,
      status: providerError?.code || 'no_data',
    };
  }

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const opens = Array.isArray(quote.open) ? quote.open : [];
  const highs = Array.isArray(quote.high) ? quote.high : [];
  const lows = Array.isArray(quote.low) ? quote.low : [];
  const volumes = Array.isArray(quote.volume) ? quote.volume : [];
  const candles = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = normalizeTimestamp(timestamps[index]);
    const rawClose = finite(closes[index]);
    const adjustedClose = finite(adjusted[index]);
    const close = adjustedClose !== null && adjustedClose > 0 ? adjustedClose : rawClose;
    if (timestamp === null || close === null || close <= 0) continue;
    candles.push({
      timestamp,
      close,
      rawClose: rawClose !== null && rawClose > 0 ? rawClose : close,
      adjustedClose: adjustedClose !== null && adjustedClose > 0 ? adjustedClose : null,
      open: finite(opens[index]),
      high: finite(highs[index]),
      low: finite(lows[index]),
      volume: finite(volumes[index]),
    });
  }

  candles.sort((a, b) => a.timestamp - b.timestamp);
  const excludeIncomplete = options.excludeIncompleteSession !== false;
  if (excludeIncomplete && candles.length && marketSessionIncomplete(result.meta, generatedAt)) {
    const regularStart = finite(result.meta?.currentTradingPeriod?.regular?.start);
    if (regularStart !== null && candles.at(-1).timestamp >= regularStart) candles.pop();
  }

  return {
    ...base,
    exchangeName: result.meta?.exchangeName || null,
    exchangeTimezoneName: result.meta?.exchangeTimezoneName || null,
    instrumentType: result.meta?.instrumentType || null,
    regularMarketPrice: finite(result.meta?.regularMarketPrice),
    previousClose: finite(result.meta?.previousClose ?? result.meta?.chartPreviousClose),
    regularMarketTime: normalizeTimestamp(result.meta?.regularMarketTime),
    currentTradingPeriod: result.meta?.currentTradingPeriod || null,
    candles,
    usable: candles.length > 0,
    status: candles.length ? 'ok' : 'no_data',
  };
}

async function fetchOne(host, providerSymbol, options) {
  const range = options.range || '2y';
  const interval = options.interval || '1d';
  const url = `https://${host}/v8/finance/chart/${encodeURIComponent(providerSymbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&events=div%2Csplits&includePrePost=${options.includePrePost === true ? 'true' : 'false'}`;
  const response = await options.fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/1.0',
    },
  });
  if (!response.ok) {
    const error = new Error(`Yahoo chart request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  const series = normalizeYahooChart(payload, {
    symbol: options.symbol,
    providerSymbol,
    currency: options.currency,
    generatedAt: options.generatedAt,
    sourceUrl: url,
    excludeIncompleteSession: options.excludeIncompleteSession,
  });
  if (!series.usable) throw new Error(`Yahoo chart returned no usable data for ${providerSymbol}`);
  const minimumObservationCount = Math.max(1, Math.floor(Number(options.minimumObservationCount || 1)));
  if (series.candles.length < minimumObservationCount) {
    const error = new Error(`Yahoo chart history too shallow for ${providerSymbol}: ${series.candles.length}/${minimumObservationCount}`);
    error.code = 'YAHOO_HISTORY_TOO_SHALLOW';
    error.observationCount = series.candles.length;
    error.minimumObservationCount = minimumObservationCount;
    throw error;
  }
  return series;
}

export async function fetchYahooChartSeries(symbolInput, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Yahoo chart adapter requires fetch');
  const canonicalFallbacks = options.symbol === 'ATHEX_BENCHMARK'
    ? ATHEX_BENCHMARK_PROVIDER_SYMBOLS
    : [];
  const providerSymbols = [...new Set(
    [symbolInput, ...(options.alternateSymbols || []), ...canonicalFallbacks]
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
  if (!providerSymbols.length) {
    return { series: null, diagnostics: [{ code: 'YAHOO_MARKET_SYMBOL_MISSING' }] };
  }

  const diagnostics = [];
  for (const providerSymbol of providerSymbols) {
    for (const host of YAHOO_HOSTS) {
      try {
        const series = await fetchOne(host, providerSymbol, {
          ...options,
          fetchImpl,
          symbol: options.symbol || String(symbolInput || '').trim() || providerSymbol,
        });
        return {
          series,
          diagnostics: [
            ...diagnostics,
            { code: 'SECONDARY_MARKET_DATA_USED', provider: 'Yahoo Finance Chart', providerSymbol },
          ],
        };
      } catch (error) {
        const shallow = error?.code === 'YAHOO_HISTORY_TOO_SHALLOW';
        diagnostics.push({
          code: shallow
            ? 'YAHOO_MARKET_HISTORY_TOO_SHALLOW'
            : error?.status === 429
              ? 'YAHOO_MARKET_RATE_LIMITED'
              : 'YAHOO_MARKET_REQUEST_FAILED',
          providerSymbol,
          host,
          status: error?.status || null,
          ...(shallow ? {
            observationCount: error.observationCount,
            minimumObservationCount: error.minimumObservationCount,
          } : {}),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { series: null, diagnostics };
}
