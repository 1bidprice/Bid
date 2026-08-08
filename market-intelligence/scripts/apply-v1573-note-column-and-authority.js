import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.5.7.3 patch failed: missing ${label}`);
  source = source.replace(from, to);
}

function replaceRegexRequired(regex, replacement, marker, label) {
  if (source.includes(marker)) return;
  regex.lastIndex = 0;
  if (!regex.test(source)) throw new Error(`v1.5.7.3 patch failed: missing ${label}`);
  regex.lastIndex = 0;
  source = source.replace(regex, replacement);
}

const noteHelpers = `function rawNumericStarts(line) {
  const result = [];
  const pattern = /\\(?-?\\d[\\d.,]*\\)?/g;
  for (const match of String(line || '').matchAll(pattern)) {
    const parsed = parseStatementNumber(match[0]);
    if (parsed === null) continue;
    result.push({ index: Number(match.index || 0), value: parsed, raw: match[0] });
  }
  return result;
}

function statementNoteColumns(pageText) {
  const columns = [];
  for (const line of String(pageText || '').split(/\\r?\\n/)) {
    const match = line.match(/\\b(?:Note|Notes|Σημ(?:είωση|ειωση)?\\.?)\\b/iu);
    if (!match) continue;
    const tail = line.slice(Number(match.index || 0));
    if (!/(?:20\\d{2}|\\d{1,2}[./-]\\d{1,2}[./-]20\\d{2})/.test(tail)) continue;
    columns.push(Number(match.index || 0));
  }
  return [...new Set(columns)];
}

function stripAlignedStatementNoteReference(numbers, rawRow, rawPageText) {
  if (!Array.isArray(numbers) || numbers.length < 3) return { numbers, stripped: false, noteValue: null };
  const first = Number(numbers[0]);
  if (!Number.isInteger(first) || first < 1 || first > 99) return { numbers, stripped: false, noteValue: null };
  const firstRaw = rawNumericStarts(rawRow)[0] || null;
  if (!firstRaw) return { numbers, stripped: false, noteValue: null };
  const columns = statementNoteColumns(rawPageText);
  const aligned = columns.some((column) => Math.abs(firstRaw.index - column) <= 8);
  if (!aligned) return { numbers, stripped: false, noteValue: null };
  return { numbers: numbers.slice(1), stripped: true, noteValue: first };
}

`;

replaceRequired(
  'function statementValues(numbers, pageText, contexts) {',
  `${noteHelpers}function statementValues(numbers, pageText, contexts, rawRow = '') {`,
  'statement note-column helpers',
);

replaceRegexRequired(
  /function statementValues\(numbers, pageText, contexts, rawRow = ''\) \{[\s\S]*?\n\}\n\nfunction detectScaleMultiplier/,
  `function statementValues(numbers, pageText, contexts, rawRow = '') {
  const noteAdjusted = stripAlignedStatementNoteReference(numbers, rawRow, pageText);
  const effectiveNumbers = noteAdjusted.numbers;
  const layout = statementColumnLayout(pageText, contexts, effectiveNumbers);
  if (!layout || layout.mode === 'STANDARD') {
    return {
      values: effectiveNumbers,
      policy: noteAdjusted.stripped ? 'ALIGNED_NOTE_COLUMN_VALUES_V1' : 'STANDARD_STATEMENT_VALUES_V1',
      layout,
      noteReferenceRemoved: noteAdjusted.stripped,
      noteReference: noteAdjusted.noteValue,
    };
  }
  if (layout.mode === 'INCOME_CONTINUING_DISCONTINUED_TOTAL') {
    if (effectiveNumbers.length >= 6) return { values: [effectiveNumbers[2], effectiveNumbers[5]], policy: 'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1', layout, noteReferenceRemoved: noteAdjusted.stripped, noteReference: noteAdjusted.noteValue };
    if (effectiveNumbers.length >= 4) return { values: [effectiveNumbers[2], effectiveNumbers[3]], policy: 'GROUP_TOTAL_PARTIAL_COMPARATIVE_V1', layout, noteReferenceRemoved: noteAdjusted.stripped, noteReference: noteAdjusted.noteValue };
  }
  return { values: effectiveNumbers, policy: 'STANDARD_STATEMENT_VALUES_V1', layout, noteReferenceRemoved: noteAdjusted.stripped, noteReference: noteAdjusted.noteValue };
}

function detectScaleMultiplier`,
  'ALIGNED_NOTE_COLUMN_VALUES_V1',
  'statementValues body',
);

replaceRequired(
  "    const lines = pages[pageIndex].split(/\\r?\\n/).map(normalizeText).filter(Boolean);\n    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {\n      const row = lines[lineIndex];",
  "    const lineEntries = pages[pageIndex].split(/\\r?\\n/).map((rawLine) => ({ rawLine, row: normalizeText(rawLine) })).filter((entry) => entry.row);\n    const lines = lineEntries.map((entry) => entry.row);\n    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {\n      const row = lines[lineIndex];\n      const rawRow = lineEntries[lineIndex]?.rawLine || row;",
  'raw statement row preservation',
);

replaceRequired(
  '      const columnSelection = statementValues(numbers, pageText, contexts);',
  '      const columnSelection = statementValues(numbers, pages[pageIndex], contexts, rawRow);',
  'raw note-column selection call',
);

replaceRequired(
  `    const bankPassport = candidateSnapshot?.specializedModels?.bank || null;
    const genericCoverage = Number(candidateSnapshot?.coverage?.available || 0);
    const bankCoreCoverage = Number(bankPassport?.coverage?.core?.availableCount || 0);
    const accountingCoverage = bankPassport ? bankCoreCoverage : genericCoverage;
    const financialStatementVerified = accountingCoverage >= Number(options.minimumFinancialStatementFacts || 3);

    if (!financialStatementVerified) {`,
  `    const bankPassport = candidateSnapshot?.specializedModels?.bank || null;
    const genericCoverage = Number(candidateSnapshot?.coverage?.available || 0);
    const bankCoreCoverage = Number(bankPassport?.coverage?.core?.availableCount || 0);
    const accountingCoverage = bankPassport ? bankCoreCoverage : genericCoverage;
    const minimumFacts = Number(options.minimumFinancialStatementFacts || 3);
    const genericFacts = [
      ...Object.values(candidateSnapshot?.annual || {}).flatMap((value) => Array.isArray(value) ? value : []),
      ...Object.values(candidateSnapshot?.instant || {}).filter(Boolean),
    ];
    const genericAuthorityReady = bankPassport
      ? true
      : genericFacts.length >= minimumFacts && genericFacts.every((fact) => Number(fact?.provenance?.statementAuthorityScore || 0) > 0);
    const financialStatementVerified = bankPassport
      ? bankCoreCoverage >= minimumFacts
      : accountingCoverage >= minimumFacts && genericAuthorityReady;

    if (!financialStatementVerified) {`,
  'candidate statement-authority gate',
);

replaceRequired(
  `        reason: 'INSUFFICIENT_FINANCIAL_STATEMENT_CONTENT',
        extractionStatus: extracted.status,
        accountingCoverage,
        genericCoverage,
        bankCoreCoverage,`,
  `        reason: !bankPassport && accountingCoverage >= minimumFacts && !genericAuthorityReady
          ? 'STATEMENT_AUTHORITY_NOT_VERIFIED'
          : 'INSUFFICIENT_FINANCIAL_STATEMENT_CONTENT',
        extractionStatus: extracted.status,
        accountingCoverage,
        genericCoverage,
        bankCoreCoverage,
        genericAuthorityReady,`,
  'candidate authority diagnostic',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'statementNoteColumns',
  'stripAlignedStatementNoteReference',
  'ALIGNED_NOTE_COLUMN_VALUES_V1',
  'const rawRow = lineEntries[lineIndex]?.rawLine || row;',
  'statementValues(numbers, pages[pageIndex], contexts, rawRow)',
  'genericAuthorityReady',
  'STATEMENT_AUTHORITY_NOT_VERIFIED',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.5.7.3 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.5.7.3 aligned note-column parsing and candidate authority gate applied.');
