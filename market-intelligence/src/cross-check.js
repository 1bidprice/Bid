function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function groupKey(record) {
  return record?.independenceGroup || record?.sourceName || record?.sourceUrl || null;
}

export function assessIndependentEvidence(records = [], nowInput = new Date()) {
  const now = new Date(nowInput);
  const valid = records.filter((record) => record && typeof record === 'object');
  const nonSocial = valid.filter((record) => record.sourceType !== 'SOCIAL_MEDIA');
  const nonStale = nonSocial.filter((record) => !record.expiresAt || new Date(record.expiresAt) >= now);
  const reliable = nonStale.filter((record) => Number(record.reliabilityTier) <= 3);
  const primary = reliable.filter((record) => record.isPrimarySource === true && record.claimType === 'FACT');
  const independentGroups = unique(reliable.map(groupKey));
  const primaryGroups = unique(primary.map(groupKey));
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
    primaryGroups.length >= 1 &&
    independentGroups.length >= 2 &&
    contradictionCount === 0 &&
    reliable.length >= 2;

  const blockers = [];
  if (!valid.length) blockers.push('NO_EVIDENCE');
  if (!discoveryReady) blockers.push('INSUFFICIENT_RELIABLE_SUPPORT');
  if (primaryGroups.length < 1) blockers.push('PRIMARY_SOURCE_REQUIRED');
  if (independentGroups.length < 2) blockers.push('INDEPENDENT_CORROBORATION_REQUIRED');
  if (contradictionCount > 0) blockers.push('UNRESOLVED_CONTRADICTION');
  if (duplicateHashCount > 0 && independentGroups.length < 2) blockers.push('DUPLICATE_CONTENT_NOT_INDEPENDENT');

  return {
    format: 'investor-control-evidence-cross-check',
    version: 1,
    evidenceCount: valid.length,
    reliableEvidenceCount: reliable.length,
    primaryEvidenceCount: primary.length,
    primaryGroupCount: primaryGroups.length,
    independentGroupCount: independentGroups.length,
    duplicateHashCount,
    contradictionCount,
    explicitSupportCount,
    discoveryReady,
    recommendationReady,
    blockers: unique(blockers),
    groups: independentGroups,
  };
}
