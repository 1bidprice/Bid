import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/run-autonomous-intelligence.js');
let source = fs.readFileSync(filePath, 'utf8');

const canonical = `  const finalActionCount = Object.entries(finalActionCounts)
    .filter(([key]) => key !== 'BLOCKED')
    .reduce((sum, [, value]) => sum + value, 0);`;
const compact = `  const finalActionCount = Object.entries(finalActionCounts).filter(([key]) => key !== 'BLOCKED').reduce((sum, [, value]) => sum + value, 0);`;

if (!source.includes(canonical)) {
  if (!source.includes(compact)) throw new Error('v1.7.0 hunter compatibility failed: finalActionCount anchor missing');
  source = source.replace(compact, canonical);
  fs.writeFileSync(filePath, source);
}

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  canonical,
  'broadOpportunityScan',
  'opportunityUniverse',
  'opportunityDeepVerificationQueue',
  "finalActionEligible: false",
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.7.0 hunter compatibility failed: missing ${invariant}`);
}

console.log('Investor Control v1.7.0 autonomous hunter migration compatibility applied.');
