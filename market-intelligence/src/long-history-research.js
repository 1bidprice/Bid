import { fetchYahooChartSeries } from './adapters/yahoo-chart.js';

export const LONG_HISTORY_RESEARCH_POLICY_VERSION = '2026-08-11.1';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function timestampSeconds(value) {
  const number = finite(value);
  if (number === null || number <= 0) return null;
  return number > 10_000_000_000 ? Math.floor(number / 1000) : Math.floor(number);
}

function tradingDate(value) {
  const seconds = timestampSeconds(value);
  if (seconds === null) return null;
  const iso = new Date(seconds * 1000).toISOString();
  return iso.slice(0, 10);
}

function median(values = []) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values = [], probability = 0.95) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(probability * sorted.length) - 1));
  return sorted[index];
}

function hostFromUrl(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function sourceIdentity(series = {}) {
  return {
    source: String(series.source || '').trim().toLowerCase() || null,
    host: hostFromUrl(series.sourceUrl),
  };
}

function sourcesIndependent(candidateSeries, canonicalSeries) {
  const candidate = sourceIdentity(candidateSeries);
  const canonical = sourceIdentity(canonicalSeries);
  if (candidate.source && canonical.source && candidate.source === canonical.source) return false;
  if (candidate.host && canonical.host && candidate.host === canonical.host) return false;
  return true;
}

function crossCheckClose(candle, mode) {
  if (!candle || typeof candle !== 'object') return null;
  const raw = finite(candle.rawClose);
  const close = finite(candle.close);
  if (mode === 'candidate') return raw !== null && raw > 0 ? raw : close !== null && close > 0 ? close : null;
  return close !== null && close > 0 ? close : raw !== null && raw > 0 ? raw : null;
}

function dateMap(series, mode) {
  const map = new Map();
  for (const candle of Array.isArray(series?.candles) ? series.candles : []) {
    const date = tradingDate(candle?.timestamp);
    const close = crossCheckClose(candle, mode);
    if (!date || close === null || close <= 0) continue;
    map.set(date, { date, close, timestamp: timestampSeconds(candle.timestamp) });
  }
  return map;
}

export function crossCheckLongHistorySeries(candidateSeries, canonicalSeries, options = {}) {
  const minimumOverlapSessions = Math.max(10, Number(options.minimumOverlapSessions || 40));
  const minimumReturnPairs = Math.max(8, Number(options.minimumReturnPairs || 30));
  const maximumOverlapSessions = Math.max(minimumOverlapSessions, Number(options.maximumOverlapSessions || 120));
  const maxMedianReturnErrorBps = Number(options.maxMedianReturnErrorBps ?? 35);
  const maxP95ReturnErrorBps = Number(options.maxP95ReturnErrorBps ?? 175);
  const maxScaleMadBps = Number(options.maxScaleMadBps ?? 50);
  const blockers = [];

  if (!sourcesIndependent(candidateSeries, canonicalSeries)) {
    blockers.push('INDEPENDENT_CANONICAL_OVERLAP_SOURCE_REQUIRED');
  }

  const candidateMap = dateMap(candidateSeries, 'candidate');
  const canonicalMap = dateMap(canonicalSeries, 'canonical');
  const dates = [...candidateMap.keys()]
    .filter((date) => canonicalMap.has(date))
    .sort()
    .slice(-maximumOverlapSessions);

  if (dates.length < minimumOverlapSessions) blockers.push('LONG_HISTORY_CANONICAL_OVERLAP_TOO_SMALL');

  const aligned = dates.map((date) => ({
    date,
    candidate: candidateMap.get(date).close,
    canonical: canonicalMap.get(date).close,
  }));
  const scaleRatios = aligned
    .map((item) => item.canonical > 0 ? item.candidate / item.canonical : null)
    .filter(Number.isFinite);
  const scaleMedian = median(scaleRatios);
  const scaleMadBps = scaleMedian && scaleMedian > 0
    ? median(scaleRatios.map((ratio) => Math.abs(ratio - scaleMedian) / scaleMedian * 10_000))
    : null;

  const returnErrorsBps = [];
  for (let index = 1; index < aligned.length; index += 1) {
    const previous = aligned[index - 1];
    const current = aligned[index];
    if (previous.candidate <= 0 || previous.canonical <= 0) continue;
    const candidateReturn = current.candidate / previous.candidate - 1;
    const canonicalReturn = current.canonical / previous.canonical - 1;
    if (!Number.isFinite(candidateReturn) || !Number.isFinite(canonicalReturn)) continue;
    returnErrorsBps.push(Math.abs(candidateReturn - canonicalReturn) * 10_000);
  }

  const medianReturnErrorBps = median(returnErrorsBps);
  const p95ReturnErrorBps = percentile(returnErrorsBps, 0.95);
  if (returnErrorsBps.length < minimumReturnPairs) blockers.push('LONG_HISTORY_CANONICAL_RETURN_PAIRS_TOO_SMALL');
  if (medianReturnErrorBps !== null && medianReturnErrorBps > maxMedianReturnErrorBps) blockers.push('LONG_HISTORY_MEDIAN_RETURN_MISMATCH');
  if (p95ReturnErrorBps !== null && p95ReturnErrorBps > maxP95ReturnErrorBps) blockers.push('LONG_HISTORY_TAIL_RETURN_MISMATCH');
  if (scaleMadBps !== null && scaleMadBps > maxScaleMadBps) blockers.push('LONG_HISTORY_CLOSE_SCALE_UNSTABLE');

  return {
    format: 'investor-control-long-history-cross-check',
    version: 1,
    policyVersion: LONG_HISTORY_RESEARCH_POLICY_VERSION,
    status: blockers.length ? 'CROSSCHECK_FAIL' : 'CROSSCHECK_PASS',
    researchEligible: blockers.length === 0,
    decisionEligible: false,
    executionEligible: false,
    overlapSessions: aligned.length,
    returnPairs: returnErrorsBps.length,
    scaleMedian: round(scaleMedian, 8),
    scaleMadBps: round(scaleMadBps, 2),
    medianReturnErrorBps: round(medianReturnErrorBps, 2),
    p95ReturnErrorBps: round(p95ReturnErrorBps, 2),
    thresholds: {
      minimumOverlapSessions,
      minimumReturnPairs,
      maximumOverlapSessions,
      maxMedianReturnErrorBps,
      maxP95ReturnErrorBps,
      maxScaleMadBps,
    },
    blockers,
  };
}

export function validateLongHistoryResearchSeries(input = {}) {
  const candidateSeries = input.candidateSeries || null;
  const canonicalSeries = input.canonicalSeries || null;
  const minimumObservations = Math.max(260, Number(input.minimumObservations || 1260));
  const observationCount = Array.isArray(candidateSeries?.candles) ? candidateSeries.candles.length : 0;
  const blockers = [];

  if (!candidateSeries?.usable || observationCount === 0) blockers.push('LONG_HISTORY_SERIES_UNAVAILABLE');
  if (observationCount < minimumObservations) blockers.push('LONG_HISTORY_OBSERVATION_COUNT_TOO_SMALL');
  if (!canonicalSeries?.usable || !Array.isArray(canonicalSeries?.candles) || canonicalSeries.candles.length === 0) {
    blockers.push('CANONICAL_OVERLAP_SERIES_REQUIRED');
  }

  const crossCheck = blockers.includes('CANONICAL_OVERLAP_SERIES_REQUIRED')
    ? null
    : crossCheckLongHistorySeries(candidateSeries || {}, canonicalSeries || {}, input.crossCheckOptions || {});
  if (crossCheck && !crossCheck.researchEligible) blockers.push(...crossCheck.blockers);

  const uniqueBlockers = [...new Set(blockers)];
  const researchEligible = uniqueBlockers.length === 0;
  return {
    format: 'investor-control-long-history-research-series',
    version: 1,
    policyVersion: LONG_HISTORY_RESEARCH_POLICY_VERSION,
    status: researchEligible ? 'RESEARCH_READY' : 'REJECTED',
    researchEligible,
    decisionEligible: false,
    executionEligible: false,
    observationCount,
    minimumObservations,
    source: candidateSeries?.source || null,
    providerSymbol: candidateSeries?.providerSymbol || null,
    sourceUrl: candidateSeries?.sourceUrl || null,
    sourceQuality: candidateSeries?.sourceQuality || null,
    adjustment: candidateSeries?.adjustment || null,
    generatedAt: candidateSeries?.generatedAt || null,
    crossCheck,
    blockers: uniqueBlockers,
    series: researchEligible ? {
      ...candidateSeries,
      researchOnly: true,
      decisionEligible: false,
      executionEligible: false,
      validationPolicyVersion: LONG_HISTORY_RESEARCH_POLICY_VERSION,
    } : null,
  };
}

export async function fetchLongHistoryResearchSeries(symbolInput, options = {}) {
  const range = String(options.range || 'max');
  const result = await fetchYahooChartSeries(symbolInput, {
    ...options,
    range,
    interval: options.interval || '1d',
    excludeIncompleteSession: options.excludeIncompleteSession !== false,
  });

  if (!result?.series) {
    return {
      format: 'investor-control-long-history-research-series',
      version: 1,
      policyVersion: LONG_HISTORY_RESEARCH_POLICY_VERSION,
      status: 'REJECTED',
      researchEligible: false,
      decisionEligible: false,
      executionEligible: false,
      observationCount: 0,
      minimumObservations: Math.max(260, Number(options.minimumObservations || 1260)),
      requestedRange: range,
      crossCheck: null,
      blockers: ['LONG_HISTORY_PROVIDER_UNAVAILABLE'],
      diagnostics: result?.diagnostics || [],
      series: null,
    };
  }

  const validated = validateLongHistoryResearchSeries({
    candidateSeries: result.series,
    canonicalSeries: options.canonicalSeries,
    minimumObservations: options.minimumObservations,
    crossCheckOptions: options.crossCheckOptions,
  });
  return {
    ...validated,
    requestedRange: range,
    diagnostics: result.diagnostics || [],
  };
}
