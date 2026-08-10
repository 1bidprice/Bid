export const HISTORICAL_PATTERN_ENGINE_VERSION = '2026-08-11.1';

const DEFAULT_HORIZONS = Object.freeze({
  day1: 1,
  week1: 5,
  month1: 21,
  month3: 63,
  month6: 126,
  month12: 252,
});

const FEATURE_NAMES = Object.freeze([
  'return5Pct',
  'return20Pct',
  'return60Pct',
  'distanceSma20Pct',
  'distanceSma50Pct',
  'distanceSma200Pct',
  'annualizedVolatility20Pct',
  'annualizedVolatility60Pct',
  'maxDrawdown60Pct',
  'volumeRatio20',
  'shape60Pct',
  'shape40Pct',
  'shape20Pct',
  'shape10Pct',
  'shape5Pct',
]);

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function standardDeviation(values) {
  const valid = values.filter(Number.isFinite);
  if (valid.length < 2) return null;
  const average = mean(valid);
  const variance = valid.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (valid.length - 1);
  return Math.sqrt(variance);
}

function median(values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function weightedMean(values, weights) {
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i]) || !Number.isFinite(weights[i]) || weights[i] <= 0) continue;
    numerator += values[i] * weights[i];
    denominator += weights[i];
  }
  return denominator > 0 ? numerator / denominator : null;
}

function weightedQuantile(values, weights, q) {
  const pairs = values
    .map((value, index) => ({ value, weight: weights[index] }))
    .filter((item) => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (!pairs.length) return null;
  const total = pairs.reduce((sum, item) => sum + item.weight, 0);
  const target = total * clamp(q);
  let cumulative = 0;
  for (const pair of pairs) {
    cumulative += pair.weight;
    if (cumulative >= target) return pair.value;
  }
  return pairs[pairs.length - 1].value;
}

function effectiveSampleSize(weights) {
  const valid = weights.filter((weight) => Number.isFinite(weight) && weight > 0);
  const sum = valid.reduce((total, weight) => total + weight, 0);
  const squares = valid.reduce((total, weight) => total + (weight ** 2), 0);
  return squares > 0 ? (sum ** 2) / squares : 0;
}

export function normalizeHistoricalSeries(input = {}) {
  const raw = Array.isArray(input) ? input : (Array.isArray(input?.candles) ? input.candles : []);
  const byTimestamp = new Map();
  for (const candle of raw) {
    const timestamp = finite(candle?.timestamp);
    const close = finite(candle?.close);
    if (!Number.isFinite(timestamp) || !Number.isFinite(close) || close <= 0) continue;
    byTimestamp.set(timestamp, {
      timestamp,
      open: finite(candle?.open),
      high: finite(candle?.high),
      low: finite(candle?.low),
      close,
      volume: finite(candle?.volume),
    });
  }
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function percentageChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function sma(candles, index, length) {
  if (index - length + 1 < 0) return null;
  const values = candles.slice(index - length + 1, index + 1).map((item) => item.close);
  return mean(values);
}

function realizedVolatility(candles, index, length, periodsPerYear) {
  if (index - length < 0) return null;
  const returns = [];
  for (let i = index - length + 1; i <= index; i += 1) {
    const prior = candles[i - 1]?.close;
    const current = candles[i]?.close;
    if (prior > 0 && current > 0) returns.push(Math.log(current / prior));
  }
  const deviation = standardDeviation(returns);
  return Number.isFinite(deviation) ? deviation * Math.sqrt(periodsPerYear) * 100 : null;
}

function maxDrawdown(candles, index, length) {
  if (index - length + 1 < 0) return null;
  const values = candles.slice(index - length + 1, index + 1).map((item) => item.close);
  let peak = values[0];
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, ((value - peak) / peak) * 100);
  }
  return worst;
}

function volumeRatio(candles, index, length) {
  const current = candles[index]?.volume;
  if (!Number.isFinite(current) || index - length + 1 < 0) return null;
  const values = candles.slice(index - length + 1, index + 1).map((item) => item.volume).filter(Number.isFinite);
  const average = mean(values);
  return Number.isFinite(average) && average > 0 ? current / average : null;
}

function shapeReturn(candles, index, lag) {
  const prior = candles[index - lag]?.close;
  const current = candles[index]?.close;
  return percentageChange(current, prior);
}

function regimeFromFeatures(features) {
  const d50 = finite(features.distanceSma50Pct);
  const d200 = finite(features.distanceSma200Pct);
  if (d50 !== null && d200 !== null) {
    if (d50 > 0 && d200 > 0) return 'BULL_TREND';
    if (d50 < 0 && d200 < 0) return 'BEAR_TREND';
  }
  return 'MIXED_TREND';
}

export function extractHistoricalPatternFeatures(series, index, options = {}) {
  const candles = normalizeHistoricalSeries(series);
  const periodsPerYear = Math.max(1, Number(options.periodsPerYear || 252));
  if (!Number.isInteger(index) || index < 0 || index >= candles.length) return null;
  if (index < 200) return null;
  const close = candles[index].close;
  const sma20 = sma(candles, index, 20);
  const sma50 = sma(candles, index, 50);
  const sma200 = sma(candles, index, 200);
  const features = {
    return5Pct: shapeReturn(candles, index, 5),
    return20Pct: shapeReturn(candles, index, 20),
    return60Pct: shapeReturn(candles, index, 60),
    distanceSma20Pct: percentageChange(close, sma20),
    distanceSma50Pct: percentageChange(close, sma50),
    distanceSma200Pct: percentageChange(close, sma200),
    annualizedVolatility20Pct: realizedVolatility(candles, index, 20, periodsPerYear),
    annualizedVolatility60Pct: realizedVolatility(candles, index, 60, periodsPerYear),
    maxDrawdown60Pct: maxDrawdown(candles, index, 60),
    volumeRatio20: volumeRatio(candles, index, 20),
    shape60Pct: shapeReturn(candles, index, 60),
    shape40Pct: shapeReturn(candles, index, 40),
    shape20Pct: shapeReturn(candles, index, 20),
    shape10Pct: shapeReturn(candles, index, 10),
    shape5Pct: shapeReturn(candles, index, 5),
  };
  return {
    index,
    timestamp: candles[index].timestamp,
    close,
    regime: regimeFromFeatures(features),
    features: Object.fromEntries(Object.entries(features).map(([key, value]) => [key, round(value, 6)])),
  };
}

function robustScale(featureRows) {
  const scale = {};
  for (const key of FEATURE_NAMES) {
    const values = featureRows.map((row) => finite(row?.features?.[key])).filter(Number.isFinite);
    const center = median(values);
    const deviations = Number.isFinite(center) ? values.map((value) => Math.abs(value - center)) : [];
    const mad = median(deviations);
    const fallback = standardDeviation(values);
    const spread = Number.isFinite(mad) && mad > 1e-9 ? mad * 1.4826 : (Number.isFinite(fallback) && fallback > 1e-9 ? fallback : 1);
    scale[key] = { center: Number.isFinite(center) ? center : 0, spread };
  }
  return scale;
}

function patternDistance(current, candidate, scale, featureWeights = {}) {
  let weightedSquared = 0;
  let weightTotal = 0;
  let matched = 0;
  for (const key of FEATURE_NAMES) {
    const a = finite(current?.features?.[key]);
    const b = finite(candidate?.features?.[key]);
    if (a === null || b === null) continue;
    const weight = Math.max(0, finite(featureWeights[key]) ?? 1);
    if (weight <= 0) continue;
    const spread = scale[key]?.spread || 1;
    const z = (a - b) / spread;
    weightedSquared += weight * (z ** 2);
    weightTotal += weight;
    matched += 1;
  }
  if (!weightTotal || matched < 6) return null;
  return {
    distance: Math.sqrt(weightedSquared / weightTotal),
    matchedFeatureCount: matched,
  };
}

function similarityFromDistance(distance) {
  return Number.isFinite(distance) ? Math.exp(-0.5 * (distance ** 2)) : 0;
}

function futureReturnPct(candles, index, horizonDays) {
  const start = candles[index]?.close;
  const end = candles[index + horizonDays]?.close;
  return percentageChange(end, start);
}

function selectIndependentAnalogs(candidates, minimumSpacing, limit) {
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some((item) => Math.abs(item.index - candidate.index) < minimumSpacing)) continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

function horizonForecast(candles, currentSnapshot, horizonKey, horizonDays, options = {}) {
  const minimumHistory = Math.max(200, Number(options.minimumHistory || 260));
  const minAnalogCount = Math.max(5, Number(options.minAnalogCount || 18));
  const maxAnalogs = Math.max(minAnalogCount, Number(options.maxAnalogs || 60));
  const minEffectiveSample = Math.max(3, Number(options.minEffectiveSample || 10));
  const sameRegimeOnly = options.sameRegimeOnly !== false;
  const minimumSpacing = Math.max(1, Number(options.minimumAnchorSpacing || horizonDays));
  const maximumOutcomeIndex = currentSnapshot.index;
  const candidateRows = [];

  for (let index = minimumHistory; index + horizonDays <= maximumOutcomeIndex; index += 1) {
    const snapshot = extractHistoricalPatternFeatures(candles, index, options);
    if (!snapshot) continue;
    if (sameRegimeOnly && snapshot.regime !== currentSnapshot.regime) continue;
    const outcomeReturnPct = futureReturnPct(candles, index, horizonDays);
    if (!Number.isFinite(outcomeReturnPct)) continue;
    candidateRows.push({ ...snapshot, outcomeReturnPct });
  }

  if (candidateRows.length < minAnalogCount) {
    return {
      horizon: horizonKey,
      tradingDays: horizonDays,
      status: 'INSUFFICIENT_HISTORY',
      rawProbabilityPositive: null,
      probabilityPositive: null,
      expectedReturnPct: null,
      distribution: null,
      sample: {
        candidateCount: candidateRows.length,
        selectedAnalogCount: 0,
        effectiveSampleSize: 0,
        minimumRequired: minAnalogCount,
      },
      analogs: [],
      blockers: ['INSUFFICIENT_INDEPENDENT_HISTORICAL_ANALOGS'],
      finalActionEligible: false,
    };
  }

  const scale = robustScale([...candidateRows, currentSnapshot]);
  const scored = candidateRows
    .map((candidate) => {
      const compared = patternDistance(currentSnapshot, candidate, scale, options.featureWeights || {});
      if (!compared) return null;
      return {
        ...candidate,
        distance: compared.distance,
        similarity: similarityFromDistance(compared.distance),
        matchedFeatureCount: compared.matchedFeatureCount,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.similarity - a.similarity || b.timestamp - a.timestamp);

  const selected = selectIndependentAnalogs(scored, minimumSpacing, maxAnalogs);
  const weights = selected.map((item) => Math.max(1e-6, item.similarity));
  const outcomes = selected.map((item) => item.outcomeReturnPct);
  const effective = effectiveSampleSize(weights);
  const probabilityPositive = weightedMean(outcomes.map((value) => value > 0 ? 1 : 0), weights);
  const expected = weightedMean(outcomes, weights);
  const p10 = weightedQuantile(outcomes, weights, 0.10);
  const p25 = weightedQuantile(outcomes, weights, 0.25);
  const p50 = weightedQuantile(outcomes, weights, 0.50);
  const p75 = weightedQuantile(outcomes, weights, 0.75);
  const p90 = weightedQuantile(outcomes, weights, 0.90);
  const meanSimilarity = mean(selected.map((item) => item.similarity));
  const sufficient = selected.length >= minAnalogCount && effective >= minEffectiveSample;
  const confidence = sufficient
    ? Math.min(65, 25 + Math.min(20, selected.length / minAnalogCount * 10) + Math.min(15, effective / minEffectiveSample * 7.5) + Math.min(10, (meanSimilarity || 0) * 12))
    : Math.min(35, selected.length + effective);

  return {
    horizon: horizonKey,
    tradingDays: horizonDays,
    status: sufficient ? 'RESEARCH_READY_UNCALIBRATED' : 'INSUFFICIENT_HISTORY',
    rawProbabilityPositive: sufficient ? round(probabilityPositive, 4) : null,
    probabilityPositive: null,
    expectedReturnPct: sufficient ? round(expected, 4) : null,
    distribution: sufficient ? {
      p10ReturnPct: round(p10, 4),
      p25ReturnPct: round(p25, 4),
      medianReturnPct: round(p50, 4),
      p75ReturnPct: round(p75, 4),
      p90ReturnPct: round(p90, 4),
      downsideProbabilityPct: round((1 - probabilityPositive) * 100, 2),
      bullCaseReturnPct: round(p90, 4),
      baseCaseReturnPct: round(p50, 4),
      bearCaseReturnPct: round(p10, 4),
    } : null,
    patternConfidenceScore: round(confidence, 2),
    sample: {
      candidateCount: candidateRows.length,
      selectedAnalogCount: selected.length,
      effectiveSampleSize: round(effective, 2),
      minimumRequired: minAnalogCount,
      minimumSpacingTradingDays: minimumSpacing,
      meanSimilarity: round(meanSimilarity, 4),
    },
    analogs: selected.slice(0, Number(options.explainAnalogLimit || 8)).map((item) => ({
      anchorTimestamp: new Date(item.timestamp * 1000).toISOString(),
      anchorIndex: item.index,
      similarity: round(item.similarity, 4),
      outcomeReturnPct: round(item.outcomeReturnPct, 4),
      regime: item.regime,
      matchedFeatureCount: item.matchedFeatureCount,
      outcomeKnownByAsOf: item.index + horizonDays <= currentSnapshot.index,
    })),
    blockers: sufficient ? ['PROBABILITY_REQUIRES_WALK_FORWARD_CALIBRATION'] : ['INSUFFICIENT_INDEPENDENT_HISTORICAL_ANALOGS'],
    finalActionEligible: false,
  };
}

export function buildHistoricalPatternForecast(input = {}) {
  const candles = normalizeHistoricalSeries(input.series || input.candles || []);
  const asOfTimestamp = finite(input.asOfTimestamp) ?? (candles.at(-1)?.timestamp ?? null);
  const asOfIndex = candles.reduce((latest, candle, index) => candle.timestamp <= asOfTimestamp ? index : latest, -1);
  const periodsPerYear = Math.max(1, Number(input.periodsPerYear || (input.assetClass === 'CRYPTO' ? 365 : 252)));
  const options = { ...input, periodsPerYear };
  const currentSnapshot = extractHistoricalPatternFeatures(candles, asOfIndex, options);
  const horizons = input.horizons && typeof input.horizons === 'object' ? input.horizons : DEFAULT_HORIZONS;

  if (!currentSnapshot) {
    return {
      format: 'investor-control-historical-pattern-forecast',
      version: 1,
      policyVersion: HISTORICAL_PATTERN_ENGINE_VERSION,
      instrumentId: input.instrumentId || null,
      assetClass: input.assetClass || 'UNKNOWN',
      asOf: asOfTimestamp ? new Date(asOfTimestamp * 1000).toISOString() : null,
      status: 'INSUFFICIENT_HISTORY',
      currentPattern: null,
      horizons: {},
      calibrationStatus: 'NOT_CALIBRATED',
      finalActionEligible: false,
      blockers: ['MINIMUM_200_OBSERVATIONS_REQUIRED'],
    };
  }

  const horizonForecasts = Object.fromEntries(
    Object.entries(horizons).map(([key, days]) => [key, horizonForecast(candles, currentSnapshot, key, Math.max(1, Number(days)), options)]),
  );
  const readyCount = Object.values(horizonForecasts).filter((item) => item.status === 'RESEARCH_READY_UNCALIBRATED').length;

  return {
    format: 'investor-control-historical-pattern-forecast',
    version: 1,
    policyVersion: HISTORICAL_PATTERN_ENGINE_VERSION,
    instrumentId: input.instrumentId || null,
    assetClass: input.assetClass || 'UNKNOWN',
    asOf: new Date(currentSnapshot.timestamp * 1000).toISOString(),
    periodsPerYear,
    status: readyCount > 0 ? 'RESEARCH_READY_UNCALIBRATED' : 'INSUFFICIENT_HISTORY',
    currentPattern: {
      timestamp: new Date(currentSnapshot.timestamp * 1000).toISOString(),
      regime: currentSnapshot.regime,
      features: currentSnapshot.features,
    },
    horizons: horizonForecasts,
    methodology: {
      similarity: 'ROBUST_STANDARDIZED_EUCLIDEAN',
      weighting: 'EXPONENTIAL_DISTANCE_WEIGHT',
      temporalIndependence: 'PURGED_NON_OVERLAPPING_ANCHORS',
      lookAheadPolicy: 'OUTCOME_MUST_BE_KNOWN_BY_AS_OF',
      regimeConditioning: input.sameRegimeOnly === false ? 'DISABLED' : 'SAME_TREND_REGIME',
    },
    calibrationStatus: 'NOT_CALIBRATED',
    probabilitySemantics: 'rawProbabilityPositive is an empirical analog frequency; probabilityPositive remains null until walk-forward calibration passes.',
    finalActionEligible: false,
    blockers: ['WALK_FORWARD_CALIBRATION_REQUIRED', 'FINAL_ACTION_POLICY_MUST_REMAIN_SEPARATE'],
  };
}

export const HISTORICAL_PATTERN_DEFAULT_HORIZONS = DEFAULT_HORIZONS;
