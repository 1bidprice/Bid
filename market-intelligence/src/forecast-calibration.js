export const FORECAST_CALIBRATION_VERSION = '2026-08-11.3';

const OOS_VALIDATION_MODES = new Set(['WALK_FORWARD_OOS', 'LIVE_SHADOW_OOS']);

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function binaryOutcome(value) {
  return value === 0 || value === 1;
}

function validRecord(record) {
  const probability = Number(record?.rawProbabilityPositive ?? record?.probability);
  const outcome = record?.positiveOutcome ?? record?.outcome;
  return OOS_VALIDATION_MODES.has(record?.validationMode) &&
    Number.isFinite(probability) && probability >= 0 && probability <= 1 &&
    binaryOutcome(outcome);
}

function oosRecords(records = []) {
  return records.filter(validRecord).map((record) => ({
    probability: Number(record.rawProbabilityPositive ?? record.probability),
    outcome: record.positiveOutcome ?? record.outcome,
    timestamp: record.timestamp || record.forecastAt || null,
    validationMode: record.validationMode,
  }));
}

function makeBins(records, binCount) {
  const bins = Array.from({ length: binCount }, (_, index) => ({
    index,
    lower: index / binCount,
    upper: (index + 1) / binCount,
    count: 0,
    probabilitySum: 0,
    outcomeSum: 0,
  }));
  for (const record of records) {
    const index = Math.min(binCount - 1, Math.floor(record.probability * binCount));
    const bin = bins[index];
    bin.count += 1;
    bin.probabilitySum += record.probability;
    bin.outcomeSum += record.outcome;
  }
  return bins.map((bin) => ({
    ...bin,
    meanForecast: bin.count ? bin.probabilitySum / bin.count : null,
    empiricalRate: bin.count ? bin.outcomeSum / bin.count : null,
  }));
}

export function evaluateForecastCalibration(records = [], options = {}) {
  const valid = oosRecords(records);
  const minimumTotal = Math.max(20, Number(options.minimumTotal || 100));
  const binCount = Math.max(4, Number(options.binCount || 10));
  if (!valid.length) {
    return {
      format: 'investor-control-forecast-calibration',
      version: 1,
      policyVersion: FORECAST_CALIBRATION_VERSION,
      status: 'INSUFFICIENT_OOS_HISTORY',
      sampleSize: 0,
      brierScore: null,
      logLoss: null,
      expectedCalibrationError: null,
      baseRate: null,
      naiveBrierScore: null,
      skillVsBaseRatePct: null,
      validationModes: [],
      bins: [],
      blockers: ['OOS_FORECAST_RECORDS_REQUIRED'],
    };
  }

  const baseRate = valid.reduce((sum, item) => sum + item.outcome, 0) / valid.length;
  const brier = valid.reduce((sum, item) => sum + ((item.probability - item.outcome) ** 2), 0) / valid.length;
  const epsilon = 1e-9;
  const logLoss = -valid.reduce((sum, item) => {
    const p = Math.min(1 - epsilon, Math.max(epsilon, item.probability));
    return sum + item.outcome * Math.log(p) + (1 - item.outcome) * Math.log(1 - p);
  }, 0) / valid.length;
  const naiveBrier = valid.reduce((sum, item) => sum + ((baseRate - item.outcome) ** 2), 0) / valid.length;
  const bins = makeBins(valid, binCount);
  const ece = bins.reduce((sum, bin) => {
    if (!bin.count) return sum;
    return sum + (bin.count / valid.length) * Math.abs(bin.meanForecast - bin.empiricalRate);
  }, 0);
  const skill = naiveBrier > 0 ? ((naiveBrier - brier) / naiveBrier) * 100 : null;

  return {
    format: 'investor-control-forecast-calibration',
    version: 1,
    policyVersion: FORECAST_CALIBRATION_VERSION,
    status: valid.length >= minimumTotal ? 'OOS_METRICS_READY' : 'INSUFFICIENT_OOS_HISTORY',
    sampleSize: valid.length,
    brierScore: round(brier),
    logLoss: round(logLoss),
    expectedCalibrationError: round(ece),
    baseRate: round(baseRate),
    naiveBrierScore: round(naiveBrier),
    skillVsBaseRatePct: round(skill, 2),
    validationModes: [...new Set(valid.map((item) => item.validationMode))].sort(),
    bins: bins.map((bin) => ({
      index: bin.index,
      lower: round(bin.lower, 4),
      upper: round(bin.upper, 4),
      count: bin.count,
      meanForecast: round(bin.meanForecast, 4),
      empiricalRate: round(bin.empiricalRate, 4),
    })),
    blockers: valid.length >= minimumTotal ? [] : ['MINIMUM_OOS_SAMPLE_NOT_REACHED'],
  };
}

export function calibrateForecastProbability(rawProbability, records = [], options = {}) {
  const raw = Number(rawProbability);
  const valid = oosRecords(records);
  const minimumTotal = Math.max(20, Number(options.minimumTotal || 100));
  const minimumBin = Math.max(5, Number(options.minimumBin || 20));
  const binCount = Math.max(4, Number(options.binCount || 10));
  const priorStrength = Math.max(0, Number(options.priorStrength ?? 20));

  if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
    return { status: 'INVALID_RAW_PROBABILITY', rawProbability: null, calibratedProbability: null, blockers: ['RAW_PROBABILITY_0_TO_1_REQUIRED'] };
  }
  if (valid.length < minimumTotal) {
    return { status: 'NOT_CALIBRATED', rawProbability: round(raw, 4), calibratedProbability: null, sampleSize: valid.length, blockers: ['MINIMUM_OOS_SAMPLE_NOT_REACHED'] };
  }

  const baseRate = valid.reduce((sum, item) => sum + item.outcome, 0) / valid.length;
  const bins = makeBins(valid, binCount);
  const index = Math.min(binCount - 1, Math.floor(raw * binCount));
  const bin = bins[index];
  if (!bin || bin.count < minimumBin) {
    return {
      status: 'NOT_CALIBRATED',
      rawProbability: round(raw, 4),
      calibratedProbability: null,
      sampleSize: valid.length,
      localSampleSize: bin?.count || 0,
      blockers: ['LOCAL_OOS_BIN_TOO_SMALL'],
    };
  }

  const calibrated = (bin.outcomeSum + baseRate * priorStrength) / (bin.count + priorStrength);
  return {
    status: 'CALIBRATED',
    policyVersion: FORECAST_CALIBRATION_VERSION,
    rawProbability: round(raw, 4),
    calibratedProbability: round(clamp(calibrated), 4),
    sampleSize: valid.length,
    localSampleSize: bin.count,
    baseRate: round(baseRate, 4),
    localEmpiricalRate: round(bin.empiricalRate, 4),
    validationModes: [...new Set(valid.map((item) => item.validationMode))].sort(),
    method: 'OOS_HISTOGRAM_BETA_SHRINKAGE',
    blockers: [],
  };
}

export function evaluateForecastPromotionGate(calibrationSummary, options = {}) {
  const minimumSample = Math.max(50, Number(options.minimumSample || 200));
  const minimumSkillPct = Number(options.minimumSkillPct ?? 5);
  const maximumEce = Number(options.maximumEce ?? 0.08);
  const blockers = [];
  if (!calibrationSummary || calibrationSummary.status !== 'OOS_METRICS_READY') blockers.push('OOS_CALIBRATION_METRICS_NOT_READY');
  if (Number(calibrationSummary?.sampleSize || 0) < minimumSample) blockers.push('OOS_SAMPLE_TOO_SMALL_FOR_PROMOTION');
  if (!Number.isFinite(Number(calibrationSummary?.skillVsBaseRatePct)) || Number(calibrationSummary.skillVsBaseRatePct) < minimumSkillPct) blockers.push('INSUFFICIENT_PROBABILISTIC_SKILL');
  if (!Number.isFinite(Number(calibrationSummary?.expectedCalibrationError)) || Number(calibrationSummary.expectedCalibrationError) > maximumEce) blockers.push('CALIBRATION_ERROR_TOO_HIGH');
  return {
    status: blockers.length ? 'RESEARCH_ONLY' : 'PROMOTION_ELIGIBLE',
    forecastMayInfluenceFinalAction: blockers.length === 0,
    blockers,
    thresholds: { minimumSample, minimumSkillPct, maximumEce },
  };
}

export const FORECAST_OOS_VALIDATION_MODES = Object.freeze([...OOS_VALIDATION_MODES]);
