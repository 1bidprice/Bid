import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

function insertBefore(marker, content, verificationMarker, label) {
  if (source.includes(verificationMarker)) return;
  if (!source.includes(marker)) throw new Error(`v1.6.1 audit patch failed: missing ${label}`);
  source = source.replace(marker, `${content}\n\n${marker}`);
}

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.6.1 audit patch failed: missing ${label}`);
  source = source.replace(from, to);
}

function replaceRegexRequired(regex, replacement, marker, label) {
  if (source.includes(marker)) return;
  regex.lastIndex = 0;
  if (!regex.test(source)) throw new Error(`v1.6.1 audit patch failed: missing ${label}`);
  regex.lastIndex = 0;
  source = source.replace(regex, replacement);
}

insertBefore(
  'function metricPair(row, scale, period, concept) {',
  `function boundedMetricRejectionAudit(pages, labels, options = {}) {
  const maxPages = Math.min(pages.length, Number(options.maxPages || pages.length || 0));
  const contexts = Array.isArray(options.statementContexts) ? options.statementContexts : [];
  const maximumNumbers = Number(options.maximumNumbers || 4);
  const needed = Number(options.minimumNumbers || 2);
  const authoritativeSectionPresent = contexts.length > 0 && hasAuthoritativeFinancialStatementSection(pages);
  const audit = [];
  const seen = new Set();

  const record = (reason, payload = {}) => {
    const key = [reason, payload.pageNumber || 0, String(payload.scopedLine || payload.physicalLine || '').slice(0, 120)].join('|');
    if (seen.has(key) || audit.length >= 12) return;
    seen.add(key);
    audit.push({
      reason,
      pageNumber: payload.pageNumber || null,
      physicalLine: String(payload.physicalLine || '').slice(0, 360),
      scopedLine: String(payload.scopedLine || '').slice(0, 280),
      label: payload.label || null,
      baseContextScore: Number.isFinite(Number(payload.baseContextScore)) ? Number(payload.baseContextScore) : null,
      statementAuthorityScore: Number.isFinite(Number(payload.statementAuthorityScore)) ? Number(payload.statementAuthorityScore) : null,
      numberCount: Number.isFinite(Number(payload.numberCount)) ? Number(payload.numberCount) : null,
      statementColumnPolicy: payload.statementColumnPolicy || null,
      rawRowOffset: Number.isFinite(Number(payload.rawRowOffset)) ? Number(payload.rawRowOffset) : 0,
    });
  };

  for (let pageIndex = 0; pageIndex < maxPages && audit.length < 12; pageIndex += 1) {
    const pageText = String(pages[pageIndex] || '');
    const baseContextScore = statementContextScore(pages, pageIndex, contexts);
    const authorityScore = statementPageAuthorityScore(pages, pageIndex, contexts);
    const entries = pageText.split(/\\n+/).map((rawLine) => ({ rawLine, line: rawLine.trim() })).filter((entry) => entry.line);

    for (const entry of entries) {
      if (audit.length >= 12) break;
      const rawRow = entry.rawLine;
      const physicalLine = entry.line;
      const scopedSegment = horizontalMetricRowSegment(rawRow, labels, needed);
      const scopedLine = scopedSegment?.line || physicalLine;
      const scopedRawRow = scopedSegment?.rawSegment || rawRow;
      const scopedRawOffset = Number(scopedSegment?.rawOffset || 0);
      const normalized = normalizeLine(scopedLine);
      const labelMatch = metricRowLabel(normalized, labels);
      if (!labelMatch) continue;

      const common = {
        pageNumber: pageIndex + 1,
        physicalLine,
        scopedLine,
        label: labelMatch.label,
        baseContextScore,
        statementAuthorityScore: authorityScore,
        rawRowOffset: scopedRawOffset,
      };

      if (contexts.length && baseContextScore <= 0) {
        record('CONTEXT_REJECTED', common);
        continue;
      }
      if (authoritativeSectionPresent && authorityScore <= 0) {
        record('AUTHORITY_REJECTED', common);
        continue;
      }
      if (!metricLabelTailAllowed(normalized, labelMatch, options)) {
        record('ROW_TAIL_REJECTED', common);
        continue;
      }
      if (options.exclude?.some((candidate) => normalized.includes(normalizeLine(candidate)))) {
        record('EXCLUDED_VARIANT', common);
        continue;
      }
      if (looksLikeTableOfContentsLine(scopedLine)) {
        record('TABLE_OF_CONTENTS_REJECTED', common);
        continue;
      }
      if (looksLikeNarrativeMetricLine(scopedLine)) {
        record('NARRATIVE_REJECTED', common);
        continue;
      }

      const numbers = financialNumericTokens(scopedLine, { decimalMode: options.decimalMode === true });
      if (numbers.length < needed) {
        record('INSUFFICIENT_NUMBERS', { ...common, numberCount: numbers.length });
        continue;
      }

      const columnSelection = statementValues(numbers, pageText, contexts, scopedRawRow, scopedRawOffset);
      if (!columnSelection && numbers.length > maximumNumbers) {
        record('COLUMN_LAYOUT_REJECTED', {
          ...common,
          numberCount: numbers.length,
          statementColumnPolicy: statementColumnLayout(pageText, contexts)?.policy || null,
        });
        continue;
      }

      record('ACCEPTABLE_CANDIDATE_NOT_SELECTED', {
        ...common,
        numberCount: numbers.length,
        statementColumnPolicy: columnSelection?.layout?.policy || 'STANDARD_CURRENT_COMPARATIVE_V1',
      });
    }
  }

  return audit;
}`,
  'function boundedMetricRejectionAudit(pages, labels, options = {})',
  'bounded metric rejection audit helper',
);

replaceRegexRequired(
  /(\s+const epsRow = findMetricRow\([^\n]+\);)/,
  `$1

  const metricRejectionAudit = {
    ...(capexRow ? {} : { capitalExpenditure: boundedMetricRejectionAudit(pages, ['purchase of tangible and intangible assets', 'purchase of property, plant and equipment', 'payments to acquire property plant and equipment', 'acquisition of property, plant and equipment and intangible assets', 'acquisition of property plant and equipment and intangible assets', 'capital expenditure'], { statementContexts: ['CASH_FLOW'] }) }),
    ...(cashRow ? {} : { cash: boundedMetricRejectionAudit(pages, ['cash and cash equivalents', 'cash & cash equivalents'], { statementContexts: ['BALANCE_SHEET'], exclude: ['beginning of period', 'end of period', 'change in', 'period start', 'at period start'] }) }),
    ...(assetsRow ? {} : { assets: boundedMetricRejectionAudit(pages, ['total assets'], { statementContexts: ['BALANCE_SHEET'] }) }),
    ...(liabilitiesRow ? {} : { liabilities: boundedMetricRejectionAudit(pages, ['total liabilities'], { statementContexts: ['BALANCE_SHEET'], exclude: ['equity and liabilities'] }) }),
    ...(equityRow ? {} : { equity: boundedMetricRejectionAudit(pages, ['total equity', 'total shareholders equity', 'shareholders equity'], { statementContexts: ['BALANCE_SHEET'], exclude: ['equity and liabilities'] }) }),
  };`,
  'const metricRejectionAudit = {',
  'missing-metric audit collection',
);

replaceRequired(
  `      numericSemanticsPolicy: 'FINANCIAL_TABLE_NUMBER_V1',`,
  `      numericSemanticsPolicy: 'FINANCIAL_TABLE_NUMBER_V1',
      metricRejectionAudit,`,
  'audit output in quality passport',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'function boundedMetricRejectionAudit(pages, labels, options = {})',
  "record('CONTEXT_REJECTED'",
  "record('AUTHORITY_REJECTED'",
  "record('ROW_TAIL_REJECTED'",
  "record('EXCLUDED_VARIANT'",
  "record('INSUFFICIENT_NUMBERS'",
  "record('COLUMN_LAYOUT_REJECTED'",
  "record('ACCEPTABLE_CANDIDATE_NOT_SELECTED'",
  'const metricRejectionAudit = {',
  'metricRejectionAudit,',
  'horizontalMetricRowSegment',
  'statementPageAuthorityScore',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.6.1 audit verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.6.1 bounded accounting metric rejection audit applied.');
