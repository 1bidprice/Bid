import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.6.0 patch failed: missing ${label}`);
  source = source.replace(from, to);
}

function insertBefore(marker, content, verificationMarker, label) {
  if (source.includes(verificationMarker)) return;
  if (!source.includes(marker)) throw new Error(`v1.6.0 patch failed: missing ${label}`);
  source = source.replace(marker, `${content}\n\n${marker}`);
}

insertBefore(
  'function findMetricRow(pages, labels, options = {}) {',
  `function stripStatementSectionPrefix(value) {
  return String(value || '').replace(/^\\s*(?:ASSETS|LIABILITIES|EQUITY|OPERATING ACTIVITIES|INVESTING ACTIVITIES|FINANCING ACTIVITIES)\\s+/i, '');
}

function horizontalMetricRowSegment(rawRow, labels = [], minimumNumbers = 2) {
  const raw = String(rawRow || '');
  if (!raw || !Array.isArray(labels) || !labels.length) return null;

  // pdftotext -layout preserves wide horizontal gaps. Financial reports often
  // place two independent accounting tables side-by-side, so one physical text
  // line can contain a complete left-table row followed by a right-table row.
  // Split only on wide gaps and then rebuild the target row until the next
  // alphabetic chunk. Ordinary intra-table numeric columns remain attached.
  const chunks = raw.split(/\\s{3,}/).map((chunk) => chunk.trim()).filter(Boolean);
  if (chunks.length < 2) return null;

  for (let index = 0; index < chunks.length; index += 1) {
    const originalChunk = chunks[index];
    const labelChunk = stripStatementSectionPrefix(originalChunk);
    const labelMatch = metricRowLabel(normalizeLine(labelChunk), labels);
    if (!labelMatch) continue;

    const parts = [labelChunk];
    let numberCount = financialNumericTokens(labelChunk).length;
    let cursor = index + 1;

    for (; cursor < chunks.length; cursor += 1) {
      const chunk = chunks[cursor];
      const chunkNumbers = financialNumericTokens(chunk);
      const hasLetters = /[A-Za-zΑ-Ωα-ω]/u.test(normalizePdfGlyphs(chunk));

      if (hasLetters && numberCount >= minimumNumbers) break;
      if (hasLetters && numberCount > 0 && chunkNumbers.length === 0) break;

      parts.push(chunk);
      numberCount += chunkNumbers.length;
    }

    if (numberCount < minimumNumbers) continue;

    const fullNormalized = normalizeLine(raw);
    const fullLabelMatch = metricRowLabel(fullNormalized, labels);
    const hadSectionPrefix = labelChunk !== originalChunk;
    const hasFollowingStatementText = cursor < chunks.length;
    const targetWasNotFullRowAnchor = !fullLabelMatch;

    if (hadSectionPrefix || hasFollowingStatementText || targetWasNotFullRowAnchor) {
      return parts.join(' ');
    }
  }

  return null;
}`,
  'function horizontalMetricRowSegment(rawRow, labels = [], minimumNumbers = 2)',
  'horizontal accounting row segmenter',
);

replaceRequired(
  `      const line = entry.line;
      const rawRow = entry.rawLine;
      const normalized = normalizeLine(line);`,
  `      const line = entry.line;
      const rawRow = entry.rawLine;
      const needed = Number(options.minimumNumbers || 2);
      const scopedLine = horizontalMetricRowSegment(rawRow, labels, needed) || line;
      const scopedRawRow = scopedLine === line ? rawRow : scopedLine;
      const normalized = normalizeLine(scopedLine);`,
  'scoped metric row selection',
);

replaceRequired(
  `      if (looksLikeTableOfContentsLine(line)) continue;
      if (looksLikeNarrativeMetricLine(line)) continue;
      const numbers = financialNumericTokens(line, { decimalMode: options.decimalMode === true });
      const needed = Number(options.minimumNumbers || 2);
      if (numbers.length < needed) continue;
      const columnSelection = statementValues(numbers, pageText, contexts, rawRow);`,
  `      if (looksLikeTableOfContentsLine(scopedLine)) continue;
      if (looksLikeNarrativeMetricLine(scopedLine)) continue;
      const numbers = financialNumericTokens(scopedLine, { decimalMode: options.decimalMode === true });
      if (numbers.length < needed) continue;
      const columnSelection = statementValues(numbers, pageText, contexts, scopedRawRow);`,
  'scoped statement number extraction',
);

replaceRequired(
  `        line,
        pageNumber: pageIndex + 1,`,
  `        line: scopedLine,
        physicalLine: line,
        pageNumber: pageIndex + 1,`,
  'bounded row provenance',
);

replaceRequired(
  `      candidateAudit: Array.isArray(row.candidateAudit) ? row.candidateAudit : [],
    },`,
  `      candidateAudit: Array.isArray(row.candidateAudit) ? row.candidateAudit : [],
      physicalLine: row.physicalLine || row.line || null,
    },`,
  'physical-line provenance audit',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'function horizontalMetricRowSegment(rawRow, labels = [], minimumNumbers = 2)',
  "raw.split(/\\s{3,}/)",
  'stripStatementSectionPrefix',
  'const scopedLine = horizontalMetricRowSegment(rawRow, labels, needed) || line;',
  'statementValues(numbers, pageText, contexts, scopedRawRow)',
  'physicalLine: row.physicalLine || row.line || null',
  'statementPageAuthorityScore',
  'stripAlignedStatementNoteReference',
  'explicitGroupCompanyColumns',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.6.0 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.6.0 horizontal accounting-statement row segmentation applied.');
