import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.3.2 statement-row gate failed: missing ${label}`);
  source = source.replace(from, to);
}

if (!source.includes('function looksLikeNarrativeMetricLine(')) {
  replaceRequired(
    `function metricLineScale(line) {`,
    `function looksLikeNarrativeMetricLine(line) {
  const raw = String(line || '').trim();
  const lower = raw.toLowerCase();
  if (!raw) return false;
  // Financial statement rows are label/value structures. Narrative prose that
  // happens to contain the same label must not be promoted into audited facts.
  return /\\b(amounted to|stood at|reached|was formed at|were formed at|compared (?:with|to)|versus|of which|representing|presenting|increased (?:to|by)|decreased (?:to|by)|rose (?:to|by)|fell (?:to|by))\\b/i.test(lower);
}

function metricLineScale(line) {`,
    'narrative metric detector',
  );
}

replaceRequired(
  `function scrubMetricLine(line) {
  return String(line || '')
    .replace(/^\\s*\\d+(?:\\.\\d+)+\\s+(?=[A-Za-zΑ-Ω])/iu, ' ')
    .replace(/\\b(?:note|σημ(?:είωση|ειωση)?\\.?)\\s*[A-ZΑ-Ω]?\\d+(?:\\.\\d+)*\\b/giu, ' ')
    .replace(/\\b[A-ZΑ-Ω]\\.\\d+(?:\\.\\d+)*\\b/gu, ' ');
}`,
  `function scrubMetricLine(line) {
  return String(line || '')
    .replace(/\\b\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}\\b/g, ' ')
    .replace(/\\b\\d+(?:st|nd|rd|th)\\b/gi, ' ')
    .replace(/^\\s*\\d+(?:\\.\\d+)+\\s+(?=[A-Za-zΑ-Ω])/iu, ' ')
    .replace(/\\b(?:note|σημ(?:είωση|ειωση)?\\.?)\\s*[A-ZΑ-Ω]?\\d+(?:\\.\\d+)*\\b/giu, ' ')
    .replace(/\\b[A-ZΑ-Ω]\\.\\d+(?:\\.\\d+)*\\b/gu, ' ');
}`,
  'date and ordinal scrubber',
);

replaceRequired(
  `      if (looksLikeTableOfContentsLine(line)) continue;
      const numbers = financialNumericTokens(line);`,
  `      if (looksLikeTableOfContentsLine(line)) continue;
      if (looksLikeNarrativeMetricLine(line)) continue;
      const numbers = financialNumericTokens(line);`,
  'narrative rejection in metric-row selection',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'looksLikeNarrativeMetricLine',
  "replace(/\\b\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}\\b/g, ' ')",
  "replace(/\\b\\d+(?:st|nd|rd|th)\\b/gi, ' ')",
  'if (looksLikeNarrativeMetricLine(line)) continue;',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.3.2 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.3.2 Athens statement-row gate applied.');
