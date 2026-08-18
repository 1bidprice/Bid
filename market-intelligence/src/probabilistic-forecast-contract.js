import { evaluateForecastPromotionGate } from './forecast-calibration.js';

export const PROBABILISTIC_FORECAST_CONTRACT_VERSION = '2026-08-11.1';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function normalizedDrivers(drivers = []) {
  return (Array.isArray(drivers) ? drivers : [])
    .filter((driver) => driver && driver.name && driver.explanation)
    .map((driver) => ({
      name: String(driver.name),
      family: driver.family || 'OTHER',
      direction: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'].includes(driver.direction) ? driver.direction : 'NEUTRAL',
      strengthScore: round(Math.max(0, Math.min(100, finite(driver.strengthScore) ?? 0)), 2),
      verified: driver.verified === true,
      explanation: String(driver.explanation),
      evidenceIds: [...new Set((Array.isArray(driver.evidenceIds) ? driver.evidenceIds : []).filter(Boolean))],
      sourceCount: Math.max(0, Number(driver.sourceCount || 0)),
      asOf: driver.asOf || null,
    }));
}

function horizonContract(patternHorizon, calibration, promotion, evidenceQualityScore) {
  if (!patternHorizon) return null;
  const calibrated = calibration?.status === 'CALIBRATED' ? finite(calibration.calibratedProbability) : null;
  return {
    tradingDays: Number(patternHorizon.tradingDays || 0),
    status: calibrated !== null ? 'CALIBRATED_RESEARCH' : patternHorizon.status,
    rawPatternProbabilityPositive: finite(patternHorizon.rawProbabilityPositive),
    probabilityPositive: calibrated,
    expectedReturnPct: finite(patternHorizon.expectedReturnPct),
    distribution: patternHorizon.distribution || null,
    patternConfidenceScore: finite(patternHorizon.patternConfidenceScore),
    evidenceQualityScore: finite(evidenceQualityScore),
    calibration: calibration || { status: 'NOT_CALIBRATED', calibratedProbability: null },
    promotion: promotion || { status: 'RESEARCH_ONLY', forecastMayInfluenceFinalAction: false, blockers: ['OOS_PROMOTION_GATE_NOT_EVALUATED'] },
    sample: patternHorizon.sample || null,
    historicalAnalogs: patternHorizon.analogs || [],
    blockers: [...new Set([
      ...(patternHorizon.blockers || []),
      ...(calibration?.blockers || []),
      ...(promotion?.blockers || []),
    ])],
    forecastMayInfluenceFinalAction: calibrated !== null && promotion?.forecastMayInfluenceFinalAction === true,
  };
}

export function buildProbabilisticForecastContract(input = {}) {
  const pattern = input.historicalPatternForecast || null;
  const drivers = normalizedDrivers(input.drivers);
  const evidenceQualityScore = Math.max(0, Math.min(100, finite(input.evidenceQualityScore) ?? 0));
  const contradictionCount = Math.max(0, Number(input.contradictionCount || 0));
  const calibrations = input.calibrationByHorizon || {};
  const calibrationSummaries = input.calibrationSummaryByHorizon || {};
  const promotionOptions = input.promotionOptions || {};
  const horizons = {};

  for (const [key, patternHorizon] of Object.entries(pattern?.horizons || {})) {
    const calibrationSummary = calibrationSummaries[key] || null;
    const promotion = calibrationSummary ? evaluateForecastPromotionGate(calibrationSummary, promotionOptions) : null;
    horizons[key] = horizonContract(patternHorizon, calibrations[key] || null, promotion, evidenceQualityScore);
  }

  const promotable = Object.values(horizons).filter((item) => item?.forecastMayInfluenceFinalAction === true);
  const verifiedDrivers = drivers.filter((driver) => driver.verified);
  const supporting = verifiedDrivers.filter((driver) => driver.direction === 'POSITIVE');
  const opposing = verifiedDrivers.filter((driver) => driver.direction === 'NEGATIVE');
  const unknowns = [...new Set((Array.isArray(input.unknowns) ? input.unknowns : []).filter(Boolean))];
  const invalidationConditions = [...new Set((Array.isArray(input.invalidationConditions) ? input.invalidationConditions : []).filter(Boolean))];
  const globalBlockers = [];
  if (!pattern) globalBlockers.push('HISTORICAL_PATTERN_FORECAST_REQUIRED');
  if (evidenceQualityScore < Number(input.minimumEvidenceQualityScore ?? 70)) globalBlockers.push('EVIDENCE_QUALITY_TOO_LOW');
  if (contradictionCount > 0) globalBlockers.push('UNRESOLVED_CONTRADICTION');
  if (!promotable.length) globalBlockers.push('NO_CALIBRATED_OOS_FORECAST_HORIZON');

  return {
    format: 'investor-control-probabilistic-forecast',
    version: 1,
    policyVersion: PROBABILISTIC_FORECAST_CONTRACT_VERSION,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    instrument: {
      instrumentId: input.instrumentId || pattern?.instrumentId || null,
      displayName: input.displayName || null,
      assetClass: input.assetClass || pattern?.assetClass || 'UNKNOWN',
      symbol: input.symbol || null,
      exchange: input.exchange || null,
    },
    asOf: input.asOf || pattern?.asOf || null,
    horizons,
    explainability: {
      supportingDrivers: supporting,
      opposingDrivers: opposing,
      neutralDrivers: verifiedDrivers.filter((driver) => driver.direction === 'NEUTRAL'),
      unverifiedDriversExcludedFromDecision: drivers.filter((driver) => !driver.verified),
      unknowns,
      invalidationConditions,
      evidenceQualityScore: round(evidenceQualityScore, 2),
      contradictionCount,
    },
    methodology: {
      historicalPatternPolicyVersion: pattern?.policyVersion || null,
      probabilityRule: 'CALIBRATED_PROBABILITY_ONLY_FROM_WALK_FORWARD_OOS_HISTORY',
      scoreRule: 'CONFIDENCE_AND_EVIDENCE_SCORES_ARE_NOT_PROBABILITIES',
      decisionBoundary: 'FORECAST_MAY_INFLUENCE_BUT_NEVER_BYPASS_FINAL_ACTION_AND_RISK_GATES',
    },
    status: globalBlockers.length ? 'RESEARCH_ONLY' : 'FORECAST_PROMOTION_ELIGIBLE',
    forecastMayInfluenceFinalAction: globalBlockers.length === 0,
    finalActionEligible: false,
    finalActionPolicy: 'SEPARATE_FINAL_ACTION_ENGINE_REQUIRED',
    blockers: globalBlockers,
  };
}
