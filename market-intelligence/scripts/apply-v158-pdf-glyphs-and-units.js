import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.5.8 patch failed: missing ${label}`);
  source = source.replace(from, to);
}

const oldScale = `function scaleFromText(text) {
  const head = String(text || '').slice(0, 9000).toLowerCase();
  if (/(amounts?|figures?).{0,20}(€|eur|euro).{0,12}(million|mn)|in millions of euro|€\\s*mn/.test(head)) return 1_000_000;
  if (/(amounts?|figures?).{0,20}(€|eur|euro).{0,12}(thousand|000)|in thousands of euro|€\\s*['’]?000/.test(head)) return 1_000;
  return 1;
}`;

const newScale = `function normalizePdfGlyphs(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[Ɵ]/g, 'ti')
    .replace(/[ﬀ]/g, 'ff')
    .replace(/[ﬁ]/g, 'fi')
    .replace(/[ﬂ]/g, 'fl')
    .replace(/[ﬃ]/g, 'ffi')
    .replace(/[ﬄ]/g, 'ffl')
    .replace(/[‐‑‒–—−]/g, '-');
}

function scaleFromText(text) {
  const head = normalizePdfGlyphs(String(text || '').slice(0, 60_000))
    .toLowerCase()
    .replace(/\\s+/g, ' ');
  const millionPatterns = [
    /\\bin\\s+millions?\\s+of\\s+(?:eur|euro|euros)\\b/,
    /\\b(?:amounts?|figures?)\\s+in\\s+(?:eur|euro|euros|€)\\s+millions?\\b/,
    /\\b(?:amounts?|figures?)\\s+in\\s+millions?\\s+of\\s+(?:eur|euro|euros)\\b/,
    /(?:€|\\beur\\b|\\beuro(?:s)?\\b)\\s*(?:mn|millions?)\\b/,
  ];
  const thousandPatterns = [
    /\\bin\\s+thousands?\\s+of\\s+(?:eur|euro|euros)\\b/,
    /\\b(?:amounts?|figures?)\\s+in\\s+(?:eur|euro|euros|€)\\s+thousands?\\b/,
    /\\b(?:amounts?|figures?)\\s+in\\s+thousands?\\s+of\\s+(?:eur|euro|euros)\\b/,
    /(?:€|\\beur\\b|\\beuro(?:s)?\\b)\\s*(?:000|thousands?)\\b/,
  ];
  if (millionPatterns.some((pattern) => pattern.test(head))) return 1_000_000;
  if (thousandPatterns.some((pattern) => pattern.test(head))) return 1_000;
  return 1;
}`;

replaceRequired(oldScale, newScale, 'bounded financial unit detector');

replaceRequired(
  "function normalizeLine(value) {\n  return plainText(value).toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/\\s+/g, ' ').trim();\n}",
  "function normalizeLine(value) {\n  return normalizePdfGlyphs(plainText(value)).toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/\\s+/g, ' ').trim();\n}",
  'PDF glyph normalization in accounting labels and contexts',
);

replaceRequired(
  "  const operatingCashFlowRow = findMetricRow(pages, ['cash flow from operating activities', 'net cash from operating activities', 'net cash generated from operating activities'], { statementContexts: ['CASH_FLOW'] });",
  "  const operatingCashFlowRow = findMetricRow(pages, ['cash flow from operating activities', 'net cash from operating activities', 'net cash generated from operating activities', 'net cash generated from (+)/used in (-) operating activities', 'net cash generated from/used in operating activities'], { statementContexts: ['CASH_FLOW'] });",
  'operating cash-flow label taxonomy',
);

replaceRequired(
  "  const capexRow = findMetricRow(pages, ['purchase of tangible and intangible assets', 'purchase of property, plant and equipment', 'payments to acquire property plant and equipment', 'capital expenditure'], { statementContexts: ['CASH_FLOW'] });",
  "  const capexRow = findMetricRow(pages, ['purchase of tangible and intangible assets', 'purchase of property, plant and equipment', 'payments to acquire property plant and equipment', 'acquisition of property, plant and equipment and intangible assets', 'acquisition of property plant and equipment and intangible assets', 'capital expenditure'], { statementContexts: ['CASH_FLOW'] });",
  'capital expenditure label taxonomy',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'function normalizePdfGlyphs(value)',
  "replace(/[Ɵ]/g, 'ti')",
  "slice(0, 60_000)",
  'in\\s+millions?',
  'in\\s+thousands?',
  'normalizePdfGlyphs(plainText(value))',
  'net cash generated from (+)/used in (-) operating activities',
  'acquisition of property, plant and equipment and intangible assets',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.5.8 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.5.8 PDF glyph normalization and financial-unit taxonomy applied.');
