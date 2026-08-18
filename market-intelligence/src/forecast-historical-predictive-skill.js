import { evaluateForecastPromotionGate } from './forecast-calibration.js';

export const FORECAST_HISTORICAL_PREDICTIVE_SKILL_VERSION = '2026-08-13.1';
export const FORECAST_HISTORICAL_PREDICTIVE_SKILL_CONTRACT = 'HISTORICAL_PREDICTIVE_SKILL_RESEARCH_GATE_V1';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function blockerCounts(results = []) {
  const counts = new Map();
  for (const result of results) {
    for (const blocker of new Set(Array.isArray(result?.blockers) ? result.blockers : [])) {
      if (typeof blocker !== 'string' || !blocker) continue;
      counts.set(blocker, (counts.get(blocker) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([code, groupCount]) => ({ code, groupCount }))
    .sort((left, right) => right.groupCount - left.groupCount || left.code.localeCompare(right.code));
}

export function evaluateHistoricalPredictiveSkillGate(group = {}, options = {}) {
  const evaluationReady = group?.status === 'HISTORICAL_REGIME_RESEARCH_READY';
  const canonicalGate = evaluateForecastPromotionGate(group?.calibration, {
    minimumSample: options.minimumSample ?? 200,
    minimumSkillPct: options.minimumSkillPct ?? 5,
    maximumEce: options.maximumEce ?? 0.08,
  });
  const qualityBlockers = Array.isArray(canonicalGate?.blockers) ? canonicalGate.blockers : [];
  const blockers = evaluationReady
    ? [...new Set(qualityBlockers)]
    : [...new Set(['HISTORICAL_EVALUATION_NOT_READY', ...qualityBlockers])];
  const predictiveSkillReady = evaluationReady && blockers.length === 0;

  return {
    format: 'investor-control-historical-predictive-skill-gate',
    version: 1,
    policyVersion: FORECAST_HISTORICAL_PREDICTIVE_SKILL_VERSION,
    contract: FORECAST_HISTORICAL_PREDICTIVE_SKILL_CONTRACT,
    historicalPatternPolicyVersion: group?.historicalPatternPolicyVersion || null,
    assetClass: group?.assetClass || 'UNKNOWN',
    horizon: group?.horizon || null,
    regimeKey: group?.regimeKey || null,
    historicalEvaluationStatus: group?.status || 'UNAVAILABLE',
    status: !evaluationReady
      ? 'HISTORICAL_PREDICTIVE_SKILL_NOT_EVALUABLE'
      : predictiveSkillReady
        ? 'HISTORICAL_PREDICTIVE_SKILL_READY'
        : 'HISTORICAL_PREDICTIVE_SKILL_NOT_READY',
    sampleSize: Number(group?.calibration?.sampleSize || 0),
    skillVsBaseRatePct: finite(group?.calibration?.skillVsBaseRatePct),
    expectedCalibrationError: finite(group?.calibration?.expectedCalibrationError),
    thresholds: {
      minimumSample: canonicalGate.thresholds.minimumSample,
      minimumSkillPct: canonicalGate.thresholds.minimumSkillPct,
      maximumEce: canonicalGate.thresholds.maximumEce,
    },
    blockers,
    historicalResearchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

export function buildHistoricalPredictiveSkillSummary(groups = [], options = {}) {
  const sourceGroups = Array.isArray(groups) ? groups : [];
  const results = sourceGroups.map((group) => evaluateHistoricalPredictiveSkillGate(group, options));
  const evaluationReadyGroupCount = results.filter((result) => result.historicalEvaluationStatus === 'HISTORICAL_REGIME_RESEARCH_READY').length;
  const predictiveSkillReadyGroupCount = results.filter((result) => result.status === 'HISTORICAL_PREDICTIVE_SKILL_READY').length;
  const predictiveSkillNotReadyGroupCount = results.filter((result) => result.status === 'HISTORICAL_PREDICTIVE_SKILL_NOT_READY').length;
  const notEvaluableGroupCount = results.filter((result) => result.status === 'HISTORICAL_PREDICTIVE_SKILL_NOT_EVALUABLE').length;

  return {
    format: 'investor-control-historical-predictive-skill-summary',
    version: 1,
    policyVersion: FORECAST_HISTORICAL_PREDICTIVE_SKILL_VERSION,
    contract: FORECAST_HISTORICAL_PREDICTIVE_SKILL_CONTRACT,
    status: predictiveSkillReadyGroupCount > 0
      ? 'PREDICTIVE_SKILL_READY_GROUPS_EXIST'
      : 'NO_PREDICTIVE_SKILL_READY_GROUPS',
    groupCount: results.length,
    evaluationReadyGroupCount,
    predictiveSkillReadyGroupCount,
    predictiveSkillNotReadyGroupCount,
    notEvaluableGroupCount,
    blockerCounts: blockerCounts(results),
    groups: results,
    rawHistoricalRecordsIncluded: false,
    rawHistoricalCandlesIncluded: false,
    historicalResearchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}
