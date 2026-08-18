import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, "src/opportunity-engine.js");

function replaceRequired(content, from, to, name) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.8.4 recommendation-integrity patch failed: ${name}`);
  return content.replace(from, to);
}

let content = fs.readFileSync(file, 'utf8');
const operations = [
  [
    "export const OPPORTUNITY_ENGINE_VERSION = '2026-08-09.2';",
    "export const OPPORTUNITY_ENGINE_VERSION = '2026-08-18.1';"
  ],
  [
    "  if (factor === null || factor === undefined) return null;\n  if (typeof factor === 'number') return { score: clamp(factor), verified: true, sourceCount: 1, ageHours: null, peerSampleSize: null };\n  if (factor.verified !== true) return null;\n  const score = Number(factor.score);\n  if (!Number.isFinite(score)) return null;\n  return {\n    score: clamp(score),\n    verified: true,\n    sourceCount: Math.max(1, Number(factor.sourceCount || 1)),",
    "  if (factor === null || factor === undefined) return null;\n  if (typeof factor === 'number') return null;\n  if (factor.verified !== true) return null;\n  const score = Number(factor.score);\n  const sourceCount = Number(factor.sourceCount);\n  if (!Number.isFinite(score) || !Number.isFinite(sourceCount) || sourceCount < 1) return null;\n  return {\n    score: clamp(score),\n    verified: true,\n    sourceCount: Math.max(1, sourceCount),"
  ],
  [
    "  const blockers = [];\n  if (weighted.coverageScore < 70) blockers.push('INSUFFICIENT_FACTOR_COVERAGE');",
    "  const blockers = [];\n  if (weighted.coverageScore < 70) blockers.push('INSUFFICIENT_FACTOR_COVERAGE');\n  if (weighted.missing.length) blockers.push('UNVERIFIED_OR_MISSING_FACTORS');"
  ]
];
for (let index = 0; index < operations.length; index += 1) {
  const [from, to] = operations[index];
  content = replaceRequired(content, from, to, `opportunity-engine replacement ${index + 1}`);
}
fs.writeFileSync(file, content);
console.log("Investor Control v1.8.4 opportunity-engine integrity patch applied.");
