import { fetchFinnhubQuote } from './adapters/finnhub-quote.js';
import { fetchFinnhubCandlesForSymbol, fetchFinnhubCompanyCandles } from './adapters/finnhub-candles.js';
import { fetchYahooChartSeries } from './adapters/yahoo-chart.js';
import { fetchEuronextAthensQuote } from './adapters/euronext-athens-quote.js';
import { calculateMarketMetrics } from './market-metrics.js';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function resolveYahooHistoryRange(options = {}) {
  const explicit = String(options.range || '').trim();
  if (explicit) return explicit;
  const lookbackDays = Number(options.lookbackDays);
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 730) return '2y';
  if (lookbackDays <= 1825) return '5y';
  if (lookbackDays <= 3650) return '10y';
  return 'max';
}

function isAthensListing(company) {
  return company?.primaryListing?.mic === 'XATH' || /Athens/i.test(String(company?.primaryListing?.exchange || ''));
}

function dateKey(timestampSeconds) {
  const timestamp = finite(timestampSeconds);
  if (timestamp === null) return null;
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function companyYahooSymbols(company) {
  const configured = Array.isArray(company?.marketData?.yahooSymbols) ? company.marketData.yahooSymbols : [];
  const symbol = String(company?.primaryListing?.symbol || '').trim();
  if (configured.length) return configured;
  if (!symbol) return [];
  return isAthensListing(company) ? [`${symbol}.AT`] : [symbol];
}

function benchmarkYahooSymbols(company) {
  const configured = Array.isArray(company?.marketData?.benchmarkYahooSymbols)
    ? company.marketData.benchmarkYahooSymbols
    : [];
  if (configured.length) return configured;
  return isAthensListing(company) ? ['GD.AT', 'ATG.AT', '^ATG'] : ['SPY'];
}

function snapshotFromYahooSeries(company, series, generatedAt) {
  const latest = series?.candles?.at(-1) || null;
  const currentPrice = finite(series?.regularMarketPrice) ?? finite(latest?.rawClose) ?? finite(latest?.close);
  const previousClose = finite(series?.previousClose);
  const quoteTimestamp = finite(series?.regularMarketTime) ?? finite(latest?.timestamp);
  const quoteAt = quoteTimestamp === null ? null : new Date(quoteTimestamp * 1000);
  const generated = new Date(generatedAt || Date.now());
  const ageHours = quoteAt ? Math.max(0, (generated.getTime() - quoteAt.getTime()) / 3_600_000) : null;
  const usable = currentPrice !== null && currentPrice > 0 && quoteAt !== null;
  const dailyChange = usable && previousClose !== null ? currentPrice - previousClose : null;
  const dailyChangePct = usable && previousClose !== null && previousClose !== 0
    ? ((currentPrice - previousClose) / previousClose) * 100
    : null;
  return {
    format: 'investor-control-market-snapshot',
    version: 2,
    companyId: company.companyId,
    companyName: company.displayName || company.legalName,
    listing: company.primaryListing,
    symbol: company.primaryListing?.symbol || null,
    currency: company.currency || series?.currency || null,
    source: 'Yahoo Finance Chart fallback',
    sourceUrl: series?.sourceUrl || null,
    sourceQuality: 'SECONDARY_FALLBACK',
    generatedAt: generated.toISOString(),
    quoteAt: quoteAt?.toISOString() || null,
    quoteTimestampVerified: true,
    ageHours: ageHours === null ? null : round(ageHours, 2),
    stale: ageHours === null || ageHours > 96,
    usable: Boolean(usable),
    currentPrice,
    previousClose,
    open: finite(latest?.open),
    high: finite(latest?.high),
    low: finite(latest?.low),
    dailyChange: round(dailyChange),
    dailyChangePct: round(dailyChangePct, 2),
    liquidityMetricsReady: false,
    relativeStrengthMetricsReady: false,
    marketMetricsReady: false,
  };
}

export async function fetchProfessionalMarketSnapshot(company, options = {}) {
  const diagnostics = [];
  if (isAthensListing(company)) {
    return fetchEuronextAthensQuote(company, options);
  }

  if (company.country === 'US') {
    try {
      const primary = await fetchFinnhubQuote(company, options);
      diagnostics.push(...(primary.diagnostics || []));
      if (primary.snapshot?.usable) return { snapshot: primary.snapshot, diagnostics };
    } catch (error) {
      diagnostics.push({
        code: 'FINNHUB_QUOTE_FAILED',
        companyId: company.companyId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const yahooSymbols = companyYahooSymbols(company);
  const fallback = await fetchYahooChartSeries(yahooSymbols[0], {
    ...options,
    symbol: company.primaryListing?.symbol,
    alternateSymbols: yahooSymbols.slice(1),
    currency: company.currency || company.listings?.[0]?.currency || null,
    range: '5d',
    interval: '5m',
    includePrePost: true,
    excludeIncompleteSession: false,
  });
  diagnostics.push(...(fallback.diagnostics || []));
  const snapshot = fallback.series ? snapshotFromYahooSeries(company, fallback.series, options.generatedAt) : null;
  return {
    snapshot,
    diagnostics: snapshot?.usable
      ? [...diagnostics, { code: 'MARKET_QUOTE_FALLBACK_USED', companyId: company.companyId }]
      : [...diagnostics, { code: 'MARKET_QUOTE_UNAVAILABLE', companyId: company.companyId }],
  };
}

function validateHistoryAgainstSnapshot(series, snapshot, company, options = {}) {
  const latest = series?.candles?.at(-1) || null;
  const rawClose = finite(latest?.rawClose) ?? finite(latest?.close);
  const currentPrice = finite(snapshot?.currentPrice);
  const previousClose = finite(snapshot?.previousClose);
  if (!latest || rawClose === null || !snapshot?.usable || currentPrice === null) {
    return { ready: false, reference: null, deviationPct: null, reason: 'CURRENT_QUOTE_OR_HISTORY_MISSING' };
  }

  const quoteTimestamp = new Date(snapshot.quoteAt || snapshot.generatedAt || 0).getTime();
  const quoteDate = Number.isFinite(quoteTimestamp) ? new Date(quoteTimestamp).toISOString().slice(0, 10) : null;
  const latestDate = dateKey(latest.timestamp);
  const reference = latestDate && quoteDate && latestDate === quoteDate
    ? currentPrice
    : previousClose ?? currentPrice;
  const deviationPct = reference > 0 ? Math.abs((rawClose / reference) - 1) * 100 : null;
  const tolerancePct = Number(options.historyCrossCheckTolerancePct ?? (isAthensListing(company) ? 8 : 5));
  return {
    ready: deviationPct !== null && deviationPct <= tolerancePct,
    reference,
    rawClose,
    deviationPct: round(deviationPct, 2),
    tolerancePct,
    latestDate,
    quoteDate,
    reason: deviationPct !== null && deviationPct <= tolerancePct ? 'MATCHED' : 'PRICE_DEVIATION_EXCEEDED',
  };
}

async function fetchCompanyHistorySeries(company, options, diagnostics) {
  if (company.country === 'US' && String(options.token || '').trim()) {
    const primary = await fetchFinnhubCompanyCandles(company, options);
    diagnostics.push(...(primary.diagnostics || []));
    if (primary.series?.usable) {
      return {
        ...primary.series,
        sourceQuality: 'PRIMARY_LICENSED',
        providerSymbol: company.primaryListing?.symbol || null,
      };
    }
  }

  const yahooSymbols = companyYahooSymbols(company);
  const fallback = await fetchYahooChartSeries(yahooSymbols[0], {
    ...options,
    symbol: company.primaryListing?.symbol,
    alternateSymbols: yahooSymbols.slice(1),
    currency: company.currency || company.listings?.[0]?.currency || null,
    range: resolveYahooHistoryRange(options),
    interval: '1d',
    excludeIncompleteSession: true,
  });
  diagnostics.push(...(fallback.diagnostics || []));
  return fallback.series || null;
}

function benchmarkMinimumObservationCount(options = {}) {
  const configured = Number(options.benchmarkMinimumObservationCount);
  if (Number.isFinite(configured) && configured > 0) return Math.max(1, Math.floor(configured));
  const range = resolveYahooHistoryRange(options);
  if (range === '5y') return 1_000;
  if (range === '10y') return 2_000;
  if (range === 'max') return 1_000;
  return 1;
}

function benchmarkSeriesMeetsDepth(series, minimumObservationCount) {
  return series?.usable === true
    && Array.isArray(series.candles)
    && series.candles.length >= minimumObservationCount;
}

function benchmarkRetryable(diagnostics = []) {
  return diagnostics.some((item) => {
    if (item?.code === 'YAHOO_MARKET_HISTORY_TOO_SHALLOW' || item?.code === 'YAHOO_MARKET_RATE_LIMITED') return true;
    if (item?.code !== 'YAHOO_MARKET_REQUEST_FAILED') return false;
    const status = Number(item?.status);
    return !Number.isFinite(status) || status === 408 || status === 425 || status === 429 || status >= 500;
  });
}

function benchmarkMaximumAttempts(options = {}) {
  const configured = Number(options.benchmarkFetchMaxAttempts);
  if (Number.isFinite(configured)) return Math.max(1, Math.min(3, Math.floor(configured)));
  return benchmarkMinimumObservationCount(options) > 1 ? 2 : 1;
}

async function waitForBenchmarkRetry(options, attempt) {
  const configured = Number(options.benchmarkRetryDelayMs);
  const delayMs = Number.isFinite(configured) ? Math.max(0, Math.min(5_000, configured)) : 500;
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs * Math.max(1, attempt)));
}

async function fetchBenchmarkSeries(company, options, diagnostics) {
  const candidates = benchmarkYahooSymbols(company);
  const range = resolveYahooHistoryRange(options);
  const minimumObservationCount = benchmarkMinimumObservationCount(options);
  const cacheKey = `YAHOO:${candidates.join('|')}:${range}`;
  const retryStateKey = `${cacheKey}:DEPTH:${minimumObservationCount}:STATE`;
  const cached = options.benchmarkCache?.get(cacheKey) || null;
  if (benchmarkSeriesMeetsDepth(cached, minimumObservationCount)) {
    diagnostics.push({
      code: 'MARKET_BENCHMARK_CACHE_HIT',
      companyId: company.companyId,
      providerSymbol: cached.providerSymbol || cached.symbol || null,
      observationCount: cached.candles.length,
      minimumObservationCount,
    });
    return cached;
  }
  if (cached && options.benchmarkCache?.delete) {
    options.benchmarkCache.delete(cacheKey);
    diagnostics.push({
      code: 'MARKET_BENCHMARK_CACHE_REJECTED_DEPTH',
      companyId: company.companyId,
      observationCount: Array.isArray(cached.candles) ? cached.candles.length : 0,
      minimumObservationCount,
    });
  }
  const priorState = options.benchmarkCache?.get(retryStateKey) || null;
  if (priorState?.status === 'EXHAUSTED') {
    diagnostics.push({
      code: 'MARKET_BENCHMARK_RETRY_EXHAUSTED_CACHED',
      companyId: company.companyId,
      attempts: priorState.attempts,
      minimumObservationCount,
    });
    return null;
  }

  if (company.country === 'US' && String(options.token || '').trim()) {
    const finnhub = await fetchFinnhubCandlesForSymbol('SPY', {
      ...options,
      currency: 'USD',
    });
    diagnostics.push(...(finnhub.diagnostics || []).map((item) => ({ ...item, benchmark: true })));
    if (benchmarkSeriesMeetsDepth(finnhub.series, minimumObservationCount)) {
      const series = { ...finnhub.series, sourceQuality: 'PRIMARY_LICENSED', providerSymbol: 'SPY' };
      options.benchmarkCache?.set(cacheKey, series);
      options.benchmarkCache?.set(retryStateKey, { status: 'READY', attempts: 1 });
      return series;
    }
    if (finnhub.series?.usable) {
      diagnostics.push({
        code: 'MARKET_BENCHMARK_HISTORY_TOO_SHALLOW',
        companyId: company.companyId,
        provider: 'Finnhub',
        providerSymbol: 'SPY',
        observationCount: Array.isArray(finnhub.series.candles) ? finnhub.series.candles.length : 0,
        minimumObservationCount,
      });
    }
  }

  const maximumAttempts = benchmarkMaximumAttempts(options);
  let attempts = 0;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    attempts = attempt;
    const yahoo = await fetchYahooChartSeries(candidates[0], {
      ...options,
      symbol: isAthensListing(company) ? 'ATHEX_BENCHMARK' : 'SPY',
      alternateSymbols: candidates.slice(1),
      currency: company.currency || 'USD',
      range,
      interval: '1d',
      excludeIncompleteSession: true,
      minimumObservationCount,
    });
    diagnostics.push(...(yahoo.diagnostics || []).map((item) => ({ ...item, benchmark: true, benchmarkAttempt: attempt })));
    if (benchmarkSeriesMeetsDepth(yahoo.series, minimumObservationCount)) {
      options.benchmarkCache?.set(cacheKey, yahoo.series);
      options.benchmarkCache?.set(retryStateKey, { status: 'READY', attempts: attempt });
      if (attempt > 1) {
        diagnostics.push({
          code: 'MARKET_BENCHMARK_RECOVERED_AFTER_RETRY',
          companyId: company.companyId,
          attempts: attempt,
          providerSymbol: yahoo.series.providerSymbol || yahoo.series.symbol || null,
          observationCount: yahoo.series.candles.length,
          minimumObservationCount,
        });
      }
      return yahoo.series;
    }
    const retryable = benchmarkRetryable(yahoo.diagnostics || []);
    if (attempt < maximumAttempts && retryable) {
      diagnostics.push({
        code: 'MARKET_BENCHMARK_RETRYING',
        companyId: company.companyId,
        attempt,
        maximumAttempts,
        minimumObservationCount,
      });
      await waitForBenchmarkRetry(options, attempt);
      continue;
    }
    break;
  }

  options.benchmarkCache?.set(retryStateKey, { status: 'EXHAUSTED', attempts });
  diagnostics.push({
    code: 'MARKET_BENCHMARK_RETRY_EXHAUSTED',
    companyId: company.companyId,
    attempts,
    maximumAttempts,
    minimumObservationCount,
  });
  return null;
}

export async function fetchProfessionalHistoricalMetrics(company, options = {}) {
  const diagnostics = [];
  const series = await fetchCompanyHistorySeries(company, options, diagnostics);
  if (!series?.usable) {
    return {
      series: series || null,
      benchmarkSeries: null,
      metrics: null,
      diagnostics: [...diagnostics, { code: 'MARKET_HISTORY_UNAVAILABLE', companyId: company.companyId }],
    };
  }

  const benchmarkSeries = await fetchBenchmarkSeries(company, options, diagnostics);
  const validation = validateHistoryAgainstSnapshot(series, options.marketSnapshot, company, options);
  const sourceReady = series.sourceQuality === 'PRIMARY_LICENSED'
    || (series.sourceQuality === 'SECONDARY_VALIDATED' && validation.ready);
  const benchmarkReady = Boolean(benchmarkSeries?.usable);
  const metrics = calculateMarketMetrics(series, benchmarkSeries, {
    companyId: company.companyId,
    symbol: company.primaryListing?.symbol,
    benchmarkSymbol: benchmarkSeries?.providerSymbol || benchmarkSeries?.symbol || null,
    currency: company.currency || company.listings?.[0]?.currency || null,
    generatedAt: options.generatedAt,
    sourceReady,
    crossCheckReady: validation.ready,
    benchmarkReady,
    historySource: series.source,
    historySourceQuality: series.sourceQuality,
    benchmarkSource: benchmarkSeries?.source || null,
    validation,
  });

  if (!validation.ready) {
    diagnostics.push({
      code: 'MARKET_HISTORY_CROSSCHECK_FAILED',
      companyId: company.companyId,
      symbol: company.primaryListing?.symbol || null,
      deviationPct: validation.deviationPct,
      tolerancePct: validation.tolerancePct,
      reason: validation.reason,
    });
  }
  if (!benchmarkReady) diagnostics.push({ code: 'MARKET_BENCHMARK_UNAVAILABLE', companyId: company.companyId });
  if (series.sourceQuality === 'SECONDARY_VALIDATED') {
    diagnostics.push({
      code: 'VALIDATED_HISTORY_FALLBACK_ACTIVE',
      companyId: company.companyId,
      providerSymbol: series.providerSymbol,
      crossCheckReady: validation.ready,
    });
  }

  return { series, benchmarkSeries, metrics, diagnostics };
}
