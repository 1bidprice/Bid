import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publishApprovedResearch } from './publication-pipeline.js';

export async function publishFromFiles(options = {}) {
  const reportPath = path.resolve(options.reportPath || 'out/daily-intelligence.json');
  const decisionsPath = path.resolve(options.decisionsPath || 'config/review-decisions.json');
  const outputPath = path.resolve(options.outputPath || 'out/reviewed-publication.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const decisions = JSON.parse(await readFile(decisionsPath, 'utf8'));
  if (!Array.isArray(report.researchDossiers)) throw new Error('Daily report does not contain researchDossiers');
  if (!Array.isArray(decisions)) throw new Error('Review decisions file must be an array');

  const result = publishApprovedResearch(report.researchDossiers, decisions, {
    generatedAt: options.generatedAt,
    maxReferencePriceAgeHours: options.maxReferencePriceAgeHours,
    maxDossierAgeHours: options.maxDossierAgeHours,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

async function main() {
  const [reportPath, decisionsPath, outputPath] = process.argv.slice(2);
  const result = await publishFromFiles({ reportPath, decisionsPath, outputPath });
  console.log(`Published ${result.publishedCount} of ${result.inputDossierCount} reviewed dossiers`);
  if (result.rejected.length) console.warn(`Rejected: ${JSON.stringify(result.rejected)}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
