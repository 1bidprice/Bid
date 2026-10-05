import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runDailyIntelligence } from '../src/run-daily-intelligence.js';
import { applyAutonomousPublicationPolicy } from '../src/final-action-policy.js';
import { resolveQueuedResearchUniverse } from '../src/research-queue-onboarding.js';

const now = new Date().toISOString();
const universe = JSON.parse(await readFile(new URL('../config/universe.seed.json', import.meta.url), 'utf8'));
const queueResolution = await resolveQueuedResearchUniverse([
  {
    symbol: 'NVDA.US',
    status: 'QUEUED',
    firstRequestedAt: now,
    lastRequestedAt: now,
  },
], {
  generatedAt: now,
  secUserAgent: process.env.SEC_USER_AGENT || '',
  fetchImpl: globalThis.fetch,
});
if (queueResolution.resolvedCount !== 1 || queueResolution.companies?.[0]?.primaryListing?.symbol !== 'NVDA') {
  throw new Error('Synthetic queued NVDA.US did not resolve through canonical SEC identity');
}
const queuedUniverse = [
  ...queueResolution.companies,
  ...universe.filter((company) => !queueResolution.companies.some((queued) => queued.companyId === company.companyId)),
];

const base = await runDailyIntelligence({
  now,
  universe: queuedUniverse,
  secUserAgent: process.env.SEC_USER_AGENT || '',
  finnhubToken: process.env.FINNHUB_TOKEN || '',
});

const dossiers = applyAutonomousPublicationPolicy(base.researchDossiers || [], { now });
const wanted = new Set(['SPCE', 'CREDIA', 'ALWN', 'NVDA']);
const focus = dossiers
  .filter((item) => wanted.has(String(item?.listing?.symbol || '').toUpperCase()))
  .map((item) => ({
    companyId: item.companyId,
    symbol: item?.listing?.symbol || null,
    status: item.status,
    category: item.category,
    proposedAction: item.proposedAction,
    listingIntegrity: item.listingIntegrity || null,
    referencePrice: item.referencePrice ? {
      value: item.referencePrice.value,
      currency: item.referencePrice.currency,
      timestamp: item.referencePrice.timestamp,
      source: item.referencePrice.source,
      sourceApproved: item.referencePrice.sourceApproved,
      timestampVerified: item.referencePrice.timestampVerified,
      decisionEligible: item.referencePrice.decisionEligible,
      executionFreshnessEligible: item.referencePrice.executionFreshnessEligible,
    } : null,
    finalAction: item.finalAction ? {
      status: item.finalAction.status,
      marketAction: item.finalAction.marketAction,
      holderAction: item.finalAction.holderAction,
      nonHolderAction: item.finalAction.nonHolderAction,
      confidenceScore: item.finalAction.confidenceScore,
      dataQualityScore: item.finalAction.dataQualityScore,
      blockers: item.finalAction.blockers || [],
      controlledPlan: item.finalAction.controlledPlan || null,
    } : null,
  }));

for (const symbol of wanted) {
  if (!focus.some((item) => item.symbol === symbol)) {
    throw new Error(`Focus dossier missing: ${symbol}`);
  }
}

const spce = focus.find((item) => item.symbol === 'SPCE');
const spceQuoteProvesListing = spce?.listingIntegrity?.verificationSource === 'VERIFIED_DECISION_GRADE_MARKET_QUOTE';
if (spceQuoteProvesListing && spce?.finalAction?.blockers?.includes('ACTIVE_LISTING_NOT_VERIFIED')) {
  throw new Error('SPCE retained ACTIVE_LISTING_NOT_VERIFIED despite verified decision-grade quote');
}

const output = {
  format: 'investor-control-minbeis-focus-live-verification',
  version: 1,
  generatedAt: now,
  noPublicationPerformed: true,
  queueShadow: {
    requestedCount: queueResolution.requestedCount,
    resolvedCount: queueResolution.resolvedCount,
    blockedCount: queueResolution.blockedCount,
    results: queueResolution.results,
    nvdaDossierProduced: focus.some((item) => item.symbol === 'NVDA'),
  },
  focus,
  invariant: 'Live verification only; synthetic queue identity is resolved and analysed without feed publication, broker write or production queue mutation.',
};

const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/minbeis-focus-live.json');
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(output, null, 2));
