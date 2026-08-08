import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

const from = "  const revenueRow = findMetricRow(pages, ['revenue from sale of inventories', 'revenue from contracts with customers', 'sales', 'revenue', 'turnover'], { statementContexts: ['INCOME_STATEMENT'], exclude: ['cost of sales', 'revenue reserve', 'revenue recognition'] });";
const to = "  const revenueRow = findMetricRow(pages, ['revenue from sale of inventories', 'revenue from contracts with customers', 'total revenue', 'sales', 'revenue', 'turnover'], { statementContexts: ['INCOME_STATEMENT'], exclude: ['cost of sales', 'revenue reserve', 'revenue recognition'] });";

if (!source.includes(to)) {
  if (!source.includes(from)) throw new Error('v1.5.7.2 total-revenue patch failed: revenue taxonomy not found');
  source = source.replace(from, to);
}

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
if (!verified.includes("'total revenue', 'sales', 'revenue', 'turnover'")) {
  throw new Error('v1.5.7.2 verification failed: anchored total revenue label missing');
}
if (!verified.includes("statementContexts: ['INCOME_STATEMENT']")) {
  throw new Error('v1.5.7.2 verification failed: income-statement gate was weakened');
}
if (!verified.includes('metricLabelTailAllowed')) {
  throw new Error('v1.5.7.2 verification failed: row-tail safety gate missing');
}
if (!verified.includes('statementValues(numbers, pageText, contexts)')) {
  throw new Error('v1.5.7.2 verification failed: note-reference column handling missing');
}

console.log('Investor Control v1.5.7.2 anchored total-revenue label applied.');
