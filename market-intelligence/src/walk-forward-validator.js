import { buildHistoricalPatternForecast, normalizeHistoricalSeries } from './historical-pattern-engine.js';
import { evaluateForecastCalibration } from './forecast-calibration.js';

export const WALK_FORWARD_VALIDATOR_VERSION = '2026-08-11.1';

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function realizedReturnPct(candles, startIndex, horizonDays) {
  const start = candles[startIndex]?.close;
  const end = candles[startIndex + horizonDays]?.close;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) return null;
  return ((end - start) / start) * 100;
}

function subperiodStability(records, segments = 4) {
  if (!records.length) return { segmentCount: 0, segments: [], positiveSkillSegmentCount: 0, stable: false };
  const size = Math.max(1, Math.ceil(records.length / segments));
  const groups = [];
  for (let offset = 0; offset < records.length; offset += size) {
    const slice = records.slice(offset, offset + size);
    if (slice.length < 5) continue;
    const summary = evaluateForecastCalibration(slice, { minimumTotal: 20, binCount: 5 });
    groups.push({
      startAt: slice[0]?.forecastAt || null,
      endAt: slice.at(-1)?.forecastAt || null,
      sampleSize: summary.sampleSize,
      brierScore: summary.brierScore,
      skillVsBaseRatePct: summary.skillVsBaseRatePct,
      expectedCalibrationError: summary.expectedCalibrationError,
    });
  }
  const positiveSkill = groups.filter((item) => Number(item.skillVsBaseRatePct) > 0).length;
  return {
    segmentCount: groups.length,
    segments: groups,
    positiveSkillSegmentCount: positiveSkill,
    stable: groups.length >= 3 && positiveSkill >= Math.ceil(groups.length * 0.75),
  };
}

export function runHistoricalPatternWalkForward(input = {}) {
  const candles = normalizeHistoricalSeries(input.series || input.candles || []);
  const horizons = input.horizons && typeof input.horizons === 'object'
    ? input.horizons
    : { week1: 5, month1: 21, month3: 63 };
  const warmup = Math.max(260, Number(input.warmupObservations || 520));
  const evaluationStep = Math.max(1, Number(input.evaluationStep || 21));
  const minimumForecastsForMetrics = Math.max(20, Number(input.minimumForecastsForMetrics || 100));
  const generatedAt = new Date(input.generatedAt || Date.now()).toISOString();
  const byHorizon = {};

  for (const [horizonKey, rawDays] of Object.entries(horizons)) {
    const horizonDays = Math.max(1, Number(rawDays));
    const records = [];
    for (let anchorIndex = warmup; anchorIndex + horizonDays < candles.length; anchorIndex += evaluationStep) {
      const forecastAt = candles[anchorIndex]?.timestamp;
      const pattern = buildHistoricalPatternForecast({
        instrumentId: input.instrumentId || null,
        assetClass: input.assetClass || 'UNKNOWN',
        series: { candles },
        asOfTimestamp: forecastAt,
        horizons: { [horizonKey]: horizonDays },
        minAnalogCount: input.minAnalogCount,
        maxAnalogs: input.maxAnalogs,
        minEffectiveSample: input.minEffectiveSample,
        sameRegimeOnly: input.sameRegimeOnly,
        minimumHistory: input.minimumHistory,
        minimumAnchorSpacing: input.minimumAnchorSpacing || horizonDays,
        periodsPerYear: input.periodsPerYear,
      });
      const horizon = pattern.horizons?.[horizonKey];
      if (!horizon || horizon.status !== 'RESEARCH_READY_UNCALIBRATED' || !Number.isFinite(horizon.rawProbabilityPositive)) continue;
      const realized = realizedReturnPct(candles, anchorIndex, horizonDays);
      if (!Number.isFinite(realized)) continue;
      records.push({
        validationMode: 'WALK_FORWARD_OOS',
        policyVersion: WALK_FORWARD_VALIDATOR_VERSION,
        historicalPatternPolicyVersion: pattern.policyVersion,
        instrumentId: input.instrumentId || null,
        assetClass: input.assetClass || 'UNKNOWN',
        horizon: horizonKey,
        tradingDays: horizonDays,
        forecastAt: new Date(forecastAt * 1000).toISOString(),
        outcomeKnownAt: new Date(candles[anchorIndex + horizonDays].timestamp * 1000).toISOString(),
        rawProbabilityPositive: horizon.rawProbabilityPositive,
        expectedReturnPct: horizon.expectedReturnPct,
        positiveOutcome: realized > 0 ? 1 : 0,
        realizedReturnPct: round(realized, 4),
        patternConfidenceScore: horizon.patternConfidenceScore,
        selectedAnalogCount: horizon.sample?.selectedAnalogCount || 0,
        effectiveSampleSize: horizon.sample?.effectiveSampleSize || 0,
      });
    }

    const calibration = evaluateForecastCalibration(records, {
      minimumTotal: minimumForecastsForMetrics,
      binCount: input.calibrationBinCount || 10,
    });
    const stability = subperiodStability(records, input.stabilitySegments || 4);
    byHorizon[horizonKey] = {
      tradingDays: horizonDays,
      forecastCount: records.length,
      records,
      calibration,
      stability,
      status: calibration.status === 'OOS_METRICS_READY' ? 'OOS_METRICS_READY' : 'INSUFFICIENT_OOS_HISTORY',
      promotionBlockers: [
        ...(calibration.status === 'OOS_METRICS_READY' ? [] : ['MINIMUM_OOS_FORECAST_SAMPLE_NOT_REACHED']),
        ...(stability.stable ? [] : ['SUBPERIOD_STABILITY_NOT_CONFIRMED']),
      ],
    };
  }

  const ready = Object.values(byHorizon).filter((item) => item.status === 'OOS_METRICS_READY').length;
  return {
    format: 'investor-control-walk-forward-validation',
    version: 1,
    policyVersion: WALK_FORWARD_VALIDATOR_VERSION,
    generatedAt,
    instrumentId: input.instrumentId || null,
    assetClass: input.assetClass || 'UNKNOWN',
    observationCount: candles.length,
    warmupObservations: warmup,
    evaluationStep,
    horizons: byHorizon,
    status: ready > 0 ? 'OOS_VALIDATION_AVAILABLE' : 'INSUFFICIENT_OOS_HISTORY',
    methodology: {
      validationMode: 'EXPANDING_WINDOW_WALK_FORWARD',
      forecastInformationBoundary: 'FORECAST_USES_ONLY_DATA_AVAILABLE_AT_FORECAST_AT',
      outcomeBoundary: 'REALIZED_OUTCOME_USED_ONLY_AFTER_HORIZON_ELAPSES',
      overlappingTrainingLabels: 'HISTORICAL_ANALOG_ENGINE_PURGES_ANALOG_ANCHORS',
      finalHoldoutUse: 'NOT_FOR_HYPERPARAMETER_SELECTION',
    },
    finalActionEligible: false,
  };
}
