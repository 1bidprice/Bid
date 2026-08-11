export const FORECAST_FACTOR_SCORE_VERSION = '2026-08-11.1';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function buildForecastFactorScore(featureVector = {}, options = {}) {
  const features = (Array.isArray(featureVector.features) ? featureVector.features : []).filter((feature) => feature?.available === true && Number.isFinite(Number(feature.value)) && Number(feature.weight) > 0);
  const minimumDomainCount = Math.max(2, Number(options.minimumFactorDomainCount || 3));
  const minimumWeightCoverage = Math.max(0, Math.min(1, Number(options.minimumFactorWeightCoverage ?? 0.45)));
  const minimumEvidenceQualityScore = Math.max(0, Math.min(100, Number(options.minimumFactorEvidenceQualityScore ?? 50)));
  const availableWeight = features.reduce((sum, feature) => sum + Number(feature.weight || 0), 0);
  const weightedSum = features.reduce((sum, feature) => sum + Number(feature.value) * Number(feature.weight), 0);
  const rawLatentScore = availableWeight > 0 ? clamp(weightedSum / availableWeight) : null;
  const evidenceQualityScore = finite(featureVector.evidenceQualityScore);
  const contradictionCount = Math.max(0, Number(featureVector.contradictionCount || 0));
  const blockers = [];

  if (features.length < minimumDomainCount) blockers.push('INSUFFICIENT_VERIFIED_FACTOR_DOMAINS');
  if (availableWeight < minimumWeightCoverage) blockers.push('INSUFFICIENT_FACTOR_WEIGHT_COVERAGE');
  if (evidenceQualityScore === null || evidenceQualityScore < minimumEvidenceQualityScore) blockers.push('EVIDENCE_QUALITY_TOO_LOW_FOR_LATENT_SCORE');
  if (contradictionCount > 0) blockers.push('UNRESOLVED_CONTRADICTION');

  const risk = features.find((feature) => feature.domain === 'RISK') || null;
  const severeRiskStrength = finite(risk?.maxNegativeStrength) ?? 0;
  let riskCap = null;
  if (severeRiskStrength >= 0.95) riskCap = 0;
  else if (severeRiskStrength >= 0.85) riskCap = 0.15;

  const cappedScore = rawLatentScore === null
    ? null
    : riskCap === null
      ? rawLatentScore
      : Math.min(rawLatentScore, riskCap);
  const latentScore = blockers.length ? null : cappedScore;
  const directionalTilt = latentScore === null
    ? 'UNAVAILABLE'
    : latentScore >= 0.15
      ? 'POSITIVE_TILT'
      : latentScore <= -0.15
        ? 'NEGATIVE_TILT'
        : 'NEUTRAL_TILT';

  return {
    format: 'investor-control-forecast-factor-score',
    version: 1,
    policyVersion: FORECAST_FACTOR_SCORE_VERSION,
    instrumentId: featureVector.instrumentId || null,
    assetClass: featureVector.assetClass || 'UNKNOWN',
    horizon: featureVector.horizon || null,
    status: blockers.length ? 'RESEARCH_SCORE_BLOCKED' : 'LATENT_SCORE_READY',
    scoreScale: [-1, 1],
    rawLatentScore: round(rawLatentScore),
    latentScore: round(latentScore),
    directionalTilt,
    availableDomainCount: features.length,
    availableWeight: round(availableWeight, 4),
    minimumDomainCount,
    minimumWeightCoverage,
    evidenceQualityScore: round(evidenceQualityScore, 2),
    contradictionCount,
    riskControl: {
      severeNegativeRiskStrength: round(severeRiskStrength),
      capApplied: riskCap !== null,
      maximumPositiveLatentScore: riskCap,
    },
    domainContributions: features.map((feature) => ({
      domain: feature.domain,
      value: round(Number(feature.value)),
      weight: round(Number(feature.weight), 4),
      weightedContribution: round(Number(feature.value) * Number(feature.weight)),
      verifiedDriverCount: Number(feature.verifiedDriverCount || 0),
      evidenceIds: Array.isArray(feature.evidenceIds) ? feature.evidenceIds : [],
    })),
    blockers,
    methodology: {
      modelType: 'VERSIONED_DETERMINISTIC_MULTIFACTOR_LATENT_SCORE',
      calibrationRule: 'LATENT_SCORE_IS_NOT_A_PROBABILITY_AND_REQUIRES_FUTURE_LIVE_OOS_CALIBRATION',
      missingDataRule: 'MISSING_DOMAINS_ARE_EXCLUDED_NOT_ZERO_FILLED',
      decisionBoundary: 'SHADOW_RESEARCH_ONLY_NO_FINAL_ACTION_AUTHORITY',
    },
    decisionImpact: 'NONE',
    finalActionEligible: false,
  };
}
