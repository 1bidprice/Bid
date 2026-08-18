const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Number(value) || 0));

const unique = (items) => [...new Set(items.filter(Boolean))];

export function assessEvidence(records = [], nowInput = new Date()) {
  const now = new Date(nowInput);
  const valid = records.filter((record) => record && typeof record === 'object');
  const nonSocial = valid.filter((record) => record.sourceType !== 'SOCIAL_MEDIA');
  const primaryFacts = nonSocial.filter(
    (record) => record.isPrimarySource === true && record.claimType === 'FACT' && Number(record.reliabilityTier) <= 2,
  );
  const independentReliableGroups = unique(
    nonSocial
      .filter((record) => Number(record.reliabilityTier) <= 3 && ['FACT', 'CALCULATION_INPUT'].includes(record.claimType))
      .map((record) => record.independenceGroup || record.sourceName),
  );
  const stale = valid.filter((record) => record.expiresAt && new Date(record.expiresAt) < now);
  const rumours = valid.filter((record) => record.claimType === 'RUMOUR');
  const contradictionLinks = valid.reduce(
    (sum, record) => sum + (Array.isArray(record.contradictsClaimIds) ? record.contradictsClaimIds.length : 0),
    0,
  );

  const hasMinimumSupport = primaryFacts.length >= 1 || independentReliableGroups.length >= 2;
  const hasOnlySocial = valid.length > 0 && nonSocial.length === 0;
  const publishable = hasMinimumSupport && !hasOnlySocial && stale.length < valid.length;

  let qualityScore = 0;
  qualityScore += Math.min(45, primaryFacts.length * 45);
  qualityScore += Math.min(35, independentReliableGroups.length * 17.5);
  qualityScore += Math.min(20, nonSocial.filter((record) => Number(record.reliabilityTier) <= 2).length * 5);
  qualityScore -= stale.length * 12;
  qualityScore -= rumours.length * 8;
  qualityScore -= contradictionLinks * 10;
  if (hasOnlySocial) qualityScore = Math.min(qualityScore, 15);
  if (!hasMinimumSupport) qualityScore = Math.min(qualityScore, 39);

  const blockingReasons = [];
  if (!valid.length) blockingReasons.push('NO_EVIDENCE');
  if (hasOnlySocial) blockingReasons.push('SOCIAL_ONLY');
  if (!hasMinimumSupport) blockingReasons.push('INSUFFICIENT_INDEPENDENT_SUPPORT');
  if (stale.length === valid.length && valid.length) blockingReasons.push('ALL_EVIDENCE_STALE');

  return {
    publishable,
    qualityScore: clamp(qualityScore),
    primaryFactCount: primaryFacts.length,
    independentReliableSourceCount: independentReliableGroups.length,
    staleCount: stale.length,
    rumourCount: rumours.length,
    contradictionCount: contradictionLinks,
    blockingReasons,
  };
}

export function rankSignalCandidate(candidate, nowInput = new Date()) {
  const evidence = assessEvidence(candidate.evidence || [], nowInput);
  const fundamentals = clamp(candidate.fundamentalsScore);
  const catalyst = clamp(candidate.catalystScore);
  const priceConfirmation = clamp(candidate.priceConfirmationScore);
  const liquidity = clamp(candidate.liquidityScore);
  const personalisation = clamp(candidate.personalisationScore ?? 50);
  const risk = clamp(candidate.riskScore);
  const contradictionPenalty = clamp(candidate.contradictionPenalty);
  const stalenessPenalty = clamp(candidate.stalenessPenalty);

  const positive =
    evidence.qualityScore * 0.30 +
    fundamentals * 0.20 +
    catalyst * 0.16 +
    priceConfirmation * 0.12 +
    liquidity * 0.10 +
    personalisation * 0.12;

  const penalty = risk * 0.16 + contradictionPenalty * 0.10 + stalenessPenalty * 0.08;
  let rankingScore = clamp(positive - penalty);

  let category = candidate.category;
  let suggestedAction = 'WATCH';
  let status = 'ACTIVE';
  const reasons = [];

  if (!evidence.publishable) {
    category = 'INSUFFICIENT_EVIDENCE';
    suggestedAction = 'WATCH';
    status = 'DRAFT';
    rankingScore = Math.min(rankingScore, 39);
    reasons.push(...evidence.blockingReasons);
  } else if (evidence.qualityScore < 60) {
    suggestedAction = 'WATCH';
    reasons.push('LOW_DATA_QUALITY');
  } else if (liquidity < 25 || risk >= 90) {
    suggestedAction = 'AVOID';
    reasons.push(liquidity < 25 ? 'ILLIQUID' : 'EXTREME_RISK');
  } else if (candidate.hasPosition) {
    if (rankingScore >= 72) suggestedAction = 'HOLD';
    else if (rankingScore < 42) suggestedAction = 'CONSIDER_REDUCE';
    else suggestedAction = 'HOLD';
  } else if (rankingScore >= 74 && risk <= 70 && liquidity >= 45) {
    suggestedAction = 'CONSIDER_BUY';
  } else {
    suggestedAction = 'WATCH';
  }

  if (evidence.contradictionCount > 0) reasons.push('CONTRADICTORY_EVIDENCE');
  if (evidence.staleCount > 0) reasons.push('PARTLY_STALE_EVIDENCE');
  if (risk >= 70) reasons.push('HIGH_RISK');

  const confidenceScore = clamp(
    evidence.qualityScore * 0.55 +
      Math.min(fundamentals, catalyst) * 0.20 +
      priceConfirmation * 0.10 +
      liquidity * 0.05 +
      (100 - risk) * 0.10 -
      contradictionPenalty * 0.15,
  );

  return {
    category,
    suggestedAction,
    status,
    rankingScore: Number(rankingScore.toFixed(2)),
    confidenceScore: Number(confidenceScore.toFixed(2)),
    dataQualityScore: Number(evidence.qualityScore.toFixed(2)),
    evidenceAssessment: evidence,
    reasons: unique(reasons),
  };
}
