import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runDailyIntelligence } from './run-daily-intelligence.js';
import { applyAutonomousPublicationPolicy, FINAL_ACTION_POLICY_VERSION } from './final-action-policy.js';
import { buildOpportunitiesFeed } from './opportunities-feed.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

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

export async function runAutonomousIntelligence(options = {}) {
  const generatedAt = new Date(options.now || Date.now()).toISOString();
  const baseReport = await runDailyIntelligence({ ...options, now: generatedAt });
  const researchDossiers = applyAutonomousPublicationPolicy(baseReport.researchDossiers, {
    now: generatedAt,
    maxReferencePriceAgeHours: options.maxReferencePriceAgeHours,
    maxDossierAgeHours: options.maxDossierAgeHours,
    maxHistoricalMarketAgeHours: options.maxHistoricalMarketAgeHours,
    immediatePriceAgeHours: options.immediatePriceAgeHours,
    minimumImmediateLiquidityScore: options.minimumImmediateLiquidityScore,
  });
  const opportunitiesFeed = buildOpportunitiesFeed(researchDossiers, { generatedAt });
  const finalActionCounts = countByAction(researchDossiers);
  const finalActionCount = Object.entries(finalActionCounts)
    .filter(([key]) => key !== 'BLOCKED')
    .reduce((sum, [, value]) => sum + value, 0);

  return {
    ...baseReport,
    version: 5,
    generatedAt,
    policyVersion: FINAL_ACTION_POLICY_VERSION,
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
