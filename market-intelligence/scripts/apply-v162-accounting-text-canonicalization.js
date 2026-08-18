import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.6.2 accounting-text patch failed: missing ${label}`);
  source = source.replace(from, to);
}

replaceRequired(
  `function normalizePdfGlyphs(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[Ɵ]/g, 'ti')
    .replace(/[ﬀ]/g, 'ff')
    .replace(/[ﬁ]/g, 'fi')
    .replace(/[ﬂ]/g, 'fl')
    .replace(/[ﬃ]/g, 'ffi')
    .replace(/[ﬄ]/g, 'ffl')
    .replace(/[‐‑‒–—−]/g, '-');
}`,
  `function normalizePdfGlyphs(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[Ɵ]/g, 'ti')
    .replace(/[ﬀ]/g, 'ff')
    .replace(/[ﬁ]/g, 'fi')
    .replace(/[ﬂ]/g, 'fl')
    .replace(/[ﬃ]/g, 'ffi')
    .replace(/[ﬄ]/g, 'ffl')
    .replace(/[\\u00ad\\u200b\\u200c\\u200d\\u2060\\ufeff]/g, '')
    // Some embedded PDF fonts drop the same 'ti' glyph entirely. Repair only
    // proven accounting vocabulary so canonical row/context matching remains
    // deterministic without guessing arbitrary missing characters.
    .replace(/\\bposi\\s+on\\b/gi, 'position')
    .replace(/\\bacquisi\\s+on\\b/gi, 'acquisition')
    .replace(/[‐‑‒–—−]/g, '-');
}`,
  'bounded accounting glyph-loss repair',
);

replaceRequired(
  `function statementContextScore(pages, pageIndex, contexts = []) {
  if (!contexts.length) return 1;
  const current = normalizePdfGlyphs(String(pages[pageIndex] || ''));
  const previous = pageIndex > 0 ? normalizePdfGlyphs(String(pages[pageIndex - 1] || '')) : '';
  let best = 0;`,
  `function statementContextScore(pages, pageIndex, contexts = []) {
  if (!contexts.length) return 1;
  // Context recognition must use the exact same canonical text path as metric
  // row labels. This removes soft/zero-width PDF artifacts and repairs the
  // bounded accounting glyph-loss cases before applying statement patterns.
  const current = normalizeLine(String(pages[pageIndex] || ''));
  const previous = pageIndex > 0 ? normalizeLine(String(pages[pageIndex - 1] || '')) : '';
  let best = 0;`,
  'shared context/row canonicalization',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  "replace(/\\bposi\\s+on\\b/gi, 'position')",
  "replace(/\\bacquisi\\s+on\\b/gi, 'acquisition')",
  "replace(/[\\u00ad\\u200b\\u200c\\u200d\\u2060\\ufeff]/g, '')",
  "const current = normalizeLine(String(pages[pageIndex] || ''));",
  "const previous = pageIndex > 0 ? normalizeLine(String(pages[pageIndex - 1] || '')) : '';",
  'horizontalMetricRowSegment',
  'statementPageAuthorityScore',
  'boundedMetricRejectionAudit',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.6.2 accounting-text verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.6.2 unified accounting PDF text canonicalization applied.');
