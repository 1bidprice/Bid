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

function normalizedScaleLine(value) {
  return normalizePdfGlyphs(String(value || ''))
    .toLowerCase()
    .replace(/\\s+/g, ' ')
    .trim();
}

function unitScaleDeclaration(line) {
  const text = normalizedScaleLine(line);
  if (!text) return null;
  const explicitPatterns = [
    /^(?:\\(?\\s*)?(?:amounts?|figures?)\\s+(?:are\\s+)?(?:presented\\s+|expressed\\s+|stated\\s+)?in\\s+(?:€\\s*)?(?:(?:eur|euro|euros)\\s+)?(thousand|thousands|000|million|millions|mn)\\b/,
    /^(?:\\(?\\s*)?(?:amounts?|figures?)\\s+(?:are\\s+)?(?:presented\\s+|expressed\\s+|stated\\s+)?in\\s+(thousand|thousands|million|millions)\\s+of\\s+(?:eur|euro|euros)\\b/,
    /^(?:\\(?\\s*)?in\\s+(thousand|thousands|million|millions)\\s+of\\s+(?:eur|euro|euros)\\b/,
    /^(?:\\(?\\s*)?(?:amounts?|figures?)\\s+(?:are\\s+)?(?:presented\\s+|expressed\\s+|stated\\s+)?in\\s+(?:€|eur|euro|euros)\\s*(000|mn)\\b/,
  ];
  for (const pattern of explicitPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const unit = String(match[1] || '').toLowerCase();
    return /million|mn/.test(unit) ? 1_000_000 : 1_000;
  }
  return null;
}

function scaleDeclarations(value) {
  return String(value || '')
    .split(/\\r?\\n/)
    .map((line, lineIndex) => ({ lineIndex, scale: unitScaleDeclaration(line), line: normalizedScaleLine(line) }))
    .filter((entry) => entry.scale !== null);
}

function primaryStatementHeadingLine(value) {
  const lines = String(value || '').split(/\\r?\\n/).map(normalizedScaleLine).filter(Boolean);
  return lines.find((line) => {
    const match = line.match(/^(?:(?:condensed|consolidated)\\s+){0,3}(?:income statement|statement of comprehensive income|statement of financial position|balance sheet|statement of cash flows?|cash flow statement)\\b(.*)$/);
    if (!match) return false;
    const tail = String(match[1] || '').trim();
    return !/^(?:commentary|remarks|review|analysis|overview|discussion)\\b/.test(tail);
  }) || null;
}

function scaleFromText(text, pages = []) {
  const pageList = Array.isArray(pages) ? pages : [];
  const statementPageScales = [];
  for (const page of pageList) {
    if (!primaryStatementHeadingLine(page)) continue;
    const declarations = scaleDeclarations(page);
    if (declarations.length) statementPageScales.push(declarations[0].scale);
  }
  const uniqueStatementScales = [...new Set(statementPageScales)];
  if (uniqueStatementScales.length === 1) return uniqueStatementScales[0];
  if (uniqueStatementScales.length > 1) return 1;

  // Some reports declare units once on a cover/header page and omit them from
  // each statement page. Use the first explicit document declaration only;
  // later APM/commentary unit references must never override it.
  for (const page of pageList) {
    const declarations = scaleDeclarations(page);
    if (declarations.length) return declarations[0].scale;
  }
  const fullDeclarations = scaleDeclarations(text);
  return fullDeclarations[0]?.scale || 1;
}`;

replaceRegexRequired(
  /function scaleFromText\(text\)\s*\{[\s\S]*?\n\}\s*\nfunction normalizeLine/,
  `${newScale}\n\nfunction normalizeLine`,
  'function primaryStatementHeadingLine(value)',
  'authoritative statement unit detector',
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
  "    if (lines.some((line) => /^(?:condensed )?income statement(?: |$)/i.test(line))) score += 140;\n    else if (lines.some((line) => /^(?:condensed )?statement of comprehensive income(?: |$)/i.test(line))) score += 40;",
  "    if (lines.some((line) => /^(?:(?:condensed|consolidated)\\s+){0,3}income statement(?: |$)/i.test(line))) score += 140;\n    else if (lines.some((line) => /^(?:(?:condensed|consolidated)\\s+){0,3}statement of comprehensive income(?: |$)/i.test(line))) score += 40;",
  'consolidated income-statement authority',
);

replaceRequired(
  "  if (contexts.includes('BALANCE_SHEET') && lines.some((line) => /^(?:(?:condensed )?statement of financial position|(?:condensed )?balance sheet)(?: |$)/i.test(line))) score += 140;",
  "  if (contexts.includes('BALANCE_SHEET') && lines.some((line) => /^(?:(?:(?:condensed|consolidated)\\s+){0,3}statement of financial position|(?:(?:condensed|consolidated)\\s+){0,3}balance sheet)(?: |$)/i.test(line))) score += 140;",
  'consolidated balance-sheet authority',
);

replaceRequired(
  "  if (contexts.includes('CASH_FLOW') && lines.some((line) => /^(?:condensed )?(?:statement of cash flows?|cash flow statement)(?: |$)/i.test(line))) score += 140;",
  "  if (contexts.includes('CASH_FLOW') && lines.some((line) => /^(?:(?:condensed|consolidated)\\s+){0,3}(?:statement of cash flows?|cash flow statement)(?: |$)/i.test(line))) score += 140;",
  'consolidated cash-flow authority',
);

replaceRequired(
  "  return pages.some((page) => /summary interim financial statements|interim condensed financial information|interim financial statements|condensed financial statements/i.test(String(page || '')));",
  "  return pages.some((page) => /summary interim financial statements|interim condensed financial information|interim financial statements|condensed(?: consolidated)?(?: interim)? financial statements/i.test(normalizePdfGlyphs(String(page || ''))));",
  'consolidated interim authoritative-section detection',
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
  'function unitScaleDeclaration(line)',
  'function scaleDeclarations(value)',
  'function primaryStatementHeadingLine(value)',
  'const uniqueStatementScales = [...new Set(statementPageScales)]',
  'scaleFromText(text, pages)',
  'map((line) => normalizeLine(line))',
  'condensed|consolidated',
  'normalizePdfGlyphs(plainText(value))',
  'net cash generated from (+)/used in (-) operating activities',
  'acquisition of property, plant and equipment and intangible assets',
  'statementPageAuthorityScore',
  'stripAlignedStatementNoteReference',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.5.8 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.5.8 authoritative statement units and PDF glyph normalization applied.');
