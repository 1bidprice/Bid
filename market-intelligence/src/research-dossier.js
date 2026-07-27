import { contentHash } from './content-hash.js';
import { assessIndependentEvidence } from './cross-check.js';
import { evaluateSignalReadiness } from './signal-readiness.js';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function compactEvidence(record) {
  return {
    evidenceId: record.id,
    sourceName: record.sourceName,
    sourceType: record.sourceType,
    sourceUrl: record.sourceUrl,
    title: record.title,
    publishedAt: record.publishedAt,
    independenceGroup: record.independenceGroup || null,
    isPrimarySource: record.isPrimarySource === true,
    documentStatus: record.document?.status || null,
  };
}

function compactClaim(claim) {
  if (!claim) return null;
  return {
    claimId: claim.claimId,
    eventType: claim.eventType,
    category: claim.category,
    eventWindowStart: claim.eventWindowStart,
    statement: claim.statement,
    evidenceIds: claim.evidenceIds,
    sourceGroups: claim.sourceGroups,
    reviewedSourceGroups: claim.reviewedSourceGroups,
    contradictionEvidenceIds: claim.contradictionEvidenceIds,
    status: claim.status,
    recommendationGrade: claim.recommendationGrade,
  };
}

function validClaim(claim) {
  return claim &&
    typeof claim.text === 'string' &&
    claim.text.trim().length >= 10 &&
    Array.isArray(claim.evidenceIds) &&
    claim.evidenceIds.length > 0 &&
    Number.isFinite(Number(claim.confidence));
}

function normalizeClaims(claims = []) {
  return claims
    .filter(validClaim)
    .map((claim) => ({
      text: claim.text.trim(),
      evidenceIds: unique(claim.evidenceIds),
      confidence: Math.max(0, Math.min(1, Number(claim.confidence))),
      inference: claim.inference === true,
    }));
}

function referencePrice(marketSnapshot, historicalMetrics) {
  if (marketSnapshot?.usable && !marketSnapshot.stale && marketSnapshot.currentPrice > 0 && marketSnapshot.quoteAt) {
    return {
      value: marketSnapshot.currentPrice,
      currency: marketSnapshot.currency,
      timestamp: marketSnapshot.quoteAt,
      source: marketSnapshot.source,
    };
  }
  if (historicalMetrics?.latestClose > 0 && historicalMetrics.latestTimestamp) {
    return {
      value: historicalMetrics.latestClose,
      currency: historicalMetrics.currency,
      timestamp: new Date(historicalMetrics.latestTimestamp * 1000).toISOString(),
      source: 'Historical market series',
    };
  }
  return null;
}

function synthesisBlockers(input) {
  const blockers = [];
  if (!input.thesis || input.thesis.trim().length < 80) blockers.push('THESIS_REQUIRED');
  if (!input.causalMechanism || input.causalMechanism.trim().length < 40) blockers.push('CAUSAL_MECHANISM_REQUIRED');
  if (!input.bullCase || input.bullCase.trim().length < 40) blockers.push('BULL_CASE_REQUIRED');
  if (!input.bearCase || input.bearCase.trim().length < 40) blockers.push('BEAR_CASE_REQUIRED');
  if (!input.invalidationCondition || input.invalidationCondition.trim().length < 20) blockers.push('INVALIDATION_CONDITION_REQUIRED');
  if (normalizeClaims(input.catalysts).length < 1) blockers.push('VERIFIED_CATALYST_REQUIRED');
  if (normalizeClaims(input.risks).length < 2) blockers.push('MATERIAL_RISKS_REQUIRED');
  if (!input.reviewDate) blockers.push('REVIEW_DATE_REQUIRED');
  if (input.requireCanonicalClaim === true) {
    if (!input.leadClaim) blockers.push('CANONICAL_CLAIM_REQUIRED');
    else if (input.leadClaim.recommendationGrade !== true) blockers.push('CLAIM_CORROBORATION_REQUIRED');
  }
  return blockers;
}

export function buildResearchDossier(input = {}) {
  const company = input.company || {};
  const records = Array.isArray(input.evidence) ? input.evidence : [];
  const crossCheck = input.crossCheck || assessIndependentEvidence(records, input.generatedAt || new Date());
  const reference = referencePrice(input.marketSnapshot, input.historicalMarketMetrics);
  const risks = normalizeClaims(input.risks);
  const catalysts = normalizeClaims(input.catalysts);
  const baseReadiness = evaluateSignalReadiness({
    evidence: records.find((record) => record?.document?.reviewed === true) || records[0] || null,
    fundamentals: input.fundamentals,
    marketMetrics: input.historicalMarketMetrics,
    crossCheck,
    thesis: input.thesis,
    invalidationCondition: input.invalidationCondition,
    risks,
  });
  const blockers = unique([
    ...baseReadiness.blockers,
    ...synthesisBlockers(input),
    ...(reference ? [] : ['REFERENCE_PRICE_REQUIRED']),
  ]);
  const publishable = blockers.length === 0;
  const category = input.category || 'INSUFFICIENT_EVIDENCE';
  const proposedAction = publishable ? (input.proposedAction || 'WATCH') : 'WATCH';
  const generatedAt = new Date(input.generatedAt || Date.now()).toISOString();
  const identity = {
    companyId: company.companyId,
    generatedAt,
    leadClaimId: input.leadClaim?.claimId || null,
    evidenceHashes: records.map((record) => record.contentHash).filter(Boolean),
    category,
  };

  return {
    dossierId: `dossier:${company.companyId || 'unknown'}:${contentHash(identity).slice(0, 20)}`,
    version: 2,
    companyId: company.companyId || 'company:unknown',
    companyName: company.displayName || company.legalName || 'Unknown company',
    listing: company.primaryListing || { exchange: 'Unknown', symbol: 'UNKNOWN', mic: null },
    generatedAt,
    status: publishable ? 'REVIEW_READY' : 'DRAFT_RESEARCH',
    category,
    proposedAction,
    timeHorizon: input.timeHorizon || 'UNDETERMINED',
    referencePrice: reference,
    thesis: input.thesis?.trim() || null,
    causalMechanism: input.causalMechanism?.trim() || null,
    catalysts,
    bullCase: input.bullCase?.trim() || null,
    bearCase: input.bearCase?.trim() || null,
    risks,
    invalidationCondition: input.invalidationCondition?.trim() || null,
    evidence: records.map(compactEvidence),
    metrics: {
      leadClaim: compactClaim(input.leadClaim),
      fundamentals: input.fundamentals || null,
      market: input.historicalMarketMetrics || null,
      fundamentalRisk: input.fundamentalRisk || null,
      crossCheck,
    },
    readiness: {
      publishable,
      blockers,
    },
    reviewDate: input.reviewDate || null,
    disclosure: 'System-generated research assessment based on cited evidence. It is not a guarantee of outcome and does not execute orders.',
  };
}

export function publishResearchDossier(dossier) {
  if (!dossier?.readiness?.publishable) {
    throw new Error(`Research dossier is not publishable: ${(dossier?.readiness?.blockers || []).join(', ')}`);
  }
  if (dossier.status !== 'REVIEW_READY') {
    throw new Error('Research dossier must be REVIEW_READY before publication');
  }
  return {
    ...dossier,
    status: 'PUBLISHED',
  };
}
