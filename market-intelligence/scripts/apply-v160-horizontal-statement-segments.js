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

function horizontalLayoutChunks(rawRow) {
  const raw = String(rawRow || '');
  const chunks = [];
  const gapPattern = /\\s{3,}/g;
  let cursor = 0;
  let match;

  const pushRange = (start, end) => {
    const slice = raw.slice(start, end);
    const firstNonSpace = slice.search(/\\S/);
    if (firstNonSpace < 0) return;
    const lastNonSpace = slice.search(/\\s*$/);
    const text = slice.trim();
    if (!text) return;
    const absoluteStart = start + firstNonSpace;
    const absoluteEnd = start + (lastNonSpace >= 0 ? lastNonSpace : slice.length);
    chunks.push({ text, start: absoluteStart, end: absoluteEnd });
  };

  while ((match = gapPattern.exec(raw)) !== null) {
    pushRange(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  pushRange(cursor, raw.length);
  return chunks;
}

function horizontalMetricRowSegment(rawRow, labels = [], minimumNumbers = 2) {
  const raw = String(rawRow || '');
  if (!raw || !Array.isArray(labels) || !labels.length) return null;

  // pdftotext -layout preserves wide horizontal gaps. Financial reports often
  // place two independent accounting tables side-by-side, so one physical text
  // line can contain a complete left-table row followed by a right-table row.
  // Keep the original offsets as well as the bounded text: the bounded text is
  // used for numeric parsing while absolute offsets preserve Note-column proof.
  const chunks = horizontalLayoutChunks(raw);
  if (chunks.length < 2) return null;

  for (let index = 0; index < chunks.length; index += 1) {
    const originalChunk = chunks[index].text;
    const labelChunk = stripStatementSectionPrefix(originalChunk);
    const labelMatch = metricRowLabel(normalizeLine(labelChunk), labels);
    if (!labelMatch) continue;

    const parts = [labelChunk];
    let numberCount = financialNumericTokens(labelChunk).length;
    let cursor = index + 1;
    let lastIncludedIndex = index;

    for (; cursor < chunks.length; cursor += 1) {
      const chunk = chunks[cursor].text;
      const chunkNumbers = financialNumericTokens(chunk);
      const hasLetters = /[A-Za-zΑ-Ωα-ω]/u.test(normalizePdfGlyphs(chunk));

      if (hasLetters && numberCount >= minimumNumbers) break;
      if (hasLetters && numberCount > 0 && chunkNumbers.length === 0) break;

      parts.push(chunk);
      numberCount += chunkNumbers.length;
      lastIncludedIndex = cursor;
    }

    if (numberCount < minimumNumbers) continue;

    const fullNormalized = normalizeLine(raw);
    const fullLabelMatch = metricRowLabel(fullNormalized, labels);
    const hadSectionPrefix = labelChunk !== originalChunk;
    const hasFollowingStatementText = cursor < chunks.length;
    const targetWasNotFullRowAnchor = !fullLabelMatch;

    if (hadSectionPrefix || hasFollowingStatementText || targetWasNotFullRowAnchor) {
      const rawOffset = chunks[index].start;
      const rawEnd = chunks[lastIncludedIndex].end;
      return {
        line: parts.join(' '),
        rawSegment: raw.slice(rawOffset, rawEnd),
        rawOffset,
      };
    }
  }

  return null;
}`,
  'function horizontalLayoutChunks(rawRow)',
  'horizontal accounting row segmenter with geometry',
);

replaceRequired(
  `function stripAlignedStatementNoteReference(numbers, rawRow, rawPageText) {
  if (!Array.isArray(numbers) || numbers.length < 3) return { numbers, stripped: false, noteValue: null };
  const first = Number(numbers[0]?.value);
  if (!Number.isInteger(first) || first < 1 || first > 99) return { numbers, stripped: false, noteValue: null };
  const firstRaw = rawNumericStarts(rawRow)[0] || null;
  if (!firstRaw) return { numbers, stripped: false, noteValue: null };
  const columns = statementNoteColumns(rawPageText);
  const aligned = columns.some((column) => Math.abs(firstRaw.index - column) <= 8);
  if (!aligned) return { numbers, stripped: false, noteValue: null };
  return { numbers: numbers.slice(1), stripped: true, noteValue: first };
}`,
  `function stripAlignedStatementNoteReference(numbers, rawRow, rawPageText, rawOffset = 0) {
  if (!Array.isArray(numbers) || numbers.length < 3) return { numbers, stripped: false, noteValue: null };
  const first = Number(numbers[0]?.value);
  if (!Number.isInteger(first) || first < 1 || first > 99) return { numbers, stripped: false, noteValue: null };
  const firstRaw = rawNumericStarts(rawRow)[0] || null;
  if (!firstRaw) return { numbers, stripped: false, noteValue: null };
  const columns = statementNoteColumns(rawPageText);
  const absoluteFirstNumericIndex = Number(rawOffset || 0) + Number(firstRaw.index || 0);
  const aligned = columns.some((column) => Math.abs(absoluteFirstNumericIndex - column) <= 8);
  if (!aligned) return { numbers, stripped: false, noteValue: null };
  return { numbers: numbers.slice(1), stripped: true, noteValue: first };
}`,
  'absolute Note-column alignment',
);

replaceRequired(
  `function statementValues(numbers, pageText, contexts = [], rawRow = '') {
  const noteAdjusted = stripAlignedStatementNoteReference(numbers, rawRow, pageText);`,
  `function statementValues(numbers, pageText, contexts = [], rawRow = '', rawOffset = 0) {
  const noteAdjusted = stripAlignedStatementNoteReference(numbers, rawRow, pageText, rawOffset);`,
  'statement values receive row offset',
);

replaceRequired(
  `      const line = entry.line;
      const rawRow = entry.rawLine;
      const needed = Number(options.minimumNumbers || 2);
      const scopedLine = horizontalMetricRowSegment(rawRow, labels, needed) || line;
      const scopedRawRow = scopedLine === line ? rawRow : scopedLine;
      const normalized = normalizeLine(scopedLine);`,
  `      const line = entry.line;
      const rawRow = entry.rawLine;
      const needed = Number(options.minimumNumbers || 2);
      const scopedSegment = horizontalMetricRowSegment(rawRow, labels, needed);
      const scopedLine = scopedSegment?.line || line;
      const scopedRawRow = scopedSegment?.rawSegment || rawRow;
      const scopedRawOffset = Number(scopedSegment?.rawOffset || 0);
      const normalized = normalizeLine(scopedLine);`,
  'scoped metric row geometry',
);

replaceRequired(
  `      const columnSelection = statementValues(numbers, pageText, contexts, scopedRawRow);`,
  `      const columnSelection = statementValues(numbers, pageText, contexts, scopedRawRow, scopedRawOffset);`,
  'scoped statement geometry selection',
);

replaceRequired(
  `        line: scopedLine,
        physicalLine: line,
        pageNumber: pageIndex + 1,`,
  `        line: scopedLine,
        physicalLine: line,
        rawRowOffset: scopedRawOffset,
        pageNumber: pageIndex + 1,`,
  'bounded row geometry provenance',
);

replaceRequired(
  `      physicalLine: row.physicalLine || row.line || null,
    },`,
  `      physicalLine: row.physicalLine || row.line || null,
      rawRowOffset: Number.isFinite(Number(row.rawRowOffset)) ? Number(row.rawRowOffset) : 0,
    },`,
  'row-offset provenance audit',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'function horizontalLayoutChunks(rawRow)',
  'function horizontalMetricRowSegment(rawRow, labels = [], minimumNumbers = 2)',
  'rawSegment: raw.slice(rawOffset, rawEnd)',
  'absoluteFirstNumericIndex',
  'stripAlignedStatementNoteReference(numbers, rawRow, pageText, rawOffset)',
  'const scopedSegment = horizontalMetricRowSegment(rawRow, labels, needed);',
  'statementValues(numbers, pageText, contexts, scopedRawRow, scopedRawOffset)',
  'rawRowOffset: Number.isFinite(Number(row.rawRowOffset))',
  'statementPageAuthorityScore',
  'explicitGroupCompanyColumns',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.6.0 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.6.0 horizontal accounting-statement row segmentation with Note-column geometry applied.');
