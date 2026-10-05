import { readFile, writeFile } from 'node:fs/promises';
import { buildResearchQueueCompletionPlan } from '../src/research-queue-completion.js';

const [queuePath, reportPath, outputPath = 'out/research-queue-completion-plan.json'] = process.argv.slice(2);
if (!queuePath || !reportPath) {
  throw new Error('Usage: node scripts/build-research-queue-completion-plan.js <queue.json> <autonomous-report.json> [output.json]');
}
const queue = JSON.parse(await readFile(queuePath, 'utf8'));
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const plan = buildResearchQueueCompletionPlan(queue, report);
await writeFile(outputPath, JSON.stringify(plan, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ updateCount: plan.updateCount, untouchedCount: plan.untouchedCount, outputPath }));
