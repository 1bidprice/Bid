import { fetchYahooChartSeries } from './adapters/yahoo-chart.js';
import { calculateMarketMetrics } from './market-metrics.js';

export const BROAD_EQUITY_MARKET_SCREEN_VERSION = '2026-08-09.1';

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));
const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function percentile(values, own, higherIsBetter = true) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!Number.isFinite(own) || valid.length < 3) return null;
  const lower = valid.filter((value) => value < own).length;
  const equal = valid.filter((value) => value === own).length;
  const p = ((lower + Math.max(0, equal - 1) / 2) / Math.max(1, valid.length - 1)) * 100;
  return clamp(higherIsBetter ? p : 100 - p);
}

function yahooSymbols(candidate) {
  const symbol = String(candidate?.primaryListing?.symbol || '').trim();
  if (!symbol) return [];
  const yahoo = symbol.replace(/\./g, '-');
  return [...new Set([yahoo, symbol])];
}

function preliminaryPriceToSales(candidate, latestPrice) {
  const annualRevenue = finite(candidate?.broadScreen?.rawSignals?.annualRevenue);
  const shares = finite(candidate?.broadScreen?.rawSignals?.sharesOutstanding);
  if (!(annualRevenue > 0) || !(shares > 0) || !(latestPrice > 0)) return null;
  return (latestPrice * shares) / annualRevenue;
}

function preliminaryPriceToBook(candidate, latestPrice) {
  const equity = finite(candidate?.broadScreen?.rawSignals?.equity);
  const shares = finite(candidate?.broadScreen?.rawSignals?.sharesOutstanding);
  if (!(equity > 0) || !(shares > 0) || !(latestPrice > 0)) return null;
  return (latestPrice * shares) / equity;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, run));
  return results;
}

function weightedScore(components) {
  let weighted = 0;
  let covered = 0;
  for (const [score, weight] of components) {
    if (!Number.isFinite(score)) continue;
    weighted += score * weight;
    covered += weight;
  }
  return covered > 0 ? weighted / covered : null;
}

export async function screenBroadEquityMarketCandidates(candidates = [], options = {}) {
  const generatedAt = new Date(options.now || Date.now()).toISOString();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const diagnostics = [];
  const benchmarkSymbol = options.benchmarkSymbol || 'SPY';
  const benchmarkResult = await fetchYahooChartSeries(benchmarkSymbol, {
    fetchImpl,
    generatedAt,
    range: options.range || '2y',
    interval: '1d',
    symbol: benchmarkSymbol,
  });
  diagnostics.push(...(benchmarkResult.diagnostics || []).map((item) => ({ ...item, scope: 'BENCHMARK' })));
  const benchmarkSeries = benchmarkResult.series;
  if (!benchmarkSeries?.usable) {
    return {
      format: 'investor-control-broad-equity-market-screen',
      version: 1,
      policyVersion: BROAD_EQUITY_MARKET_SCREEN_VERSION,
      generatedAt,
      benchmarkSymbol,
      inputCount: candidates.length,
      scorableCount: 0,
      candidates: [],
      diagnostics: [...diagnostics, { code: 'BROAD_MARKET_BENCHMARK_UNAVAILABLE' }],
      status: 'DEGRADED',
    };
  }

  const rows = await mapWithConcurrency(candidates, Number(options.concurrency || 8), async (candidate) => {
    const symbols = yahooSymbols(candidate);
    if (!symbols.length) return { candidate, metrics: null, diagnostic: { code: 'BROAD_MARKET_SYMBOL_MISSING' } };
    const result = await fetchYahooChartSeries(symbols[0], {
      fetchImpl,
      generatedAt,
      range: options.range || '2y',
      interval: '1d',
      symbol: candidate.primaryListing?.symbol || symbols[0],
      alternateSymbols: symbols.slice(1),
    });
    if (!result.series?.usable) {
      return { candidate, metrics: null, diagnostic: { code: 'BROAD_MARKET_SERIES_UNAVAILABLE', symbol: symbols[0], detail: result.diagnostics || [] } };
    }
    const metrics = calculateMarketMetrics(result.series, benchmarkSeries, {
      generatedAt,
      companyId: candidate.companyId,
      symbol: candidate.primaryListing?.symbol,
      benchmarkSymbol,
      currency: candidate.currency || 'USD',
      minimumPriceObservations: 120,
    });
    const latestPrice = finite(metrics.latestClose);
    return {
      candidate,
      metrics,
      raw: {
        fundamentalScore: finite(candidate?.broadScreen?.score),
        priceToSales: preliminaryPriceToSales(candidate, latestPrice),
        priceToBook: preliminaryPriceToBook(candidate, latestPrice),
        relativeStrength60Pct: finite(metrics.relativeStrength?.excessReturnPct),
        return120Pct: finite(metrics.returnsPct?.d120),
        distanceFromSma200Pct: finite(metrics.trend?.distanceFromSma200Pct),
        liquidityScore: finite(metrics.liquidity?.score),
        maxDrawdown120Pct: finite(metrics.risk?.maxDrawdown120Pct),
        volatility60Pct: finite(metrics.risk?.annualizedVolatility60Pct),
        latestPrice,
      },
      diagnostic: null,
    };
  });

  for (const row of rows) if (row?.diagnostic) diagnostics.push(row.diagnostic);
  const scorable = rows.filter((row) => row?.metrics?.readiness?.priceHistoryReady === true && row.raw?.fundamentalScore !== null);
  const rawSets = {
    ps: scorable.map((row) => row.raw.priceToSales).filter(Number.isFinite),
    pb: scorable.map((row) => row.raw.priceToBook).filter(Number.isFinite),
    rs: scorable.map((row) => row.raw.relativeStrength60Pct).filter(Number.isFinite),
    ret: scorable.map((row) => row.raw.return120Pct).filter(Number.isFinite),
    trend: scorable.map((row) => row.raw.distanceFromSma200Pct).filter(Number.isFinite),
    drawdown: scorable.map((row) => row.raw.maxDrawdown120Pct).filter(Number.isFinite),
    vol: scorable.map((row) => row.raw.volatility60Pct).filter(Number.isFinite),
  };

  const scored = scorable.map((row) => {
    const valuation = weightedScore([
      [percentile(rawSets.ps, row.raw.priceToSales, false), 0.60],
      [percentile(rawSets.pb, row.raw.priceToBook, false), 0.40],
    ]);
    const momentum = weightedScore([
      [percentile(rawSets.rs, row.raw.relativeStrength60Pct, true), 0.45],
      [percentile(rawSets.ret, row.raw.return120Pct, true), 0.30],
      [percentile(rawSets.trend, row.raw.distanceFromSma200Pct, true), 0.25],
    ]);
    const resilience = weightedScore([
      [percentile(rawSets.drawdown, row.raw.maxDrawdown120Pct, true), 0.55],
      [percentile(rawSets.vol, row.raw.volatility60Pct, false), 0.45],
    ]);
    const liquidity = row.raw.liquidityScore;
    const finalScore = weightedScore([
      [row.raw.fundamentalScore, 0.34],
      [valuation, 0.24],
      [momentum, 0.22],
      [liquidity, 0.12],
      [resilience, 0.08],
    ]);
    const severeMarketRisk = row.metrics.risk?.flags?.some((flag) => ['EXTREME_VOLATILITY', 'SEVERE_DRAWDOWN', 'LOW_LIQUIDITY'].includes(flag));
    return {
      ...row.candidate,
      broadScreen: {
        ...row.candidate.broadScreen,
        marketScreen: {
          policyVersion: BROAD_EQUITY_MARKET_SCREEN_VERSION,
          score: round(finalScore),
          fundamentalScore: round(row.raw.fundamentalScore),
          valuationScore: round(valuation),
          momentumScore: round(momentum),
          liquidityScore: round(liquidity),
          resilienceScore: round(resilience),
          preliminaryPriceToSales: round(row.raw.priceToSales, 3),
          preliminaryPriceToBook: round(row.raw.priceToBook, 3),
          latestPrice: round(row.raw.latestPrice, 4),
          relativeStrength60Pct: round(row.raw.relativeStrength60Pct),
          return120Pct: round(row.raw.return120Pct),
          distanceFromSma200Pct: round(row.raw.distanceFromSma200Pct),
          maxDrawdown120Pct: round(row.raw.maxDrawdown120Pct),
          volatility60Pct: round(row.raw.volatility60Pct),
          marketMetricsReady: row.metrics.readiness?.marketMetricsReady === true,
          severeMarketRisk,
          finalActionEligible: false,
        },
      },
    };
  }).filter((candidate) => candidate.broadScreen.marketScreen.severeMarketRisk !== true && Number.isFinite(candidate.broadScreen.marketScreen.score));

  scored.sort((a, b) => b.broadScreen.marketScreen.score - a.broadScreen.marketScreen.score || b.broadScreen.score - a.broadScreen.score);
  const limit = Math.max(1, Number(options.limit || scored.length || 1));
  return {
    format: 'investor-control-broad-equity-market-screen',
    version: 1,
    policyVersion: BROAD_EQUITY_MARKET_SCREEN_VERSION,
    generatedAt,
    benchmarkSymbol,
    inputCount: candidates.length,
    scorableCount: scorable.length,
    eligibleCount: scored.length,
    candidates: scored.slice(0, limit),
    truncated: scored.length > limit,
    diagnostics,
    status: scored.length ? 'ACTIVE' : 'DEGRADED',
    invariant: 'MARKET_SCREEN_PRIORITIZES_RESEARCH_ONLY_AND_NEVER_EMITS_A_FINAL_ACTION',
  };
}
