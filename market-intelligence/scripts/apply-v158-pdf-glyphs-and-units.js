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

function replaceRegexRequired(regex, replacement, marker, label) {
  if (source.includes(marker)) return;
  regex.lastIndex = 0;
  if (!regex.test(source)) throw new Error(`v1.5.8 patch failed: missing ${label}`);
  regex.lastIndex = 0;
  source = source.replace(regex, replacement);
}

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

function normalizedScaleText(value, maxChars = 60_000) {
  return normalizePdfGlyphs(String(value || '').slice(0, maxChars))
    .toLowerCase()
    .replace(/\\s+/g, ' ');
}

function unitScaleMarker(value) {
  const text = normalizedScaleText(value);
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
  if (millionPatterns.some((pattern) => pattern.test(text))) return 1_000_000;
  if (thousandPatterns.some((pattern) => pattern.test(text))) return 1_000;
  return null;
}

function primaryStatementPageForScale(value) {
  const text = normalizedScaleText(value, 80_000);
  return /(?:^|\\s)(?:condensed\\s+)?(?:income statement|statement of comprehensive income|statement of financial position|balance sheet|statement of cash flows?|cash flow statement)(?:\\s|$)/.test(text);
}

function scaleFromText(text, pages = []) {
  const localScales = (Array.isArray(pages) ? pages : [])
    .filter((page) => primaryStatementPageForScale(page))
    .map((page) => unitScaleMarker(page))
    .filter((value) => value !== null);
  const uniqueLocalScales = [...new Set(localScales)];
  if (uniqueLocalScales.length === 1) return uniqueLocalScales[0];
  if (uniqueLocalScales.length > 1) return 1;
  return unitScaleMarker(text) || 1;
}`;

replaceRegexRequired(
  /function scaleFromText\(text\)\s*\{[\s\S]*?\n\}\s*\nfunction normalizeLine/,
  `${newScale}\n\nfunction normalizeLine`,
  'function primaryStatementPageForScale(value)',
  'statement-local financial unit detector',
);

replaceRegexRequired(
  /function normalizeLine\(value\) \{[\s\S]*?\n\}/,
  `function normalizeLine(value) {
  return normalizePdfGlyphs(plainText(value)).toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/\\s+/g, ' ').trim();
}`,
  'normalizePdfGlyphs(plainText(value))',
  'PDF glyph normalization in accounting labels and contexts',
);

replaceRequired(
  "  const scale = scaleFromText(text);",
  "  const scale = scaleFromText(text, pages);",
  'statement-local scale call',
);

replaceRequired(
  "  const lines = rawCurrent.split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean);",
  "  const lines = rawCurrent.split(String.fromCharCode(10)).map((line) => normalizeLine(line)).filter(Boolean);",
  'normalized statement-authority headings',
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
  'function unitScaleMarker(value)',
  'function primaryStatementPageForScale(value)',
  'const uniqueLocalScales = [...new Set(localScales)]',
  'scaleFromText(text, pages)',
  'map((line) => normalizeLine(line))',
  'normalizePdfGlyphs(plainText(value))',
  'net cash generated from (+)/used in (-) operating activities',
  'acquisition of property, plant and equipment and intangible assets',
  'statementPageAuthorityScore',
  'stripAlignedStatementNoteReference',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.5.8 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.5.8 statement-local unit scaling and PDF glyph normalization applied.');
