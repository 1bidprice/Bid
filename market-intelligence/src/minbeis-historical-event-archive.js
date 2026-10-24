import { createHash } from 'node:crypto';

export const MINBEIS_HISTORICAL_EVENT_ARCHIVE_VERSION = '2026-10-03.1';

function validDate(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function normalizedEvidence(dossier = {}) {
  return (Array.isArray(dossier.evidence) ? dossier.evidence : []).map((record) => ({
    evidenceId: record.evidenceId || record.id || null,
    sourceName: record.sourceName || null,
    sourceType: record.sourceType || null,
    sourceUrl: record.sourceUrl || null,
    title: record.title || null,
    publishedAt: validDate(record.publishedAt),
    contentHash: record.contentHash || null,
    isPrimarySource: record.isPrimarySource === true,
  })).filter((record) => record.evidenceId);
}

function claimRows(dossier = {}) {
  const rows = [];
  const lead = dossier?.metrics?.leadClaim || null;
  if (lead) rows.push({ ...lead, role: 'LEAD_CLAIM' });
  for (const item of Array.isArray(dossier.catalysts) ? dossier.catalysts : []) rows.push({ ...item, role: 'CATALYST' });
  for (const item of Array.isArray(dossier.risks) ? dossier.risks : []) rows.push({ ...item, role: 'RISK' });
  return rows;
}

function claimStatement(claim = {}) {
  return String(claim.statement || claim.text || '').trim() || null;
}

function buildEventRecord(dossier, claim, capturedAt) {
  const evidence = normalizedEvidence(dossier);
  const byId = new Map(evidence.map((item) => [item.evidenceId, item]));
  const evidenceIds = [...new Set(Array.isArray(claim.evidenceIds) ? claim.evidenceIds.filter(Boolean) : [])].sort();
  const supporting = evidenceIds.map((id) => byId.get(id) || null);
  const missingEvidenceIds = evidenceIds.filter((id) => !byId.has(id));
  const undatedEvidenceIds = supporting.filter(Boolean).filter((item) => !item.publishedAt).map((item) => item.evidenceId);
  const dated = supporting.filter(Boolean).map((item) => item.publishedAt).filter(Boolean);
  const availabilityAt = evidenceIds.length
    && missingEvidenceIds.length === 0
    && undatedEvidenceIds.length === 0
    && dated.length === evidenceIds.length
    ? new Date(Math.max(...dated.map((value) => new Date(value).getTime()))).toISOString()
    : null;
  const statement = claimStatement(claim);
  const identity = {
    companyId: dossier.companyId || null,
    eventType: claim.eventType || null,
    category: claim.category || null,
    role: claim.role || null,
    statement,
    evidenceIds,
  };
  const blockers = [];
  if (!identity.companyId) blockers.push('EVENT_COMPANY_ID_REQUIRED');
  if (!identity.eventType) blockers.push('EVENT_TYPE_REQUIRED');
  if (!statement) blockers.push('EVENT_STATEMENT_REQUIRED');
  if (!evidenceIds.length) blockers.push('EVENT_EVIDENCE_REQUIRED');
  if (missingEvidenceIds.length) blockers.push('EVENT_SUPPORTING_EVIDENCE_MISSING_FROM_DOSSIER');
  if (undatedEvidenceIds.length) blockers.push('EVENT_SUPPORTING_EVIDENCE_UNDATED');
  if (!availabilityAt) blockers.push('EVENT_AVAILABILITY_TIME_NOT_DEFENSIBLE');

  return {
    format: 'investor-control-minbeis-historical-event',
    version: 1,
    archivePolicyVersion: MINBEIS_HISTORICAL_EVENT_ARCHIVE_VERSION,
    eventArchiveId: 'event:' + digest(identity).slice(0, 32),
    companyId: dossier.companyId || null,
    companyName: dossier.companyName || null,
    symbol: dossier?.listing?.symbol || null,
    eventType: claim.eventType || null,
    category: claim.category || null,
    role: claim.role || null,
    statement,
    statementHash: statement ? digest(statement) : null,
    eventWindowStart: validDate(claim.eventWindowStart),
    eventWindowEnd: validDate(claim.eventWindowEnd),
    evidenceIds,
    supportingEvidence: supporting.filter(Boolean),
    availabilityAt,
    firstSeenAt: capturedAt,
    lastSeenAt: capturedAt,
    dossierId: dossier.dossierId || null,
    status: blockers.length ? 'BLOCKED' : 'ARCHIVED',
    blockers: [...new Set(blockers)],
    replayEligible: blockers.length === 0,
  };
}

export function extractHistoricalEventsFromDossiers(dossiers = [], capturedAt = new Date().toISOString()) {
  const captured = validDate(capturedAt);
  if (!captured) throw new Error('Valid capturedAt is required');
  const records = [];
  for (const dossier of Array.isArray(dossiers) ? dossiers : []) {
    for (const claim of claimRows(dossier)) records.push(buildEventRecord(dossier, claim, captured));
  }
  return records;
}

export function appendMinbeisHistoricalEventArchive(existing = [], dossiers = [], capturedAt = new Date().toISOString()) {
  const incoming = extractHistoricalEventsFromDossiers(dossiers, capturedAt);
  const map = new Map();

  for (const record of Array.isArray(existing) ? existing : []) {
    if (!record?.eventArchiveId) continue;
    map.set(record.eventArchiveId, record);
  }

  let newRecordCount = 0;
  let observedAgainCount = 0;
  for (const record of incoming) {
    const current = map.get(record.eventArchiveId);
    if (!current) {
      map.set(record.eventArchiveId, record);
      newRecordCount += 1;
      continue;
    }
    map.set(record.eventArchiveId, {
      ...current,
      firstSeenAt: current.firstSeenAt || record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      availabilityAt: current.availabilityAt || record.availabilityAt || null,
      replayEligible: current.replayEligible === true,
      status: current.status || record.status,
      blockers: Array.isArray(current.blockers) ? current.blockers : record.blockers,
    });
    observedAgainCount += 1;
  }

  const records = [...map.values()].sort((a, b) =>
    String(a.availabilityAt || '9999').localeCompare(String(b.availabilityAt || '9999'))
    || String(a.eventArchiveId).localeCompare(String(b.eventArchiveId)));

  const replayEligibleCount = records.filter((record) => record.replayEligible === true).length;
  const blockedCount = records.length - replayEligibleCount;

  return {
    format: 'investor-control-minbeis-historical-event-archive',
    version: 1,
    policyVersion: MINBEIS_HISTORICAL_EVENT_ARCHIVE_VERSION,
    updatedAt: validDate(capturedAt),
    recordCount: records.length,
    replayEligibleCount,
    blockedCount,
    newRecordCount,
    observedAgainCount,
    records,
    decisionImpact: 'NONE',
    automaticPolicyMutationAllowed: false,
  };
}
