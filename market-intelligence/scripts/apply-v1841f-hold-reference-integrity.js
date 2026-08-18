import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/final-action-policy.js');

function replaceRequired(content, from, to, name) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.8.4 hold-reference integrity patch failed: ${name}`);
  return content.replace(from, to);
}

let content = fs.readFileSync(file, 'utf8');
content = replaceRequired(
  content,
  "  const directional = proposed !== 'WATCH';\n  const reference = dossier?.referencePrice || null;",
  "  const directional = proposed !== 'WATCH';\n  const executionSensitive = ['CONSIDER_BUY', 'CONSIDER_REDUCE', 'AVOID'].includes(proposed);\n  const reference = dossier?.referencePrice || null;",
  'execution-sensitive classification',
);
content = replaceRequired(
  content,
  "    if (strict && reference?.decisionEligible !== true) blockers.push('REFERENCE_PRICE_NOT_DECISION_ELIGIBLE');\n    if (strict && reference?.executionFreshnessEligible !== true) blockers.push('REFERENCE_PRICE_NOT_EXECUTION_ELIGIBLE');",
  "    if (strict && executionSensitive && reference?.decisionEligible !== true) blockers.push('REFERENCE_PRICE_NOT_DECISION_ELIGIBLE');\n    if (strict && executionSensitive && reference?.executionFreshnessEligible !== true) blockers.push('REFERENCE_PRICE_NOT_EXECUTION_ELIGIBLE');",
  'execution-only quote gates',
);
fs.writeFileSync(file, content);
console.log('Investor Control v1.8.4 HOLD reference integrity patch applied.');
