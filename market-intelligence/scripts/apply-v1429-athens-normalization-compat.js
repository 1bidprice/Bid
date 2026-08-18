import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

const canonical = `function normalizeLine(value) {
  return plainText(value).toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/\\s+/g, ' ').trim();
}`;

if (!source.includes("replace(/&/g, ' and ')")) {
  let matched = false;
  source = source.replace(/function normalizeLine\(value\) \{[\s\S]*?\n\}/, () => {
    matched = true;
    return canonical;
  });
  if (!matched) throw new Error('v1.4.3 normalization compatibility failed: normalizeLine function not found');
  fs.writeFileSync(filePath, source);
}

const verified = fs.readFileSync(filePath, 'utf8');
if (!verified.includes(canonical)) throw new Error('v1.4.3 normalization compatibility failed: canonical normalizeLine missing');
console.log('Investor Control Athens normalization compatibility applied.');
