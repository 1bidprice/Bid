function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function groupKey(record) {
  return record?.independenceGroup || record?.sourceName || record?.sourceUrl || null;
}

function recommendationGrade(record) {
  return record?.document?.reviewed === true && record?.claimType === 'FACT';
}

export function assessIndependentEvidence(records = [], nowInput = new Date()) {
  const now = new Date(nowInput);
  const valid = records.filter((record) => record && typeof record === 'object');
  const nonSocial = valid.filter((record) => record.sourceType !== 'SOCIAL_MEDIA');
  const nonStale = nonSocial.filter((record) => !record.expiresAt || new Date(record.expiresAt) >= now);
  const reliable = nonStale.filter((record) => Number(record.reliabilityTier) <= 3);
  const primary = reliable.filter((record) => record.isPrimarySource === true && record.claimType === 'FACT');
  const reviewedReliable = reliable.filter(recommendationGrade);
  const reviewedPrimary = reviewedReliable.filter((record) => record.isPrimarySource === true);
  const independentGroups = unique(reliable.map(groupKey));
  const primaryGroups = unique(primary.map(groupKey));
  const reviewedIndependentGroups = unique(reviewedReliable.map(groupKey));
  const reviewedPrimaryGroups = unique(reviewedPrimary.map(groupKey));
  const contentHashes = reliable.map((record) => record.contentHash).filter(Boolean);
  const duplicateHashCount = contentHashes.length - new Set(contentHashes).size;
  const contradictionCount = reliable.reduce(
    (total, record) => total + (Array.isArray(record.contradictsClaimIds) ? record.contradictsClaimIds.length : 0),
    0,
  );
  const explicitSupportCount = reliable.reduce(
    (total, record) => total + (Array.isArray(record.supportsClaimIds) ? record.supportsClaimIds.length : 0),
    0,
  );

  const discoveryReady = primary.length >= 1 || independentGroups.length >= 2;
  const recommendationReady =
    reviewedPrimaryGroups.length >= 1 &&
    reviewedIndependentGroups.length >= 2 &&
    contradictionCount === 0 &&
    reviewedReliable.length >= 2;

  const blockers = [];
  if (!valid.length) blockers.push('NO_EVIDENCE');
  if (!discoveryReady) blockers.push('INSUFFICIENT_RELIABLE_SUPPORT');
  if (primaryGroups.length < 1) blockers.push('PRIMARY_SOURCE_REQUIRED');
  if (independentGroups.length < 2) blockers.push('INDEPENDENT_CORROBORATION_REQUIRED');
  if (reviewedPrimaryGroups.length < 1) blockers.push('REVIEWED_PRIMARY_SOURCE_REQUIRED');
  if (reviewedIndependentGroups.length < 2) blockers.push('REVIEWED_INDEPENDENT_CORROBORATION_REQUIRED');
  if (contradictionCount > 0) blockers.push('UNRESOLVED_CONTRADICTION');
  if (duplicateHashCount > 0 && reviewedIndependentGroups.length < 2) blockers.push('DUPLICATE_CONTENT_NOT_INDEPENDENT');

  return {
    format: 'investor-control-evidence-cross-check',
    version: 2,
    evidenceCount: valid.length,
    reliableEvidenceCount: reliable.length,
    primaryEvidenceCount: primary.length,
    reviewedReliableEvidenceCount: reviewedReliable.length,
    primaryGroupCount: primaryGroups.length,
    independentGroupCount: independentGroups.length,
    reviewedPrimaryGroupCount: reviewedPrimaryGroups.length,
    reviewedIndependentGroupCount: reviewedIndependentGroups.length,
    duplicateHashCount,
    contradictionCount,
    explicitSupportCount,
    discoveryReady,
    recommendationReady,
    blockers: unique(blockers),
    groups: independentGroups,
    reviewedGroups: reviewedIndependentGroups,
  };
}
