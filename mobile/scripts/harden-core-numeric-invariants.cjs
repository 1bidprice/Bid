const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = [
  'src/transaction-accounting.js',
  'src/portfolio-engine.js',
  'src/position-lots.js',
];

const unsafe = 'const finite = (value) => Number.isFinite(Number(value));';
const safe = "const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));";

for (const relativePath of files) {
  const fullPath = path.join(root, relativePath);
  let source = fs.readFileSync(fullPath, 'utf8');
  if (source.includes(unsafe)) source = source.replace(unsafe, safe);
  if (!source.includes(safe)) throw new Error(`numeric hardening failed for ${relativePath}`);
  fs.writeFileSync(fullPath, source);
}

console.log('Numeric invariant hardening PASS: null/undefined/empty values can no longer masquerade as numeric zero.');
