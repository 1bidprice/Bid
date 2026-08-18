import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

const oldBlock = `function statementContextScore(pages, pageIndex, contexts = []) {
  if (!contexts.length) return 1;
  const current = String(pages[pageIndex] || '');
  const previous = pageIndex > 0 ? String(pages[pageIndex - 1] || '') : '';
  let best = 0;`;

const newBlock = `function statementContextScore(pages, pageIndex, contexts = []) {
  if (!contexts.length) return 1;
  const current = normalizePdfGlyphs(String(pages[pageIndex] || ''));
  const previous = pageIndex > 0 ? normalizePdfGlyphs(String(pages[pageIndex - 1] || '')) : '';
  let best = 0;`;

if (!source.includes(newBlock)) {
  if (!source.includes(oldBlock)) throw new Error('v1.5.8.1 context-glyph patch failed: statementContextScore prelude not found');
  source = source.replace(oldBlock, newBlock);
}

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  "const current = normalizePdfGlyphs(String(pages[pageIndex] || ''));",
  "const previous = pageIndex > 0 ? normalizePdfGlyphs(String(pages[pageIndex - 1] || '')) : '';",
  'statementPageAuthorityScore',
  'normalizePdfGlyphs(plainText(value))',
  'stripAlignedStatementNoteReference',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.5.8.1 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.5.8.1 statement-context PDF glyph normalization applied.');
