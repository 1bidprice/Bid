import { readFile, writeFile } from 'node:fs/promises';
import { buildResearchQueueKvBulk } from '../src/research-queue-publication-commit.js';

const [planPath, reportPath, outputPath = 'out/research-queue-completion-bulk.json'] = process.argv.slice(2);
if (!planPath || !reportPath) {
  throw new Error('Usage: node scripts/build-research-queue-kv-bulk.js <completion-plan.json> <published-report.json> [output.json]');
}

const plan = JSON.parse(await readFile(planPath, 'utf8'));
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const bulk = buildResearchQueueKvBulk(plan, report);
await writeFile(outputPath, JSON.stringify(bulk, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ updateCount: bulk.updateCount, outputPath }));
