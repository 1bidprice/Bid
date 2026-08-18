export const HISTORY_FRESHNESS_RECOVERY_VERSION = '2026-08-12.1';
export const HISTORY_FRESHNESS_RECOVERY_CONTRACT = 'VALIDATED_RECENT_HISTORY_MERGE_V1';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function dateKey(timestampSeconds) {
  const timestamp = finite(timestampSeconds);
  if (timestamp === null || timestamp <= 0) return null;
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function rawClose(candle) {
  const value = finite(candle?.rawClose) ?? finite(candle?.close);
  return value !== null && value > 0 ? value : null;
}

function normalizedCandles(series) {
  const byDate = new Map();
  for (const candle of Array.isArray(series?.candles) ? series.candles : []) {
    const date = dateKey(candle?.timestamp);
    const close = rawClose(candle);
    if (!date || close === null) continue;
    byDate.set(date, { ...candle });
  }
  return byDate;
}

function providerIdentity(series) {
  return String(series?.providerSymbol || series?.symbol || '').trim().toUpperCase() || null;
}

export function validateAndMergeRecentHistory(baseSeries, recentSeries, options = {}) {
  const minimumOverlapCandles = Math.max(3, Number(options.minimumOverlapCandles || 5));
  const maximumOverlapRawCloseDeviationPct = Math.max(0, Math.min(2, Number(options.maximumOverlapRawCloseDeviationPct ?? 0.5)));
  const requiredLatestDate = String(options.requiredLatestDate || '').trim() || null;
  const blockers = [];

  if (!baseSeries?.usable || !recentSeries?.usable) blockers.push('HISTORY_RECOVERY_SERIES_UNUSABLE');
  if (baseSeries?.source !== 'Yahoo Finance Chart' || recentSeries?.source !== 'Yahoo Finance Chart') blockers.push('HISTORY_RECOVERY_PROVIDER_NOT_YAHOO');
  if (baseSeries?.sourceQuality !== 'SECONDARY_VALIDATED' || recentSeries?.sourceQuality !== 'SECONDARY_VALIDATED') blockers.push('HISTORY_RECOVERY_SOURCE_QUALITY_INVALID');

  const baseProvider = providerIdentity(baseSeries);
  const recentProvider = providerIdentity(recentSeries);
  if (!baseProvider || !recentProvider || baseProvider !== recentProvider) blockers.push('HISTORY_RECOVERY_PROVIDER_SYMBOL_MISMATCH');

  const base = normalizedCandles(baseSeries);
  const recent = normalizedCandles(recentSeries);
  const baseDates = [...base.keys()].sort();
  const recentDates = [...recent.keys()].sort();
  const baseLatestDate = baseDates.at(-1) || null;
  const recentLatestDate = recentDates.at(-1) || null;

  if (!baseLatestDate || !recentLatestDate) blockers.push('HISTORY_RECOVERY_DATE_COVERAGE_MISSING');
  if (requiredLatestDate && recentLatestDate !== requiredLatestDate) blockers.push('HISTORY_RECOVERY_TARGET_SESSION_NOT_REACHED');
  if (baseLatestDate && recentLatestDate && recentLatestDate <= baseLatestDate) blockers.push('HISTORY_RECOVERY_NO_NEWER_COMPLETED_SESSION');

  const overlapDates = recentDates.filter((date) => base.has(date));
  const deviations = [];
  for (const date of overlapDates) {
    const baseClose = rawClose(base.get(date));
    const recentClose = rawClose(recent.get(date));
    if (baseClose === null || recentClose === null || baseClose <= 0) continue;
    deviations.push(Math.abs((recentClose / baseClose) - 1) * 100);
  }
  const validOverlapCount = deviations.length;
  const maximumObservedDeviationPct = deviations.length ? Math.max(...deviations) : null;
  if (validOverlapCount < minimumOverlapCandles) blockers.push('HISTORY_RECOVERY_OVERLAP_TOO_SMALL');
  if (maximumObservedDeviationPct === null || maximumObservedDeviationPct > maximumOverlapRawCloseDeviationPct) blockers.push('HISTORY_RECOVERY_OVERLAP_PRICE_MISMATCH');

  if (blockers.length) {
    return {
      contract: HISTORY_FRESHNESS_RECOVERY_CONTRACT,
      policyVersion: HISTORY_FRESHNESS_RECOVERY_VERSION,
      status: 'RECOVERY_REJECTED',
      ready: false,
      series: null,
      baseLatestDate,
      recentLatestDate,
      requiredLatestDate,
      overlapCount: validOverlapCount,
      maximumOverlapRawCloseDeviationPct: maximumObservedDeviationPct === null ? null : Number(maximumObservedDeviationPct.toFixed(6)),
      thresholds: { minimumOverlapCandles, maximumOverlapRawCloseDeviationPct },
      blockers: [...new Set(blockers)],
    };
  }

  const merged = new Map(base);
  for (const [date, candle] of recent.entries()) merged.set(date, candle);
  const candles = [...merged.values()].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  const series = {
    ...baseSeries,
    candles,
    freshnessRecovery: {
      contract: HISTORY_FRESHNESS_RECOVERY_CONTRACT,
      policyVersion: HISTORY_FRESHNESS_RECOVERY_VERSION,
      status: 'RECOVERED',
      baseLatestDate,
      recoveredLatestDate: recentLatestDate,
      requiredLatestDate,
      overlapCount: validOverlapCount,
      maximumOverlapRawCloseDeviationPct: Number(maximumObservedDeviationPct.toFixed(6)),
      thresholds: { minimumOverlapCandles, maximumOverlapRawCloseDeviationPct },
      source: 'Yahoo Finance Chart recent-session refresh',
      decisionImpact: 'MARKET_HISTORY_FRESHNESS_ONLY',
    },
  };

  return {
    contract: HISTORY_FRESHNESS_RECOVERY_CONTRACT,
    policyVersion: HISTORY_FRESHNESS_RECOVERY_VERSION,
    status: 'RECOVERY_READY',
    ready: true,
    series,
    baseLatestDate,
    recentLatestDate,
    requiredLatestDate,
    overlapCount: validOverlapCount,
    maximumOverlapRawCloseDeviationPct: Number(maximumObservedDeviationPct.toFixed(6)),
    thresholds: { minimumOverlapCandles, maximumOverlapRawCloseDeviationPct },
    blockers: [],
  };
}
