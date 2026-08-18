import { contentHash } from './content-hash.js';
import { publishResearchDossier } from './research-dossier.js';
import { buildOpportunitiesFeed } from './opportunities-feed.js';
import { createOutcomeRecord } from './outcome-ledger.js';

const DECISIONS = new Set(['APPROVE', 'REJECT', 'DEFER']);

function iso(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) throw new Error('Invalid review timestamp');
  return date.toISOString();
}

export function createReviewDecision(input = {}) {
  const dossierId = String(input.dossierId || '').trim();
  const reviewer = String(input.reviewer || '').trim();
  const decision = String(input.decision || '').trim().toUpperCase();
  if (!dossierId) throw new Error('Review decision requires dossierId');
  if (reviewer.length < 3) throw new Error('Review decision requires an identified reviewer');
  if (!DECISIONS.has(decision)) throw new Error('Review decision must be APPROVE, REJECT or DEFER');
  const reviewedAt = iso(input.reviewedAt);
  const notes = String(input.notes || '').trim() || null;
  const identity = { dossierId, reviewer, decision, reviewedAt, notes };
  return {
    reviewId: `review:${contentHash(identity).slice(0, 24)}`,
    version: 1,
    dossierId,
    reviewer,
    decision,
    reviewedAt,
    notes,
  };
}

function hoursBetween(later, earlier) {
  return (new Date(later).getTime() - new Date(earlier).getTime()) / 3_600_000;
}

function validateApproval(dossier, decision, options) {
  const blockers = [];
  if (dossier?.status !== 'REVIEW_READY') blockers.push('DOSSIER_NOT_REVIEW_READY');
  if (dossier?.readiness?.publishable !== true) blockers.push('DOSSIER_NOT_PUBLISHABLE');
  if (decision?.decision !== 'APPROVE') blockers.push('APPROVAL_REQUIRED');
  if (!dossier?.referencePrice?.timestamp) blockers.push('REFERENCE_PRICE_REQUIRED');
  if (!dossier?.reviewDate) blockers.push('REVIEW_DATE_REQUIRED');

  if (decision?.reviewedAt && dossier?.generatedAt && new Date(decision.reviewedAt) < new Date(dossier.generatedAt)) {
    blockers.push('REVIEW_PRECEDES_DOSSIER');
  }
  if (decision?.reviewedAt && dossier?.referencePrice?.timestamp) {
    const priceAgeHours = hoursBetween(decision.reviewedAt, dossier.referencePrice.timestamp);
    if (priceAgeHours < 0) blockers.push('REFERENCE_PRICE_AFTER_REVIEW');
    else if (priceAgeHours > Number(options.maxReferencePriceAgeHours ?? 96)) blockers.push('REFERENCE_PRICE_STALE_FOR_PUBLICATION');
  }
  if (decision?.reviewedAt && dossier?.generatedAt) {
    const dossierAgeHours = hoursBetween(decision.reviewedAt, dossier.generatedAt);
    if (dossierAgeHours > Number(options.maxDossierAgeHours ?? 72)) blockers.push('DOSSIER_STALE_FOR_PUBLICATION');
  }
  if (dossier?.reviewDate && decision?.reviewedAt) {
    const reviewDateEnd = new Date(`${dossier.reviewDate}T23:59:59.999Z`);
    if (new Date(decision.reviewedAt) > reviewDateEnd) blockers.push('DOSSIER_REVIEW_DATE_EXPIRED');
  }
  return [...new Set(blockers)];
}

export function publishApprovedResearch(dossiers = [], decisions = [], options = {}) {
  const decisionByDossier = new Map();
  for (const item of decisions) {
    const decision = item?.reviewId ? item : createReviewDecision(item);
    const existing = decisionByDossier.get(decision.dossierId);
    if (!existing || new Date(decision.reviewedAt) > new Date(existing.reviewedAt)) {
      decisionByDossier.set(decision.dossierId, decision);
    }
  }

  const published = [];
  const rejected = [];
  const audit = [];
  for (const dossier of dossiers) {
    const decision = decisionByDossier.get(dossier?.dossierId) || null;
    const blockers = validateApproval(dossier, decision, options);
    if (blockers.length) {
      rejected.push({
        dossierId: dossier?.dossierId || null,
        decision: decision?.decision || null,
        blockers,
      });
      audit.push({ dossierId: dossier?.dossierId || null, reviewId: decision?.reviewId || null, result: 'NOT_PUBLISHED', blockers });
      continue;
    }

    const publishedDossier = publishResearchDossier(dossier);
    published.push(publishedDossier);
    audit.push({ dossierId: dossier.dossierId, reviewId: decision.reviewId, result: 'PUBLISHED', blockers: [] });
  }

  const generatedAt = iso(options.generatedAt);
  const opportunitiesFeed = buildOpportunitiesFeed(published, { generatedAt });
  const outcomeRecords = published.map(createOutcomeRecord);
  return {
    format: 'investor-control-reviewed-publication-package',
    version: 1,
    generatedAt,
    inputDossierCount: dossiers.length,
    decisionCount: decisions.length,
    publishedCount: published.length,
    publishedDossiers: published,
    opportunitiesFeed,
    outcomeRecords,
    rejected,
    audit,
  };
}
