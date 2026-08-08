import { contentHash } from './content-hash.js';
import { classifyEvidenceEvent } from './event-classifier.js';

const EVENT_STATEMENTS = Object.freeze({
  SHARE_BUYBACK: 'The company announced or executed a share repurchase event.',
  EQUITY_ISSUANCE_OR_DILUTION: 'The company announced or executed an equity issuance or dilution event.',
  DEBT_OR_REFINANCING: 'The company announced or executed a debt financing or refinancing event.',
  FINANCIAL_RESULTS: 'The company published a financial results event.',
  OPERATIONAL_MILESTONE: 'The company announced or completed an operational milestone.',
  LEGAL_OR_SETTLEMENT: 'The company disclosed a legal, litigation or settlement event.',
  UNCLASSIFIED_OFFICIAL_EVENT: 'The company published a material event that remains unclassified.',
});

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function groupKey(record) {
  return record?.independenceGroup || record?.sourceName || record?.sourceUrl || null;
}

function eventTime(record) {
  const date = new Date(record?.eventAt || record?.publishedAt || record?.retrievedAt || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function windowStart(record, windowDays) {
  const date = eventTime(record);
  if (!date) return 'unknown';
  const windowMs = windowDays * 86_400_000;
  return new Date(Math.floor(date.getTime() / windowMs) * windowMs).toISOString().slice(0, 10);
}

function companyId(record) {
  return record?.companyIds?.[0] || 'company:unknown';
}

function recordGrade(record, now) {
  const stale = record?.expiresAt && new Date(record.expiresAt) < now;
  const reliable = !stale && record?.sourceType !== 'SOCIAL_MEDIA' && Number(record?.reliabilityTier) <= 3;
  const reviewedFact = reliable && record?.document?.reviewed === true && record?.claimType === 'FACT';
  return { stale: Boolean(stale), reliable, reviewedFact };
}

export function linkEvidenceClaims(records = [], options = {}) {
  const now = new Date(options.now || Date.now());
  const windowDays = Math.max(1, Number(options.windowDays || 14));
  const clusters = new Map();

  for (const record of records.filter(Boolean)) {
    const classification = classifyEvidenceEvent(record);
    const eventType = classification.eventType;
    const key = `${companyId(record)}|${eventType}|${windowStart(record, windowDays)}`;
    if (!clusters.has(key)) {
      clusters.set(key, {
        companyId: companyId(record),
        eventType,
        category: classification.category,
        windowStart: windowStart(record, windowDays),
        records: [],
      });
    }
    clusters.get(key).records.push(record);
  }

  return [...clusters.values()].map((cluster) => {
    const reliableRecords = cluster.records.filter((record) => recordGrade(record, now).reliable);
    const reviewedFacts = reliableRecords.filter((record) => recordGrade(record, now).reviewedFact);
    const primaryReviewed = reviewedFacts.filter((record) => record.isPrimarySource === true);
    const reliableGroups = unique(reliableRecords.map(groupKey));
    const reviewedGroups = unique(reviewedFacts.map(groupKey));
    const reviewedPrimaryGroups = unique(primaryReviewed.map(groupKey));
    const contradictionEvidenceIds = reliableRecords
      .filter((record) => Array.isArray(record.contradictsClaimIds) && record.contradictsClaimIds.length > 0)
      .map((record) => record.id);
    const evidenceIds = cluster.records.map((record) => record.id);
    const recommendationGrade =
      reviewedPrimaryGroups.length >= 1 &&
      reviewedGroups.length >= 2 &&
      contradictionEvidenceIds.length === 0;
    const corroborated = reliableGroups.length >= 2;
    const claimId = `claim:${contentHash({
      companyId: cluster.companyId,
      eventType: cluster.eventType,
      windowStart: cluster.windowStart,
    }).slice(0, 24)}`;

    return {
      claimId,
      version: 1,
      companyId: cluster.companyId,
      eventType: cluster.eventType,
      category: cluster.category,
      eventWindowStart: cluster.windowStart,
      statement: EVENT_STATEMENTS[cluster.eventType] || EVENT_STATEMENTS.UNCLASSIFIED_OFFICIAL_EVENT,
      evidenceIds,
      sourceGroups: reliableGroups,
      reviewedSourceGroups: reviewedGroups,
      primaryEvidenceIds: primaryReviewed.map((record) => record.id),
      reviewedEvidenceIds: reviewedFacts.map((record) => record.id),
      contradictionEvidenceIds,
      status: contradictionEvidenceIds.length
        ? 'CONTRADICTED'
        : recommendationGrade
          ? 'RECOMMENDATION_GRADE'
          : corroborated
            ? 'CORROBORATED_DISCOVERY'
            : primaryReviewed.length
              ? 'PRIMARY_CONFIRMED'
              : 'DISCOVERY_ONLY',
      recommendationGrade,
    };
  }).sort((a, b) => {
    if (a.recommendationGrade !== b.recommendationGrade) return Number(b.recommendationGrade) - Number(a.recommendationGrade);
    return String(b.eventWindowStart).localeCompare(String(a.eventWindowStart));
  });
}

export function selectLeadClaim(claims = []) {
  const priority = {
    CONTRADICTED: 100,
    RECOMMENDATION_GRADE: 90,
    PRIMARY_CONFIRMED: 80,
    CORROBORATED_DISCOVERY: 70,
    DISCOVERY_ONLY: 10,
  };
  return [...claims].sort((a, b) => {
    const statusOrder = (priority[b.status] || 0) - (priority[a.status] || 0);
    if (statusOrder) return statusOrder;
    return String(b.eventWindowStart).localeCompare(String(a.eventWindowStart));
  })[0] || null;
}
