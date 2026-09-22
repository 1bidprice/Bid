import { createHash } from 'node:crypto';

export const MINBEIS_DECISION_OUTCOME_LEDGER_VERSION = '2026-09-22.1';
const HORIZONS = Object.freeze([7, 30, 90]);
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const round = (value, digits = 4) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function idFor(record) {
  const raw = [record.instrumentId || record.companyId || record.symbol || 'UNKNOWN', record.action, record.decisionAt, record.referencePrice].join('|');
  return 'minbeis:' + createHash('sha256').update(raw).digest('hex').slice(0, 28);
}

export function createMinbeisDecisionOutcomeRecord(input = {}) {
  if (!['BUY_PROBE', 'BUY_STARTER', 'BUY_CORE', 'REDUCE', 'HOLD', 'NO_BUY', 'WATCH'].includes(input.action)) throw new Error('Unsupported MINBEIS action');
  if (!input.decisionAt) throw new Error('decisionAt is required');
  if (!finite(input.referencePrice) || Number(input.referencePrice) <= 0) throw new Error('positive referencePrice is required');
  const record = {
    format: 'investor-control-minbeis-decision-outcome',
    version: 1,
    policyVersion: MINBEIS_DECISION_OUTCOME_LEDGER_VERSION,
    decisionId: null,
    instrumentId: input.instrumentId || input.companyId || null,
    companyId: input.companyId || null,
    symbol: input.symbol || null,
    action: input.action,
    allocationPct: finite(input.allocationPct) ? Number(input.allocationPct) : 0,
    decisionAt: new Date(input.decisionAt).toISOString(),
    referencePrice: Number(input.referencePrice),
    currency: input.currency || null,
    benchmarkSymbol: input.benchmarkSymbol || null,
    confidenceScore: finite(input.confidenceScore) ? Number(input.confidenceScore) : null,
    dataQualityScore: finite(input.dataQualityScore) ? Number(input.dataQualityScore) : null,
    horizons: Object.fromEntries(HORIZONS.map((days) => [String(days), { tradingDays: days, status: 'OPEN', evaluatedAt: null, outcomePrice: null, realisedReturnPct: null, benchmarkReturnPct: null, excessReturnPct: null }])),
  };
  record.decisionId = idFor(record);
  return record;
}

function sortedSeries(series = []) {
  return (Array.isArray(series) ? series : []).map((item) => ({ timestamp: new Date(item.timestamp || item.date || 0).getTime(), close: Number(item.close) })).filter((item) => Number.isFinite(item.timestamp) && item.timestamp > 0 && Number.isFinite(item.close) && item.close > 0).sort((a, b) => a.timestamp - b.timestamp);
}

function anchorIndex(series, decisionAt) {
  const target = new Date(decisionAt).getTime();
  let index = -1;
  for (let i = 0; i < series.length; i += 1) { if (series[i].timestamp <= target) index = i; else break; }
  return index;
}

function returnPct(start, end) { return ((Number(end) - Number(start)) / Number(start)) * 100; }

export function evaluateMinbeisDecisionOutcome(record, marketSeries = [], benchmarkSeries = [], options = {}) {
  const prices = sortedSeries(marketSeries);
  const benchmark = sortedSeries(benchmarkSeries);
  const startIndex = anchorIndex(prices, record.decisionAt);
  const benchmarkStartIndex = benchmark.length ? anchorIndex(benchmark, record.decisionAt) : -1;
  if (startIndex < 0) return record;
  const evaluatedAt = new Date(options.evaluatedAt || Date.now()).toISOString();
  const nextHorizons = { ...record.horizons };
  for (const days of HORIZONS) {
    const key = String(days);
    if (nextHorizons[key]?.status === 'MATURED') continue;
    const outcome = prices[startIndex + days];
    if (!outcome) continue;
    const realised = returnPct(record.referencePrice, outcome.close);
    let benchmarkReturn = null;
    if (benchmarkStartIndex >= 0 && benchmark[benchmarkStartIndex + days]) {
      const benchmarkStart = benchmark[benchmarkStartIndex]?.close;
      const benchmarkEnd = benchmark[benchmarkStartIndex + days]?.close;
      if (finite(benchmarkStart) && finite(benchmarkEnd)) benchmarkReturn = returnPct(benchmarkStart, benchmarkEnd);
    }
    nextHorizons[key] = { tradingDays: days, status: 'MATURED', evaluatedAt, outcomePrice: outcome.close, realisedReturnPct: round(realised), benchmarkReturnPct: benchmarkReturn === null ? null : round(benchmarkReturn), excessReturnPct: benchmarkReturn === null ? null : round(realised - benchmarkReturn) };
  }
  return { ...record, horizons: nextHorizons };
}

export function summarizeMinbeisDecisionOutcomes(records = []) {
  const rows = Array.isArray(records) ? records : [];
  const summary = {};
  for (const days of HORIZONS) {
    const key = String(days);
    const matured = rows.filter((record) => record?.horizons?.[key]?.status === 'MATURED');
    const buyRows = matured.filter((record) => ['BUY_PROBE', 'BUY_STARTER', 'BUY_CORE'].includes(record.action));
    const returns = buyRows.map((record) => Number(record.horizons[key].realisedReturnPct)).filter(Number.isFinite);
    const excess = buyRows.map((record) => Number(record.horizons[key].excessReturnPct)).filter(Number.isFinite);
    summary[key] = { tradingDays: days, maturedDecisionCount: matured.length, maturedBuyDecisionCount: buyRows.length, positiveBuyRatePct: returns.length ? round((returns.filter((value) => value > 0).length / returns.length) * 100, 2) : null, averageBuyReturnPct: returns.length ? round(returns.reduce((a, b) => a + b, 0) / returns.length, 4) : null, averageBuyExcessReturnPct: excess.length ? round(excess.reduce((a, b) => a + b, 0) / excess.length, 4) : null };
  }
  return { format: 'investor-control-minbeis-decision-outcome-summary', version: 1, policyVersion: MINBEIS_DECISION_OUTCOME_LEDGER_VERSION, recordCount: rows.length, horizons: summary, caution: 'Outcome statistics describe historical observed decisions and are not a promise of future performance.' };
}
