const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const storePath = path.join(root, 'src', 'intelligence-feed-store.js');
const opportunitiesPath = path.join(root, 'src', 'OpportunitiesView.js');

const store = fs.readFileSync(storePath, 'utf8');
const opportunities = fs.readFileSync(opportunitiesPath, 'utf8');

function required(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`v1.7.0 Opportunity Hunter mobile contract missing ${label}`);
}

for (const [needle, label] of [
  ['const FEED_VERSION = 2;', 'feed v2 canonical version'],
  ['SUPPORTED_FEED_VERSIONS', 'v1/v2 compatibility gate'],
  ['normalizeOpportunityPurchaseDecision', 'purchase decision normalizer'],
  ['confirmedBuyOpportunities', 'confirmed purchase lane'],
  ['waitingEntryOpportunities', 'waiting purchase lane'],
  ['rejectedOpportunities', 'rejected purchase lane'],
  ['blockedOpportunities', 'blocked purchase lane'],
  ['automaticBrokerOrder: false', 'automatic broker-order fail-safe'],
]) required(store, needle, label);

for (const [needle, label] of [
  ['function OpportunityPurchaseCard', 'purchase card'],
  ['function PurchaseSection', 'purchase section'],
  ['feed.confirmedBuyOpportunities', 'confirmed UI lane'],
  ['feed.waitingEntryOpportunities', 'waiting UI lane'],
  ['feed.rejectedOpportunities', 'rejected UI lane'],
  ['feed.blockedOpportunities', 'blocked UI lane'],
  ['Καμία εντολή broker δεν εκτελείται αυτόματα.', 'manual execution disclosure'],
]) required(opportunities, needle, label);

const start = store.indexOf('const FEED_FORMAT');
const end = store.indexOf('export function intelligenceFeedFreshness');
if (start < 0 || end <= start) throw new Error('Unable to isolate feed normalization contract for deterministic verification.');
const normalizationSource = store
  .slice(start, end)
  .replace('export function normalizeIntelligenceFeed', 'function normalizeIntelligenceFeed');
const factory = new Function(`${normalizationSource}\nreturn { normalizeIntelligenceFeed };`);
const { normalizeIntelligenceFeed } = factory();

function strictAction(nonHolderAction = 'BUY_NOW') {
  return {
    status: 'FINAL',
    marketAction: nonHolderAction === 'BUY_NOW' ? 'BUY_NOW' : 'WATCH',
    nonHolderAction,
    execution: { automaticBrokerOrder: false, requiresUserExecution: true },
  };
}

function baseFeed(version) {
  return {
    format: 'investor-control-mobile-intelligence-feed',
    version,
    generatedAt: '2026-08-10T16:10:08.066Z',
    summary: {},
    published: [],
    reviewReady: [],
    research: [],
    urgent: [],
    opportunityPurchaseDecisions: [],
    assistantContext: [],
    disclosure: 'test',
  };
}

const legacy = normalizeIntelligenceFeed(baseFeed(1));
if (legacy.version !== 2) throw new Error('Legacy v1 feed did not upgrade safely to canonical v2 cache shape.');

const v2 = baseFeed(2);
v2.opportunityPurchaseDecisions = [
  {
    instrumentId: 'company:buy', companyId: 'company:buy', displayName: 'Buy Candidate', symbol: 'BUY',
    status: 'BUY_CONFIRMED', statusLabel: 'ΑΓΟΡΑ ΕΠΙΒΕΒΑΙΩΘΗΚΕ', buyNowEligible: true,
    strictAction: strictAction('BUY_NOW'), whyNotBuyNow: [], nextGate: 'USER_EXECUTION_ONLY', automaticBrokerOrder: true,
  },
  {
    instrumentId: 'company:wait', companyId: 'company:wait', displayName: 'Wait Candidate', symbol: 'WAIT',
    status: 'WAIT_FOR_ENTRY_CONFIRMATION', statusLabel: 'ΠΕΡΙΜΕΝΕ', buyNowEligible: false,
    strictAction: strictAction('DO_NOT_BUY'), whyNotBuyNow: ['BUY_SETUP_NOT_CONFIRMED'], nextGate: 'RECHECK_STRICT_BUY_GATES',
  },
  {
    instrumentId: 'company:reject', companyId: 'company:reject', displayName: 'Reject Candidate', symbol: 'NOPE',
    status: 'REJECTED', statusLabel: 'ΑΠΟΡΡΙΦΘΗΚΕ ΓΙΑ ΑΓΟΡΑ', buyNowEligible: false,
    strictAction: strictAction('AVOID'), whyNotBuyNow: ['SEVERE_RISK_CONFIGURATION'], nextGate: 'NEW_EVIDENCE_OR_MATERIAL_CHANGE',
  },
  {
    instrumentId: 'company:block', companyId: 'company:block', displayName: 'Blocked Candidate', symbol: 'BLOCK',
    status: 'NO_DEEP_DOSSIER', statusLabel: 'ΑΝΑΜΟΝΗ ΠΛΗΡΟΥΣ ΑΝΑΛΥΣΗΣ', buyNowEligible: false,
    strictAction: null, whyNotBuyNow: ['FULL_DEEP_DOSSIER_REQUIRED'], nextGate: 'FULL_DEEP_DOSSIER',
  },
];
const normalized = normalizeIntelligenceFeed(v2);
if (normalized.confirmedBuyOpportunities.length !== 1) throw new Error('Confirmed BUY lane was not preserved.');
if (normalized.waitingEntryOpportunities.length !== 1) throw new Error('Waiting lane was not preserved.');
if (normalized.rejectedOpportunities.length !== 1) throw new Error('Rejected lane was not preserved.');
if (normalized.blockedOpportunities.length !== 1) throw new Error('Blocked/no-deep lane was not preserved.');
if (normalized.confirmedBuyOpportunities[0].automaticBrokerOrder !== false) throw new Error('Automatic broker-order fail-safe was not enforced locally.');
if (normalized.summary.opportunityCandidateCount !== 4) throw new Error('Opportunity candidate summary count is inconsistent.');

const tampered = baseFeed(2);
tampered.opportunityPurchaseDecisions = [{
  instrumentId: 'company:tampered', companyId: 'company:tampered', displayName: 'Tampered',
  status: 'BUY_CONFIRMED', statusLabel: 'ΑΓΟΡΑ ΕΠΙΒΕΒΑΙΩΘΗΚΕ', buyNowEligible: true,
  strictAction: strictAction('DO_NOT_BUY'), whyNotBuyNow: [], nextGate: 'USER_EXECUTION_ONLY',
}];
const safe = normalizeIntelligenceFeed(tampered);
if (safe.confirmedBuyOpportunities.length !== 0) throw new Error('Tampered BUY_CONFIRMED leaked into the confirmed lane.');
if (safe.blockedOpportunities.length !== 1) throw new Error('Tampered BUY_CONFIRMED was not downgraded to BLOCKED.');
if (safe.blockedOpportunities[0].buyNowEligible !== false) throw new Error('Tampered BUY eligibility was not removed.');

let rejectedUnsupported = false;
try {
  normalizeIntelligenceFeed(baseFeed(99));
} catch {
  rejectedUnsupported = true;
}
if (!rejectedUnsupported) throw new Error('Unsupported future feed schema was accepted unexpectedly.');

console.log('PASS Investor Control v1.7.0 mobile feed v1/v2 compatibility, Hunter state preservation, UI exposure and BUY fail-safe contract.');
