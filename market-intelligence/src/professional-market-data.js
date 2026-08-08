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
    range: options.range || '2y',
    interval: '1d',
    excludeIncompleteSession: true,
  });
  diagnostics.push(...(fallback.diagnostics || []));
  return fallback.series || null;
}

async function fetchBenchmarkSeries(company, options, diagnostics) {
  const candidates = benchmarkYahooSymbols(company);
  const cacheKey = `YAHOO:${candidates.join('|')}`;
  if (options.benchmarkCache?.has(cacheKey)) return options.benchmarkCache.get(cacheKey);

  if (company.country === 'US' && String(options.token || '').trim()) {
    const finnhub = await fetchFinnhubCandlesForSymbol('SPY', {
      ...options,
      currency: 'USD',
    });
    diagnostics.push(...(finnhub.diagnostics || []).map((item) => ({ ...item, benchmark: true })));
    if (finnhub.series?.usable) {
      const series = { ...finnhub.series, sourceQuality: 'PRIMARY_LICENSED', providerSymbol: 'SPY' };
      options.benchmarkCache?.set(cacheKey, series);
      return series;
    }
  }

  const yahoo = await fetchYahooChartSeries(candidates[0], {
    ...options,
    symbol: isAthensListing(company) ? 'ATHEX_BENCHMARK' : 'SPY',
    alternateSymbols: candidates.slice(1),
    currency: company.currency || 'USD',
    range: options.range || '2y',
    interval: '1d',
    excludeIncompleteSession: true,
  });
  diagnostics.push(...(yahoo.diagnostics || []).map((item) => ({ ...item, benchmark: true })));
  if (yahoo.series) options.benchmarkCache?.set(cacheKey, yahoo.series);
  return yahoo.series || null;
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
