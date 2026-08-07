import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

const from = `    if (index === 0) score = 100;
    else if (prefix.length <= 16 && /^(?:(?:note|σημ(?:ειωση)?)\\s*)?(?:[a-zα-ω]?\\d+(?:[.]\\d+)*|[a-zα-ω][.]\\d+(?:[.]\\d+)*)[ .:()-]*$/i.test(prefix)) score = 75;`;
const to = `    if (index === 0) score = 100;
    else if (prefix.length <= 12 && /^[\\s·•*\\-–—:().]+$/u.test(prefix)) score = 90;
    else if (prefix.length <= 16 && /^(?:(?:note|σημ(?:ειωση)?)\\s*)?(?:[a-zα-ω]?\\d+(?:[.]\\d+)*|[a-zα-ω][.]\\d+(?:[.]\\d+)*)[ .:()-]*$/i.test(prefix)) score = 75;`;

if (!source.includes(to)) {
  if (!source.includes(from)) throw new Error('v1.4.3 bullet-label compatibility failed: metricRowLabel anchor not found');
  source = source.replace(from, to);
  fs.writeFileSync(filePath, source);
}

const verified = fs.readFileSync(filePath, 'utf8');
if (!verified.includes("/^[\\s·•*\\-–—:().]+$/u.test(prefix)")) throw new Error('v1.4.3 bullet-label compatibility failed: punctuation-only prefix rule missing');
if (!verified.includes('score = 90')) throw new Error('v1.4.3 bullet-label compatibility failed: bullet score missing');

console.log('Investor Control Athens bullet-label compatibility applied without permitting prose prefixes.');
