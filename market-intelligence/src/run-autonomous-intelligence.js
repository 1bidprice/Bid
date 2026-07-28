import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runDailyIntelligence } from './run-daily-intelligence.js';
import { discoverAutonomousCandidates } from './autonomous-discovery.js';
import { applyAutonomousPublicationPolicy, FINAL_ACTION_POLICY_VERSION } from './final-action-policy.js';
import { buildOpportunitiesFeed } from './opportunities-feed.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_UNIVERSE_PATH = path.resolve(MODULE_DIR, '../config/universe.seed.json');

async function loadSeedUniverse(universePath = DEFAULT_UNIVERSE_PATH) {
  const parsed = JSON.parse(await readFile(universePath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('Universe seed must be an array');
  return parsed.filter((company) => company?.active === true);
}

function countByAction(dossiers = []) {
  const counts = {
    BUY_NOW: 0,
    SELL_NOW: 0,
    HOLD: 0,
    DO_NOT_BUY: 0,
    AVOID: 0,
    WATCH: 0,
    BLOCKED: 0,
  };
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

function mergeUniverse(seedUniverse, discoveredCompanies) {
  const map = new Map();
  for (const company of [...seedUniverse, ...(discoveredCompanies || [])]) {
    if (!company?.companyId) continue;
    map.set(company.companyId, map.has(company.companyId) ? { ...company, ...map.get(company.companyId) } : company);
  }
  return [...map.values()];
}

function annotateDiscovery(dossiers, discovery) {
  const candidates = new Map((discovery?.shortlist || []).map((candidate) => [candidate.companyId, candidate]));
  return dossiers.map((dossier) => {
    const candidate = candidates.get(dossier.companyId) || null;
    return {
      ...dossier,
      origin: candidate?.isExistingFocusCompany ? 'FOCUS_UNIVERSE' : candidate ? 'AUTONOMOUS_DISCOVERY' : 'FOCUS_UNIVERSE',
      discovery: candidate,
    };
  });
}

export async function runAutonomousIntelligence(options = {}) {
  const generatedAt = new Date(options.now || Date.now()).toISOString();
  const seedUniverse = options.universe || await loadSeedUniverse(options.universePath);
  let discovery;
  try {
    discovery = await discoverAutonomousCandidates({
      ...options,
      now: generatedAt,
      seedUniverse,
      secUserAgent: options.secUserAgent || process.env.SEC_USER_AGENT || '',
    });
  } catch (error) {
    discovery = {
      format: 'investor-control-autonomous-discovery',
      version: 1,
      policyVersion: null,
      generatedAt,
      sourcePolicy: null,
      registryCompanyCount: 0,
      filingEventCount: 0,
      candidateCount: 0,
      deepAnalysisCompanyCount: 0,
      shortlist: [],
      discoveredCompanies: [],
      diagnostics: [{ code: 'AUTONOMOUS_DISCOVERY_FAILED', message: error instanceof Error ? error.message : String(error) }],
    };
  }

  const expandedUniverse = mergeUniverse(seedUniverse, discovery.discoveredCompanies);
  const baseReport = await runDailyIntelligence({ ...options, now: generatedAt, universe: expandedUniverse });
  const policyDossiers = applyAutonomousPublicationPolicy(baseReport.researchDossiers, {
    now: generatedAt,
    maxReferencePriceAgeHours: options.maxReferencePriceAgeHours,
    maxDossierAgeHours: options.maxDossierAgeHours,
    maxHistoricalMarketAgeHours: options.maxHistoricalMarketAgeHours,
    immediatePriceAgeHours: options.immediatePriceAgeHours,
    minimumImmediateLiquidityScore: options.minimumImmediateLiquidityScore,
  });
  const researchDossiers = annotateDiscovery(policyDossiers, discovery);
  const opportunitiesFeed = buildOpportunitiesFeed(researchDossiers, { generatedAt });
  const finalActionCounts = countByAction(researchDossiers);
  const finalActionCount = Object.entries(finalActionCounts)
    .filter(([key]) => key !== 'BLOCKED')
    .reduce((sum, [, value]) => sum + value, 0);

  return {
    ...baseReport,
    version: 6,
    generatedAt,
    policyVersion: FINAL_ACTION_POLICY_VERSION,
    universeExpansion: {
      seedCompanyCount: seedUniverse.length,
      discoveredCompanyCount: discovery.discoveredCompanies.length,
      analysedCompanyCount: expandedUniverse.length,
    },
    discovery,
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
  console.log(`Discovery: ${report.discovery.candidateCount} candidates, ${report.discovery.deepAnalysisCompanyCount} deep-analysis additions`);
  console.log(`Final actions: ${JSON.stringify(report.finalActionCounts)}`);
  console.log(`Automatically published dossiers: ${report.autonomousPublicationCount}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export const DEFAULT_AUTONOMOUS_OUTPUT = path.resolve(MODULE_DIR, '../out/autonomous-intelligence.json');
