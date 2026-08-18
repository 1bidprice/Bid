import { evaluateForecastCalibration, evaluateForecastPromotionGate } from './forecast-calibration.js';

export const FORECAST_LEARNING_STATUS_VERSION = '2026-08-11.2';

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function binaryOutcome(value) {
  return value === 0 || value === 1;
}

function liveRecords(records = []) {
  return (Array.isArray(records) ? records : []).filter((record) => record?.validationMode === 'LIVE_SHADOW_OOS');
}

function validMatured(records = []) {
  return liveRecords(records).filter((record) =>
    record?.status === 'MATURED' &&
    binaryOutcome(record?.positiveOutcome) &&
    Number.isFinite(Number(record?.rawProbabilityPositive)),
  );
}

function groupKey(record = {}) {
  return `${record.assetClass || 'UNKNOWN'}|${record.horizon || 'UNKNOWN'}`;
}

function chronological(records = []) {
  return records.slice().sort((a, b) =>
    String(a.forecastAt || a.forecastSampleDate || '').localeCompare(String(b.forecastAt || b.forecastSampleDate || '')) ||
    String(a.forecastId || '').localeCompare(String(b.forecastId || '')),
  );
}

function splitContiguous(records, blockCount) {
  const sorted = chronological(records);
  const blocks = [];
  for (let index = 0; index < blockCount; index += 1) {
    const start = Math.floor(index * sorted.length / blockCount);
    const end = Math.floor((index + 1) * sorted.length / blockCount);
    blocks.push(sorted.slice(start, end));
  }
  return blocks;
}

export function evaluateForecastStability(records = [], options = {}) {
  const matured = validMatured(records);
  const blockCount = Math.max(2, Number(options.stabilityBlockCount || 3));
  const minimumSubperiodSample = Math.max(20, Number(options.minimumSubperiodSample || 40));
  const minimumStabilitySample = Math.max(blockCount * minimumSubperiodSample, Number(options.minimumStabilitySample || 150));
  const minimumSubperiodSkillPct = Number(options.minimumSubperiodSkillPct ?? 0);
  const maximumSubperiodEce = Number(options.maximumSubperiodEce ?? 0.15);
  const blockers = [];

  if (matured.length < minimumStabilitySample) {
    blockers.push('STABILITY_OOS_SAMPLE_TOO_SMALL');
    return {
      status: 'INSUFFICIENT_OOS_HISTORY',
      stableAcrossSubperiods: false,
      sampleSize: matured.length,
      blockers,
      thresholds: {
        blockCount,
        minimumStabilitySample,
        minimumSubperiodSample,
        minimumSubperiodSkillPct,
        maximumSubperiodEce,
      },
      subperiods: [],
    };
  }

  const blocks = splitContiguous(matured, blockCount);
  const subperiods = blocks.map((block, index) => {
    const calibration = evaluateForecastCalibration(block, {
      minimumTotal: minimumSubperiodSample,
      binCount: options.binCount || 10,
    });
    const localBlockers = [];
    if (block.length < minimumSubperiodSample || calibration.status !== 'OOS_METRICS_READY') {
      localBlockers.push('SUBPERIOD_OOS_SAMPLE_TOO_SMALL');
    }
    if (!Number.isFinite(Number(calibration.skillVsBaseRatePct)) || Number(calibration.skillVsBaseRatePct) < minimumSubperiodSkillPct) {
      localBlockers.push('SUBPERIOD_PROBABILISTIC_SKILL_NEGATIVE');
    }
    if (!Number.isFinite(Number(calibration.expectedCalibrationError)) || Number(calibration.expectedCalibrationError) > maximumSubperiodEce) {
      localBlockers.push('SUBPERIOD_CALIBRATION_ERROR_TOO_HIGH');
    }
    return {
      index,
      sampleSize: block.length,
      firstForecastAt: block[0]?.forecastAt || block[0]?.forecastSampleDate || null,
      lastForecastAt: block.at(-1)?.forecastAt || block.at(-1)?.forecastSampleDate || null,
      brierScore: calibration.brierScore,
      expectedCalibrationError: calibration.expectedCalibrationError,
      skillVsBaseRatePct: calibration.skillVsBaseRatePct,
      status: localBlockers.length ? 'UNSTABLE' : 'STABLE',
      blockers: localBlockers,
    };
  });

  const unstable = subperiods.filter((item) => item.status !== 'STABLE');
  if (unstable.length) blockers.push('PROBABILISTIC_SKILL_NOT_STABLE_ACROSS_SUBPERIODS');
  return {
    status: blockers.length ? 'UNSTABLE' : 'STABILITY_READY',
    stableAcrossSubperiods: blockers.length === 0,
    sampleSize: matured.length,
    blockers,
    thresholds: {
      blockCount,
      minimumStabilitySample,
      minimumSubperiodSample,
      minimumSubperiodSkillPct,
      maximumSubperiodEce,
    },
    subperiods,
  };
}

function learningGroup(records, options = {}) {
  const all = liveRecords(records);
  const matured = validMatured(all);
  const openCount = all.filter((record) => record?.status === 'OPEN').length;
  const invalidMaturedOutcomeCount = all.filter((record) => record?.status === 'MATURED' && !binaryOutcome(record?.positiveOutcome)).length;
  const minimumPromotionSample = Math.max(50, Number(options.minimumPromotionSample || 200));
  const calibrationMinimumTotal = Math.max(20, Number(options.calibrationMinimumTotal || 100));
  const calibration = evaluateForecastCalibration(matured, {
    minimumTotal: calibrationMinimumTotal,
    binCount: options.binCount || 10,
  });
  const promotion = evaluateForecastPromotionGate(calibration, {
    minimumSample: minimumPromotionSample,
    minimumSkillPct: options.minimumSkillPct ?? 5,
    maximumEce: options.maximumEce ?? 0.08,
  });
  const stability = evaluateForecastStability(matured, options);
  const blockers = [...new Set([
    ...promotion.blockers,
    ...stability.blockers,
    ...(invalidMaturedOutcomeCount ? ['INVALID_MATURED_BINARY_OUTCOME_RECORDS_EXCLUDED'] : []),
  ])];
  const promotionGateEligible = promotion.status === 'PROMOTION_ELIGIBLE' && stability.status === 'STABILITY_READY' && invalidMaturedOutcomeCount === 0;
  const remaining = Math.max(0, minimumPromotionSample - matured.length);
  return {
    assetClass: all[0]?.assetClass || 'UNKNOWN',
    horizon: all[0]?.horizon || 'UNKNOWN',
    liveOosRecordCount: all.length,
    openCount,
    maturedCount: matured.length,
    invalidMaturedOutcomeCount,
    maturityRatePct: all.length ? round(matured.length / all.length * 100) : 0,
    minimumPromotionSample,
    remainingMaturedSamplesToPromotionFloor: remaining,
    promotionSampleProgressPct: round(Math.min(1, matured.length / minimumPromotionSample) * 100),
    calibration,
    stability,
    promotionGate: {
      ...promotion,
      status: promotionGateEligible ? 'PROMOTION_CANDIDATE' : 'RESEARCH_ONLY',
      promotionGateEligible,
      forecastMayInfluenceFinalAction: false,
      decisionIntegrationEnabled: false,
      blockers,
    },
  };
}

export function buildForecastLearningStatus(input = {}) {
  const records = liveRecords(input.records || input.archive?.records || []);
  const groups = new Map();
  for (const record of records) {
    const key = groupKey(record);
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  }
  const groupStatuses = [...groups.values()]
    .map((group) => learningGroup(group, input.options || {}))
    .sort((a, b) => String(a.assetClass).localeCompare(String(b.assetClass)) || String(a.horizon).localeCompare(String(b.horizon)));
  const maturedCount = groupStatuses.reduce((sum, group) => sum + group.maturedCount, 0);
  const invalidMaturedOutcomeCount = groupStatuses.reduce((sum, group) => sum + group.invalidMaturedOutcomeCount, 0);
  const openCount = records.filter((record) => record?.status === 'OPEN').length;
  const candidateGroups = groupStatuses.filter((group) => group.promotionGate.promotionGateEligible).length;
  return {
    format: 'investor-control-forecast-learning-status',
    version: 1,
    policyVersion: FORECAST_LEARNING_STATUS_VERSION,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    source: 'LIVE_SHADOW_OOS_ONLY',
    status: candidateGroups ? 'PROMOTION_CANDIDATES_EXIST' : 'RESEARCH_ONLY',
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    liveOosRecordCount: records.length,
    openCount,
    maturedCount,
    invalidMaturedOutcomeCount,
    groupCount: groupStatuses.length,
    promotionCandidateGroupCount: candidateGroups,
    globalBlockers: candidateGroups ? ['DECISION_ENGINE_INTEGRATION_NOT_ENABLED'] : ['NO_FORECAST_GROUP_PASSED_PROMOTION_AND_STABILITY_GATES'],
    groups: groupStatuses,
  };
}
