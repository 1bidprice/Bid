import { contentHash } from './content-hash.js';
import { normalizeHistoricalSeries } from './historical-pattern-engine.js';
import { evaluateForecastCalibration } from './forecast-calibration.js';

export const FORECAST_OUTCOME_LEDGER_VERSION = '2026-08-11.1';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function dossierMap(dossiers = []) {
  return new Map((Array.isArray(dossiers) ? dossiers : []).filter((item) => item?.companyId).map((item) => [item.companyId, item]));
}

export function createLiveShadowForecastRecords(shadowForecasts = [], researchDossiers = [], options = {}) {
  const dossiers = dossierMap(researchDossiers);
  const records = [];
  for (const shadow of Array.isArray(shadowForecasts) ? shadowForecasts : []) {
    if (shadow?.mode !== 'SHADOW_ONLY' || shadow?.decisionImpact !== 'NONE') continue;
    const dossier = dossiers.get(shadow.companyId) || null;
    const referenceValue = finite(dossier?.referencePrice?.value);
    const referenceTimestamp = dossier?.referencePrice?.timestamp || shadow?.historicalPatternForecast?.asOf || shadow?.generatedAt || null;
    if (referenceValue === null || referenceValue <= 0 || !referenceTimestamp) continue;

    for (const [horizon, forecast] of Object.entries(shadow?.historicalPatternForecast?.horizons || {})) {
      const rawProbabilityPositive = finite(forecast?.rawProbabilityPositive);
      const tradingDays = Math.max(0, Number(forecast?.tradingDays || 0));
      if (rawProbabilityPositive === null || rawProbabilityPositive < 0 || rawProbabilityPositive > 1 || tradingDays <= 0) continue;
      const identity = {
        policyVersion: shadow.policyVersion,
        historicalPatternPolicyVersion: shadow?.historicalPatternForecast?.policyVersion || null,
        companyId: shadow.companyId,
        instrumentId: shadow.instrumentId,
        horizon,
        generatedAt: shadow.generatedAt,
        referenceTimestamp,
      };
      records.push({
        format: 'investor-control-forecast-outcome-record',
        version: 1,
        ledgerPolicyVersion: FORECAST_OUTCOME_LEDGER_VERSION,
        forecastId: `forecast:${contentHash(identity).slice(0, 28)}`,
        validationMode: 'LIVE_SHADOW_OOS',
        forecastPolicyVersion: shadow.policyVersion,
        historicalPatternPolicyVersion: shadow?.historicalPatternForecast?.policyVersion || null,
        companyId: shadow.companyId || null,
        instrumentId: shadow.instrumentId || null,
        displayName: shadow.displayName || null,
        symbol: shadow.symbol || null,
        assetClass: shadow.assetClass || 'UNKNOWN',
        horizon,
        tradingDays,
        forecastAt: shadow.generatedAt,
        referencePrice: {
          value: referenceValue,
          timestamp: referenceTimestamp,
          currency: dossier?.referencePrice?.currency || null,
          source: dossier?.referencePrice?.source || null,
        },
        rawProbabilityPositive,
        calibratedProbabilityPositive: finite(shadow?.forecast?.horizons?.[horizon]?.probabilityPositive),
        expectedReturnPct: finite(forecast?.expectedReturnPct),
        distribution: forecast?.distribution || null,
        patternConfidenceScore: finite(forecast?.patternConfidenceScore),
        evidenceQualityScore: finite(shadow?.forecast?.horizons?.[horizon]?.evidenceQualityScore),
        regime: shadow?.historicalPatternForecast?.currentPattern?.regime || null,
        existingFinalActionSnapshot: shadow?.existingFinalActionSnapshot || null,
        decisionImpact: 'NONE',
        realisedOutcome: null,
        positiveOutcome: null,
        outcomeEvaluatedAt: null,
        status: 'OPEN',
        appendOnlyIdentity: identity,
      });
    }
  }
  return records;
}

function anchorIndexForTimestamp(candles, referenceTimestamp) {
  const target = new Date(referenceTimestamp).getTime() / 1000;
  if (!Number.isFinite(target)) return -1;
  let index = -1;
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].timestamp <= target) index = i;
    else break;
  }
  return index;
}

export function evaluateLiveShadowForecastRecord(record, marketSeries, options = {}) {
  if (record?.status === 'MATURED') return record;
  if (record?.validationMode !== 'LIVE_SHADOW_OOS') throw new Error('Live shadow outcome evaluation requires LIVE_SHADOW_OOS record');
  const candles = normalizeHistoricalSeries(marketSeries);
  const referenceValue = finite(record?.referencePrice?.value);
  const anchorIndex = anchorIndexForTimestamp(candles, record?.referencePrice?.timestamp);
  const horizonDays = Math.max(1, Number(record?.tradingDays || 0));
  const targetIndex = anchorIndex >= 0 ? anchorIndex + horizonDays : -1;
  const outcomeCandle = targetIndex >= 0 ? candles[targetIndex] : null;
  if (referenceValue === null || referenceValue <= 0 || !outcomeCandle) return { ...record, status: 'OPEN' };
  const realisedReturnPct = ((outcomeCandle.close - referenceValue) / referenceValue) * 100;
  return {
    ...record,
    realisedOutcome: {
      timestamp: new Date(outcomeCandle.timestamp * 1000).toISOString(),
      close: outcomeCandle.close,
      realisedReturnPct: round(realisedReturnPct, 4),
    },
    positiveOutcome: realisedReturnPct > 0 ? 1 : 0,
    outcomeEvaluatedAt: new Date(options.evaluatedAt || Date.now()).toISOString(),
    status: 'MATURED',
  };
}

export function mergeForecastOutcomeLedger(existingRecords = [], newRecords = []) {
  const byId = new Map();
  for (const record of [...(Array.isArray(existingRecords) ? existingRecords : []), ...(Array.isArray(newRecords) ? newRecords : [])]) {
    if (!record?.forecastId) continue;
    const current = byId.get(record.forecastId);
    if (!current || (current.status !== 'MATURED' && record.status === 'MATURED')) byId.set(record.forecastId, record);
  }
  return [...byId.values()].sort((a, b) => String(a.forecastAt).localeCompare(String(b.forecastAt)) || String(a.forecastId).localeCompare(String(b.forecastId)));
}

export function summarizeForecastOutcomeLedger(records = [], options = {}) {
  const matured = (Array.isArray(records) ? records : []).filter((record) => record?.status === 'MATURED');
  const groups = new Map();
  for (const record of matured) {
    const key = `${record.assetClass || 'UNKNOWN'}|${record.horizon || 'UNKNOWN'}`;
    const group = groups.get(key) || { assetClass: record.assetClass || 'UNKNOWN', horizon: record.horizon || 'UNKNOWN', records: [] };
    group.records.push(record);
    groups.set(key, group);
  }
  return {
    format: 'investor-control-forecast-outcome-ledger-summary',
    version: 1,
    policyVersion: FORECAST_OUTCOME_LEDGER_VERSION,
    recordCount: Array.isArray(records) ? records.length : 0,
    openCount: (Array.isArray(records) ? records : []).filter((record) => record?.status === 'OPEN').length,
    maturedCount: matured.length,
    groups: [...groups.values()].map((group) => ({
      assetClass: group.assetClass,
      horizon: group.horizon,
      recordCount: group.records.length,
      calibration: evaluateForecastCalibration(group.records, {
        minimumTotal: options.minimumTotal || 100,
        binCount: options.binCount || 10,
      }),
    })),
  };
}
