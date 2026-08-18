import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runDailyIntelligence } from './run-daily-intelligence.js';
import { discoverAutonomousCandidates } from './autonomous-discovery.js';
import { applyAutonomousPublicationPolicy, FINAL_ACTION_POLICY_VERSION } from './final-action-policy.js';
import { buildOpportunitiesFeed } from './opportunities-feed.js';
import { buildInstrumentProfile } from './instrument-profile.js';
import { extractEquityOpportunityRawSignals, buildOpportunityFactorsForUniverse } from './opportunity-factor-engine.js';
import { scanOpportunityUniverse } from './opportunity-universe-scanner.js';
import { createNasdaqUsListedUniverseProvider } from './adapters/nasdaq-symbol-directory-universe.js';
import { buildSecFramesBroadEquityScreen } from './adapters/sec-frames-broad-equity-screen.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_UNIVERSE_PATH = path.resolve(MODULE_DIR, '../config/universe.seed.json');

async function loadSeedUniverse(universePath = DEFAULT_UNIVERSE_PATH) {
  const parsed = JSON.parse(await readFile(universePath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('Universe seed must be an array');
  return parsed.filter((company) => company?.active === true);
}

function countByAction(dossiers = []) {
  const counts = { BUY_NOW: 0, SELL_NOW: 0, HOLD: 0, DO_NOT_BUY: 0, AVOID: 0, WATCH: 0, BLOCKED: 0 };
  for (const dossier of dossiers) {
    const finalAction = dossier?.finalAction;
    if (!finalAction || finalAction.status !== 'FINAL') {
      counts.BLOCKED += 1;
      continue;
    }
    const action = finalAction.marketAction || 'WATCH';
    counts[action] = (counts[action] || 0) + 1;
  }
  return counts;
}

function normalizedCik(value) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^0+/, '');
  return digits || null;
}

function listingKey(value = {}) {
  const listing = value.primaryListing || value.listing || {};
  const symbol = String(listing.symbol || '').toUpperCase();
  const mic = String(listing.mic || '').toUpperCase();
  return symbol && mic ? `LISTING:${mic}:${symbol}` : null;
}

function universeIdentityKeys(company = {}) {
  return [
    company.companyId ? `COMPANY:${company.companyId}` : null,
    normalizedCik(company.cik) ? `CIK:${normalizedCik(company.cik)}` : null,
    listingKey(company),
  ].filter(Boolean);
}

function mergeUniverse(...groups) {
  const records = [];
  const keyToIndex = new Map();
  for (const company of groups.flat().filter(Boolean)) {
    const keys = universeIdentityKeys(company);
    const matchedIndex = keys.map((key) => keyToIndex.get(key)).find(Number.isInteger);
    if (Number.isInteger(matchedIndex)) {
      // Earlier groups have canonical priority (focus > event > broad). Later
      // channels may fill missing metadata but cannot replace canonical identity.
      records[matchedIndex] = { ...company, ...records[matchedIndex], primaryListing: { ...(company.primaryListing || {}), ...(records[matchedIndex].primaryListing || {}) } };
      for (const key of universeIdentityKeys(records[matchedIndex])) keyToIndex.set(key, matchedIndex);
      continue;
    }
    const index = records.length;
    records.push(company);
    for (const key of keys) keyToIndex.set(key, index);
  }
  return records;
}

function candidateByListing(items = []) {
  return new Map(items.map((item) => [listingKey(item), item]).filter(([key]) => key));
}

function annotateDiscovery(dossiers, discovery, broadOpportunityScan, seedUniverse) {
  const eventCandidates = new Map((discovery?.shortlist || []).map((candidate) => [candidate.companyId, candidate]));
  const broadCandidates = candidateByListing(broadOpportunityScan?.candidates || []);
  const focusCompanyIds = new Set(seedUniverse.map((company) => company.companyId).filter(Boolean));
  const focusListings = new Set(seedUniverse.map(listingKey).filter(Boolean));
  return dossiers.map((dossier) => {
    const eventCandidate = eventCandidates.get(dossier.companyId) || null;
    const broadCandidate = broadCandidates.get(listingKey(dossier)) || null;
    const focus = focusCompanyIds.has(dossier.companyId) || focusListings.has(listingKey(dossier));
    return {
      ...dossier,
      origin: focus ? 'FOCUS_UNIVERSE' : eventCandidate ? 'AUTONOMOUS_EVENT_DISCOVERY' : broadCandidate ? 'BROAD_OPPORTUNITY_SCREEN' : 'FOCUS_UNIVERSE',
      discovery: eventCandidate,
      broadScreen: broadCandidate?.broadScreen || null,
    };
  });
}

function byCompanyId(items = []) {
  return new Map(items.filter((item) => item?.companyId).map((item) => [item.companyId, item]));
}

function dossierMap(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item?.companyId) continue;
    const current = map.get(item.companyId);
    const currentReady = current?.metrics?.crossCheck?.recommendationReady === true;
    const nextReady = item?.metrics?.crossCheck?.recommendationReady === true;
    if (!current || (nextReady && !currentReady)) map.set(item.companyId, item);
  }
  return map;
}

function opportunityDataQuality(fundamentals, marketMetrics, fundamentalRisk, dossier) {
  let score = 0;
  if (fundamentals?.metricsReady === true) score += 40;
  if (marketMetrics?.readiness?.marketMetricsReady === true) score += 30;
  if (fundamentalRisk?.metricsReady === true) score += 15;
  if (dossier?.metrics?.crossCheck?.discoveryReady === true) score += 10;
  if (dossier?.metrics?.crossCheck?.recommendationReady === true) score += 5;
  return Math.min(100, score);
}

function severeOpportunityRiskFlags(fundamentalRisk, marketMetrics) {
  const flags = [...(fundamentalRisk?.flags || []), ...(marketMetrics?.risk?.flags || [])];
  return [...new Set(flags.filter((flag) => /^SEVERE_|^EXTREME_|DISTRESS|SOLVENCY|DEFAULT|NON_POSITIVE_EQUITY|CASH_RUNWAY_UNDER_ONE_YEAR/.test(String(flag))))];
}

function latestMarketAgeHours(companyId, marketByCompany) {
  const snapshot = marketByCompany.get(companyId);
  const age = Number(snapshot?.ageHours ?? snapshot?.quoteContract?.ageHours);
  return Number.isFinite(age) ? Math.max(0, age) : null;
}

function buildAnalysedOpportunitySeeds(expandedUniverse, baseReport, options = {}) {
  const fundamentalsByCompany = byCompanyId(baseReport.fundamentalSnapshots);
  const riskByCompany = byCompanyId(baseReport.fundamentalRiskAssessments);
  const historyByCompany = byCompanyId(baseReport.historicalMarketMetrics);
  const marketByCompany = byCompanyId(baseReport.marketSnapshots);
  const dossiersByCompany = dossierMap(baseReport.researchDossiers);
  const rawRecords = [];
  const passthrough = [];

  for (const company of expandedUniverse) {
    const profile = buildInstrumentProfile(company, options.context || {});
    const fundamentals = fundamentalsByCompany.get(company.companyId) || null;
    const fundamentalRisk = riskByCompany.get(company.companyId) || null;
    const marketMetrics = historyByCompany.get(company.companyId) || null;
    const dossier = dossiersByCompany.get(company.companyId) || null;

    if (profile.assetClass !== 'EQUITY' || profile.analysisModel !== 'EQUITY_OPERATING') {
      passthrough.push({
        ...company,
        instrumentId: company.instrumentId || company.companyId,
        opportunityRiskScore: Number.isFinite(Number(fundamentalRisk?.riskScore)) ? Number(fundamentalRisk.riskScore) : 100,
        evidenceQualityScore: opportunityDataQuality(fundamentals, marketMetrics, fundamentalRisk, dossier),
        executionQualityScore: Number(marketMetrics?.liquidity?.score || 0),
        contradictionCount: Number(dossier?.metrics?.crossCheck?.contradictionCount || 0),
        severeRiskFlags: severeOpportunityRiskFlags(fundamentalRisk, marketMetrics),
      });
      continue;
    }

    rawRecords.push({
      instrumentId: company.instrumentId || company.companyId,
      company,
      profile,
      displayName: company.displayName || company.legalName,
      sector: company.sector || null,
      industry: company.industry || null,
      rawSignals: extractEquityOpportunityRawSignals({ fundamentals, fundamentalRisk, marketMetrics }),
      sourceCount: 2 + Number(dossier?.metrics?.crossCheck?.reviewedIndependentGroupCount || 0),
      ageHours: latestMarketAgeHours(company.companyId, marketByCompany),
      opportunityRiskScore: Number.isFinite(Number(fundamentalRisk?.riskScore)) ? Number(fundamentalRisk.riskScore) : 100,
      evidenceQualityScore: opportunityDataQuality(fundamentals, marketMetrics, fundamentalRisk, dossier),
      executionQualityScore: Number(marketMetrics?.liquidity?.score || 0),
      contradictionCount: Number(dossier?.metrics?.crossCheck?.contradictionCount || 0),
      severeRiskFlags: severeOpportunityRiskFlags(fundamentalRisk, marketMetrics),
    });
  }

  const normalized = buildOpportunityFactorsForUniverse(rawRecords, { minimumPeers: options.minimumOpportunityPeers || 5 });
  const factorized = normalized.map((record) => ({
    ...record.company,
    instrumentId: record.instrumentId,
    opportunityFactors: record.opportunityFactors,
    opportunityPeerNormalization: record.peerNormalization,
    opportunityRiskScore: record.opportunityRiskScore,
    evidenceQualityScore: record.evidenceQualityScore,
    executionQualityScore: record.executionQualityScore,
    contradictionCount: record.contradictionCount,
    severeRiskFlags: record.severeRiskFlags,
  }));
  return [...factorized, ...passthrough];
}

function deepVerificationQueue(opportunityUniverse, limit = 25) {
  return (opportunityUniverse?.ranking?.items || [])
    .filter((item) => ['DEEP_VERIFY_NOW', 'DEEP_VERIFY'].includes(item.discoveryAction))
    .slice(0, Math.max(1, Number(limit || 25)))
    .map((item) => ({
      rank: item.rank,
      instrumentId: item.instrumentId,
      displayName: item.displayName,
      assetClass: item.assetClass,
      analysisModel: item.analysisModel,
      tier: item.tier,
      opportunityScore: item.opportunityScore,
      confidenceScore: item.confidenceScore,
      action: item.discoveryAction,
      finalActionEligible: false,
      nextGate: 'FULL_VERIFICATION_AND_FINAL_ACTION_POLICY',
    }));
}

async function runBroadOpportunityScreen(options, generatedAt, secUserAgent) {
  const enabled = options.enableBroadOpportunityScan !== false && Boolean(secUserAgent);
  if (!enabled) {
    return {
      format: 'investor-control-broad-opportunity-screen',
      version: 1,
      generatedAt,
      enabled: false,
      candidates: [],
      diagnostics: [{ code: secUserAgent ? 'BROAD_OPPORTUNITY_SCAN_DISABLED' : 'SEC_USER_AGENT_MISSING' }],
    };
  }
  try {
    const provider = options.broadOpportunityUniverseProvider || createNasdaqUsListedUniverseProvider();
    const directory = await provider.discover({
      assetClasses: ['EQUITY'],
      fetchImpl: options.fetchImpl || globalThis.fetch,
      now: generatedAt,
      limit: options.broadOpportunityUniverseLimit || 15_000,
    });
    const screen = await buildSecFramesBroadEquityScreen(directory.instruments || [], {
      fetchImpl: options.fetchImpl || globalThis.fetch,
      userAgent: secUserAgent,
      now: generatedAt,
      limit: options.broadOpportunityDeepAnalysisLimit || 12,
    });
    return {
      ...screen,
      enabled: true,
      directoryEligibleCount: directory.totalEligibleCount ?? directory.instruments?.length ?? 0,
      directoryTruncated: directory.truncated === true,
      candidates: (screen.candidates || []).filter((candidate) => Number(candidate.broadScreen?.preliminaryRiskScore || 100) < 80),
    };
  } catch (error) {
    return {
      format: 'investor-control-broad-opportunity-screen',
      version: 1,
      generatedAt,
      enabled: true,
      candidates: [],
      diagnostics: [{ code: 'BROAD_OPPORTUNITY_SCAN_FAILED', message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

function broadCandidatesToCompanies(broadOpportunityScan) {
  return (broadOpportunityScan?.candidates || []).map((candidate) => ({
    companyId: candidate.companyId,
    cik: candidate.cik,
    legalName: candidate.displayName,
    displayName: candidate.displayName,
    country: 'US',
    active: true,
    primaryListing: candidate.primaryListing,
    broadScreen: candidate.broadScreen,
  }));
}

export async function runAutonomousIntelligence(options = {}) {
  const generatedAt = new Date(options.now || Date.now()).toISOString();
  const seedUniverse = options.universe || await loadSeedUniverse(options.universePath);
  const secUserAgent = options.secUserAgent || process.env.SEC_USER_AGENT || '';
  let discovery;
  try {
    discovery = await discoverAutonomousCandidates({ ...options, now: generatedAt, seedUniverse, secUserAgent });
  } catch (error) {
    discovery = {
      format: 'investor-control-autonomous-discovery', version: 1, policyVersion: null, generatedAt, sourcePolicy: null,
      registryCompanyCount: 0, filingEventCount: 0, candidateCount: 0, deepAnalysisCompanyCount: 0,
      shortlist: [], discoveredCompanies: [], diagnostics: [{ code: 'AUTONOMOUS_DISCOVERY_FAILED', message: error instanceof Error ? error.message : String(error) }],
    };
  }

  const broadOpportunityScan = await runBroadOpportunityScreen(options, generatedAt, secUserAgent);
  const broadCompanies = broadCandidatesToCompanies(broadOpportunityScan);
  const expandedUniverse = mergeUniverse(seedUniverse, discovery.discoveredCompanies, broadCompanies);
  const baseReport = await runDailyIntelligence({ ...options, now: generatedAt, universe: expandedUniverse });

  const analysedOpportunitySeeds = buildAnalysedOpportunitySeeds(expandedUniverse, baseReport, options);
  const opportunityUniverse = await scanOpportunityUniverse({
    now: generatedAt,
    instruments: analysedOpportunitySeeds,
    universeProviders: options.opportunityUniverseProviders || [],
    capabilityProviders: options.opportunityCapabilityProviders || [],
    assetClasses: options.opportunityAssetClasses,
    rankingLimit: options.opportunityRankingLimit || 100,
    perProviderLimit: options.opportunityPerProviderLimit || 2_000,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    context: options.opportunityContext || {},
  });
  const opportunityDeepVerificationQueue = deepVerificationQueue(opportunityUniverse, options.opportunityDeepVerificationLimit || 25);

  const policyDossiers = applyAutonomousPublicationPolicy(baseReport.researchDossiers, {
    now: generatedAt,
    maxReferencePriceAgeHours: options.maxReferencePriceAgeHours,
    maxDossierAgeHours: options.maxDossierAgeHours,
    maxHistoricalMarketAgeHours: options.maxHistoricalMarketAgeHours,
    immediatePriceAgeHours: options.immediatePriceAgeHours,
    minimumImmediateLiquidityScore: options.minimumImmediateLiquidityScore,
  });
  const researchDossiers = annotateDiscovery(policyDossiers, discovery, broadOpportunityScan, seedUniverse);
  const opportunitiesFeed = buildOpportunitiesFeed(researchDossiers, { generatedAt });
  const finalActionCounts = countByAction(researchDossiers);
  const finalActionCount = Object.entries(finalActionCounts).filter(([key]) => key !== 'BLOCKED').reduce((sum, [, value]) => sum + value, 0);

  return {
    ...baseReport,
    version: 8,
    generatedAt,
    policyVersion: FINAL_ACTION_POLICY_VERSION,
    universeExpansion: {
      seedCompanyCount: seedUniverse.length,
      eventDiscoveredCompanyCount: discovery.discoveredCompanies.length,
      broadScreenCompanyCount: broadCompanies.length,
      analysedCompanyCount: expandedUniverse.length,
      opportunityScannedInstrumentCount: opportunityUniverse.uniqueInstrumentCount,
      opportunityScorableInstrumentCount: opportunityUniverse.scorableInstrumentCount,
    },
    discovery,
    broadOpportunityScan,
    opportunityUniverse,
    opportunityDeepVerificationQueue,
    researchDossiers,
    opportunitiesFeed,
    finalActionCount,
    finalActionCounts,
    autonomousPublicationCount: researchDossiers.filter((dossier) => dossier.publicationMode === 'AUTOMATED_POLICY').length,
  };
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/autonomous-intelligence.json');
  const report = await runAutonomousIntelligence();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote autonomous intelligence report to ${outputPath}`);
  console.log(`Event discovery: ${report.discovery.candidateCount} candidates, ${report.discovery.deepAnalysisCompanyCount} additions`);
  console.log(`Broad opportunity screen: ${report.broadOpportunityScan.directoryEligibleCount || 0} eligible, ${report.broadOpportunityScan.candidates?.length || 0} deep-analysis additions`);
  console.log(`Opportunity hunter: ${report.opportunityUniverse.uniqueInstrumentCount} scanned, ${report.opportunityUniverse.scorableInstrumentCount} scorable, ${report.opportunityUniverse.ranking.superOpportunityCount} super candidates`);
  console.log(`Deep verification queue: ${report.opportunityDeepVerificationQueue.length}`);
  console.log(`Final actions: ${JSON.stringify(report.finalActionCounts)}`);
  console.log(`Automatically published dossiers: ${report.autonomousPublicationCount}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

export const DEFAULT_AUTONOMOUS_OUTPUT = path.resolve(MODULE_DIR, '../out/autonomous-intelligence.json');
