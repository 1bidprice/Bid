const TWELVE_DATA_HOST = 'api.twelvedata.com';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestampSeconds(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : /Z$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`;
  const millis = Date.parse(normalized);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : null;
}

function sanitizedSourceUrl({ symbol, interval, outputsize, micCode }) {
  const params = new URLSearchParams({
    symbol,
    interval,
    outputsize: String(outputsize),
    order: 'asc',
  });
  if (micCode) params.set('mic_code', micCode);
  return `https://${TWELVE_DATA_HOST}/time_series?${params.toString()}`;
}

function safeMessage(value, apiKey) {
  let text = String(value || '').slice(0, 400);
  if (apiKey) text = text.split(apiKey).join('[REDACTED]');
  return text.slice(0, 240) || null;
}

export function normalizeTwelveDataTimeSeries(payload, options = {}) {
  const generatedAt = new Date(options.generatedAt || Date.now()).toISOString();
  const providerSymbol = String(options.providerSymbol || payload?.meta?.symbol || '').trim() || null;
  const base = {
    format: 'investor-control-market-series',
    version: 2,
    symbol: options.symbol || providerSymbol,
    providerSymbol,
    currency: options.currency || payload?.meta?.currency || null,
    exchangeName: payload?.meta?.exchange || null,
    mic: payload?.meta?.mic_code || options.micCode || null,
    instrumentType: payload?.meta?.type || null,
    source: 'Twelve Data Time Series',
    sourceUrl: options.sourceUrl || null,
    generatedAt,
    sourceQuality: 'SECONDARY_UNVALIDATED',
    adjustment: 'RAW_CLOSE',
    researchOnly: true,
    decisionEligible: false,
    executionEligible: false,
  };

  if (payload?.status === 'error' || payload?.code || !Array.isArray(payload?.values)) {
    return {
      ...base,
      candles: [],
      usable: false,
      status: payload?.code ? `provider_error_${payload.code}` : 'no_data',
    };
  }

  const byTimestamp = new Map();
  for (const value of payload.values) {
    const timestamp = timestampSeconds(value?.datetime);
    const close = finite(value?.close);
    if (timestamp === null || close === null || close <= 0) continue;
    byTimestamp.set(timestamp, {
      timestamp,
      close,
      rawClose: close,
      adjustedClose: null,
      open: finite(value?.open),
      high: finite(value?.high),
      low: finite(value?.low),
      volume: finite(value?.volume),
    });
  }
  const candles = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  return {
    ...base,
    candles,
    usable: candles.length > 0,
    status: candles.length ? 'ok' : 'no_data',
  };
}

export async function fetchTwelveDataTimeSeries(symbolInput, options = {}) {
  const apiKey = String(options.apiKey || '').trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const providerSymbol = String(symbolInput || '').trim();
  const interval = String(options.interval || '1day');
  const outputsize = Math.min(5000, Math.max(1, Math.floor(Number(options.outputsize || 160))));
  const micCode = String(options.micCode || '').trim() || null;

  if (!providerSymbol) {
    return { series: null, diagnostics: [{ code: 'TWELVE_DATA_SYMBOL_MISSING' }] };
  }
  if (!apiKey) {
    return { series: null, diagnostics: [{ code: 'TWELVE_DATA_API_KEY_MISSING' }] };
  }
  if (typeof fetchImpl !== 'function') throw new Error('Twelve Data time-series adapter requires fetch');

  const params = new URLSearchParams({
    symbol: providerSymbol,
    interval,
    outputsize: String(outputsize),
    order: 'asc',
    apikey: apiKey,
  });
  if (micCode) params.set('mic_code', micCode);
  const requestUrl = `https://${TWELVE_DATA_HOST}/time_series?${params.toString()}`;
  const sourceUrl = sanitizedSourceUrl({ symbol: providerSymbol, interval, outputsize, micCode });

  try {
    const response = await fetchImpl(requestUrl, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/1.0',
      },
    });
    if (!response.ok) {
      return {
        series: null,
        diagnostics: [{
          code: response.status === 429 ? 'TWELVE_DATA_RATE_LIMITED' : 'TWELVE_DATA_REQUEST_FAILED',
          status: response.status,
          providerSymbol,
        }],
      };
    }
    const payload = await response.json();
    if (payload?.status === 'error' || payload?.code) {
      return {
        series: null,
        diagnostics: [{
          code: Number(payload?.code) === 429 ? 'TWELVE_DATA_RATE_LIMITED' : 'TWELVE_DATA_PROVIDER_ERROR',
          status: finite(payload?.code),
          providerSymbol,
          message: safeMessage(payload?.message, apiKey),
        }],
      };
    }
    const series = normalizeTwelveDataTimeSeries(payload, {
      symbol: options.symbol || providerSymbol,
      providerSymbol,
      currency: options.currency,
      generatedAt: options.generatedAt,
      micCode,
      sourceUrl,
    });
    if (!series.usable) return { series: null, diagnostics: [{ code: 'TWELVE_DATA_NO_USABLE_HISTORY', providerSymbol }] };
    return {
      series,
      diagnostics: [{ code: 'INDEPENDENT_HISTORY_OVERLAP_WITNESS_AVAILABLE', provider: 'Twelve Data Time Series', providerSymbol }],
    };
  } catch (error) {
    return {
      series: null,
      diagnostics: [{
        code: 'TWELVE_DATA_REQUEST_FAILED',
        providerSymbol,
        message: safeMessage(error instanceof Error ? error.message : String(error), apiKey),
      }],
    };
  }
}
