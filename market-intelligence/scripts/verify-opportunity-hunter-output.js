import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ALLOWED_TIERS = new Set([
  'SUPER_OPPORTUNITY_CANDIDATE',
  'HIGH_PRIORITY_CANDIDATE',
  'WATCHLIST_CANDIDATE',
  'LOW_PRIORITY',
]);
const ALLOWED_DISCOVERY_ACTIONS = new Set(['DEEP_VERIFY_NOW', 'DEEP_VERIFY', 'WATCH']);
const ALLOWED_PURCHASE_STATUSES = new Set([
  'BUY_CONFIRMED',
  'WAIT_FOR_ENTRY_CONFIRMATION',
  'REJECTED',
  'BLOCKED',
  'NO_DEEP_DOSSIER',
]);

function fail(message) {
  throw new Error(`OPPORTUNITY_HUNTER_SAFETY_REJECTED: ${message}`);
}

function identity(item = {}) {
  return item.instrumentId || item.companyId || null;
}

function assertCount(actual, expected, label) {
  if (Number(actual) !== Number(expected)) fail(`${label} mismatch: expected ${expected}, got ${actual}`);
}

export function verifyOpportunityHunterReport(report = {}) {
  const broad = report.broadOpportunityScan;
  const universe = report.opportunityUniverse;
  const ranking = universe?.ranking;
  const queue = report.opportunityDeepVerificationQueue;
  const reconciliation = report.opportunityPurchaseReconciliation;

  if (!broad || typeof broad !== 'object') fail('broadOpportunityScan missing');
  if (!universe || typeof universe !== 'object') fail('opportunityUniverse missing');
  if (!ranking || !Array.isArray(ranking.items)) fail('opportunityUniverse.ranking missing');
  if (!Array.isArray(queue)) fail('opportunityDeepVerificationQueue missing');
  if (!reconciliation || !Array.isArray(reconciliation.decisions)) fail('opportunityPurchaseReconciliation missing');

  const broadCandidates = Array.isArray(broad.candidates) ? broad.candidates : [];
  const quarantine = Array.isArray(broad.specializedQuarantine) ? broad.specializedQuarantine : [];
  const quarantineIds = new Set(quarantine.map(identity).filter(Boolean));
  const broadIds = new Set();
  const marketStageContractActive = Boolean(broad.marketScreenPolicyVersion || broad.marketScreenStatus);

  if (marketStageContractActive && broad.marketScreenStatus === 'ACTIVE') {
    if (!(Number(broad.marketScreenInputCount) > 0)) fail('active market screen has no input');
    if (!(Number(broad.marketScreenScorableCount) > 0)) fail('active market screen has no scorable candidates');
    if (Number(broad.marketScreenEligibleCount || 0) < broadCandidates.length) fail('market eligible count below deep-analysis candidate count');
  }

  for (const candidate of broadCandidates) {
    const id = identity(candidate);
    if (!id) fail('broad candidate missing identity');
    if (broadIds.has(id)) fail(`duplicate broad candidate: ${id}`);
    broadIds.add(id);
    if (candidate?.broadScreen?.finalActionEligible !== false) fail(`broad candidate can become final action: ${id}`);
    if (marketStageContractActive) {
      const marketScreen = candidate?.broadScreen?.marketScreen;
      if (!marketScreen || typeof marketScreen !== 'object') fail(`broad candidate bypassed market screen: ${id}`);
      if (marketScreen.finalActionEligible !== false) fail(`market screen can become final action: ${id}`);
      if (marketScreen.severeMarketRisk === true) fail(`severe market-risk candidate leaked into deep lane: ${id}`);
      if (!Number.isFinite(Number(marketScreen.score))) fail(`market-screen score missing: ${id}`);
    }
    if (quarantineIds.has(id)) fail(`specialized candidate leaked into generic broad lane: ${id}`);
  }

  const seenQuarantine = new Set();
  for (const item of quarantine) {
    const id = identity(item);
    if (!id) fail('specialized quarantine item missing identity');
    if (seenQuarantine.has(id)) fail(`duplicate specialized quarantine item: ${id}`);
    seenQuarantine.add(id);
    if (item.reason !== 'SPECIALIZED_MODEL_REQUIRES_DEDICATED_OPPORTUNITY_LANE') {
      fail(`invalid specialized quarantine reason: ${id}:${item.reason || 'NONE'}`);
    }
    if (item?.model?.specializedModelRequired !== true) fail(`quarantine item not classified specialized: ${id}`);
  }
  if (broad.specializedQuarantineCount !== undefined) {
    assertCount(broad.specializedQuarantineCount, quarantine.length, 'specializedQuarantineCount');
  }

  const rankedIds = new Set();
  let superCount = 0;
  let highPriorityCount = 0;
  for (const item of ranking.items) {
    const id = identity(item);
    if (!id) fail('ranked opportunity missing identity');
    if (rankedIds.has(id)) fail(`duplicate ranked opportunity: ${id}`);
    rankedIds.add(id);
    if (!ALLOWED_TIERS.has(item.tier)) fail(`invalid opportunity tier: ${id}:${item.tier}`);
    if (!ALLOWED_DISCOVERY_ACTIONS.has(item.discoveryAction)) fail(`invalid discovery action: ${id}:${item.discoveryAction}`);
    if (item.finalActionEligible !== false) fail(`opportunity score bypassed final-action gate: ${id}`);
    if ('marketAction' in item && item.marketAction && item.marketAction !== 'WATCH') fail(`ranked opportunity leaked market action: ${id}:${item.marketAction}`);
    if ('finalAction' in item && item.finalAction) fail(`ranked opportunity contains finalAction payload: ${id}`);

    if (item.tier === 'SUPER_OPPORTUNITY_CANDIDATE') {
      superCount += 1;
      if (!(Number(item.opportunityScore) >= 88)) fail(`super score below threshold: ${id}:${item.opportunityScore}`);
      if (!(Number(item.factorCoverageScore) >= 85)) fail(`super factor coverage below threshold: ${id}:${item.factorCoverageScore}`);
      if (!(Number(item.evidenceQualityScore) >= 75)) fail(`super evidence quality below threshold: ${id}:${item.evidenceQualityScore}`);
      if (!(Number(item.executionQualityScore) >= 55)) fail(`super execution quality below threshold: ${id}:${item.executionQualityScore}`);
      if (Number(item.contradictionCount || 0) !== 0) fail(`super candidate has contradiction: ${id}`);
      if (Array.isArray(item.severeRiskFlags) && item.severeRiskFlags.length) fail(`super candidate has severe risk: ${id}`);
      if (Number.isFinite(Number(item.peerSampleSize)) && Number(item.peerSampleSize) < 5) fail(`super peer sample too small: ${id}:${item.peerSampleSize}`);
      if (item.discoveryAction !== 'DEEP_VERIFY_NOW') fail(`super candidate not queued for immediate deep verification: ${id}`);
    }

    if (item.tier === 'HIGH_PRIORITY_CANDIDATE') {
      highPriorityCount += 1;
      if (item.discoveryAction !== 'DEEP_VERIFY') fail(`high-priority candidate has wrong action: ${id}:${item.discoveryAction}`);
    }
  }

  assertCount(ranking.superOpportunityCount, superCount, 'superOpportunityCount');
  assertCount(ranking.highPriorityCount, highPriorityCount, 'highPriorityCount');
  assertCount(ranking.rankedCount, ranking.items.length, 'rankedCount');
  assertCount(universe.scorableInstrumentCount, ranking.scannedCount, 'scorableInstrumentCount');

  const queueIds = new Set();
  const rankedById = new Map(ranking.items.map((item) => [identity(item), item]));
  for (const item of queue) {
    const id = identity(item);
    if (!id) fail('deep verification queue item missing identity');
    if (queueIds.has(id)) fail(`duplicate deep verification queue item: ${id}`);
    queueIds.add(id);
    if (item.finalActionEligible !== false) fail(`deep verification queue bypassed final action gate: ${id}`);
    if (item.nextGate !== 'FULL_VERIFICATION_AND_FINAL_ACTION_POLICY') fail(`deep queue nextGate broken: ${id}`);
    if (!['SUPER_OPPORTUNITY_CANDIDATE', 'HIGH_PRIORITY_CANDIDATE'].includes(item.tier)) fail(`invalid deep queue tier: ${id}:${item.tier}`);
    if (!['DEEP_VERIFY_NOW', 'DEEP_VERIFY'].includes(item.action)) fail(`invalid deep queue action: ${id}:${item.action}`);
    const ranked = rankedById.get(id);
    if (!ranked) fail(`deep queue item absent from ranking: ${id}`);
    if (Number(item.rank) !== Number(ranked.rank)) fail(`deep queue rank mismatch: ${id}`);
    if (Number(item.opportunityScore) !== Number(ranked.opportunityScore)) fail(`deep queue score mismatch: ${id}`);
    if (item.tier !== ranked.tier) fail(`deep queue tier mismatch: ${id}`);
    if (item.action !== ranked.discoveryAction) fail(`deep queue action mismatch: ${id}`);
  }

  const expectedPurchaseCandidates = ranking.items.filter((item) => ['SUPER_OPPORTUNITY_CANDIDATE', 'HIGH_PRIORITY_CANDIDATE'].includes(item.tier));
  assertCount(reconciliation.candidateCount, expectedPurchaseCandidates.length, 'purchase reconciliation candidateCount');
  assertCount(reconciliation.decisions.length, expectedPurchaseCandidates.length, 'purchase reconciliation decisions');
  const purchaseIds = new Set();
  let confirmedBuyCount = 0;
  let waitingCount = 0;
  let rejectedCount = 0;
  let blockedPurchaseCount = 0;
  let noDossierCount = 0;
  for (const decision of reconciliation.decisions) {
    const id = identity(decision);
    if (!id) fail('purchase decision missing identity');
    if (purchaseIds.has(id)) fail(`duplicate purchase decision: ${id}`);
    purchaseIds.add(id);
    if (!ALLOWED_PURCHASE_STATUSES.has(decision.status)) fail(`invalid purchase decision status: ${id}:${decision.status}`);
    if (decision.automaticBrokerOrder !== false) fail(`purchase decision enabled automatic broker order: ${id}`);
    const ranked = rankedById.get(id);
    if (!ranked || !['SUPER_OPPORTUNITY_CANDIDATE', 'HIGH_PRIORITY_CANDIDATE'].includes(ranked.tier)) fail(`purchase decision not backed by High/Super ranking: ${id}`);
    if (ranked.tier !== decision.tier) fail(`purchase decision tier mismatch: ${id}`);
    if (Number(ranked.opportunityScore) !== Number(decision.opportunityScore)) fail(`purchase decision score mismatch: ${id}`);

    if (decision.status === 'BUY_CONFIRMED') {
      confirmedBuyCount += 1;
      if (decision.buyNowEligible !== true) fail(`BUY_CONFIRMED is not buyNowEligible: ${id}`);
      if (decision.strictAction?.status !== 'FINAL') fail(`BUY_CONFIRMED lacks FINAL strict action: ${id}`);
      if (decision.strictAction?.marketAction !== 'BUY_NOW') fail(`BUY_CONFIRMED lacks BUY_NOW marketAction: ${id}`);
      if (decision.strictAction?.nonHolderAction !== 'BUY_NOW') fail(`BUY_CONFIRMED lacks BUY_NOW nonHolderAction: ${id}`);
      if (decision.strictAction?.execution?.automaticBrokerOrder !== false) fail(`BUY_CONFIRMED enabled automatic order: ${id}`);
      if (decision.strictAction?.execution?.requiresUserExecution !== true) fail(`BUY_CONFIRMED does not require user execution: ${id}`);
      if (decision.nextGate !== 'USER_EXECUTION_ONLY') fail(`BUY_CONFIRMED nextGate mismatch: ${id}`);
    } else {
      if (decision.buyNowEligible === true) fail(`non-confirmed purchase decision is buyNowEligible: ${id}:${decision.status}`);
      if (decision.status === 'WAIT_FOR_ENTRY_CONFIRMATION') waitingCount += 1;
      if (decision.status === 'REJECTED') rejectedCount += 1;
      if (decision.status === 'BLOCKED') blockedPurchaseCount += 1;
      if (decision.status === 'NO_DEEP_DOSSIER') noDossierCount += 1;
    }
  }
  const counts = reconciliation.counts || {};
  assertCount(counts.BUY_CONFIRMED, confirmedBuyCount, 'BUY_CONFIRMED count');
  assertCount(counts.WAIT_FOR_ENTRY_CONFIRMATION, waitingCount, 'WAIT_FOR_ENTRY_CONFIRMATION count');
  assertCount(counts.REJECTED, rejectedCount, 'REJECTED count');
  assertCount(counts.BLOCKED, blockedPurchaseCount, 'purchase BLOCKED count');
  assertCount(counts.NO_DEEP_DOSSIER, noDossierCount, 'NO_DEEP_DOSSIER count');

  const expansion = report.universeExpansion || {};
  if (expansion.broadScreenCompanyCount !== undefined) {
    assertCount(expansion.broadScreenCompanyCount, broadCandidates.length, 'broadScreenCompanyCount');
  }
  if (expansion.opportunityScannedInstrumentCount !== undefined) {
    assertCount(expansion.opportunityScannedInstrumentCount, universe.uniqueInstrumentCount, 'opportunityScannedInstrumentCount');
  }
  if (expansion.opportunityScorableInstrumentCount !== undefined) {
    assertCount(expansion.opportunityScorableInstrumentCount, universe.scorableInstrumentCount, 'opportunityScorableInstrumentCount');
  }

  return {
    status: 'VERIFIED',
    broadCandidates: broadCandidates.length,
    marketStageContractActive,
    marketScreenInput: Number(broad.marketScreenInputCount || 0),
    marketScreenScorable: Number(broad.marketScreenScorableCount || 0),
    specializedQuarantine: quarantine.length,
    opportunityScanned: Number(universe.uniqueInstrumentCount || 0),
    opportunityScorable: Number(universe.scorableInstrumentCount || 0),
    superOpportunityCount: superCount,
    highPriorityCount,
    confirmedBuyCount,
    waitingEntryCount: waitingCount,
    rejectedPurchaseCount: rejectedCount,
    deepVerificationQueueCount: queue.length,
    invariant: 'OPPORTUNITY_DISCOVERY_NEVER_BYPASSES_FINAL_ACTION_POLICY',
  };
}

function main() {
  const reportPath = path.resolve(process.argv[2] || 'out/autonomous-intelligence.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  console.log(JSON.stringify(verifyOpportunityHunterReport(report), null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) main();
