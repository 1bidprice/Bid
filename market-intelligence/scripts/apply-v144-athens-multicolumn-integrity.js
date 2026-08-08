import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.4.4 Athens multi-column patch failed: missing ${label}`);
  source = source.replace(from, to);
}

function insertBefore(marker, content, verificationMarker, label) {
  if (source.includes(verificationMarker)) return;
  if (!source.includes(marker)) throw new Error(`v1.4.4 Athens multi-column patch failed: missing ${label}`);
  source = source.replace(marker, `${content}\n\n${marker}`);
}

replaceRequired(
  "    /balance sheet/i,",
  "    /^\\s*(?:condensed\\s+)?balance sheet\\b/im,",
  'strict balance-sheet heading',
);

insertBefore(
  'function findMetricRow(pages, labels, options = {}) {',
  `function metricLabelTailAllowed(normalized, labelMatch, options = {}) {
  if (!labelMatch?.normalizedLabel) return false;
  const start = normalized.indexOf(labelMatch.normalizedLabel);
  if (start < 0) return false;
  const remainder = normalized.slice(start + labelMatch.normalizedLabel.length);
  const firstNumber = remainder.search(/(?:\\(|^|\\s)[-+]?\\d/);
  const tail = (firstNumber >= 0 ? remainder.slice(0, firstNumber) : remainder).trim();
  if (!tail) return true;
  if (/^[\\s·•*\\-–—:()./]+$/u.test(tail)) return true;
  // Explicit statement row/note codes are valid after a row label. This is
  // intentionally bounded: prose such as "related to assets held for sale"
  // or "at period start" remains rejected.
  if (/^(?:note\\s*)?(?:[a-z]\\.)?\\d+(?:[.]\\d+)*$/iu.test(tail)) return true;
  if (/^\\(?[a-z]\\)?$/iu.test(tail)) return true;
  if (options.allowUnitQualifier === true && /^\\(?\\s*in\\s+(?:eur|euro|euros|€)(?:\\s+thousands?)?\\s*\\)?$/iu.test(tail)) return true;
  return false;
}

function statementColumnLayout(pageText, contexts = []) {
  const text = normalizeLine(pageText);
  const hasGroupCompany = /\\bgroup\\b/.test(text) && /\\bcompany\\b/.test(text);
  const hasContinuing = /continuing operations/.test(text);
  const hasDiscontinued = /discontinued operations/.test(text);
  if (contexts.includes('INCOME_STATEMENT') && hasContinuing && hasDiscontinued) {
    return { policy: 'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1', expectedColumns: 6, currentIndex: 2, comparativeIndex: 5 };
  }
  if (hasGroupCompany) {
    return { policy: 'GROUP_CURRENT_COMPARATIVE_V1', expectedColumns: 4, currentIndex: 0, comparativeIndex: 1 };
  }
  return { policy: 'STANDARD_CURRENT_COMPARATIVE_V1', expectedColumns: 2, currentIndex: 0, comparativeIndex: 1 };
}

function statementValues(numbers, pageText, contexts = []) {
  const layout = statementColumnLayout(pageText, contexts);
  let values = [...numbers];
  if (
    values.length === layout.expectedColumns + 1 &&
    /^\\d{1,2}$/.test(String(values[0]?.raw || '').replace(/[()]/g, ''))
  ) {
    values = values.slice(1);
  }
  if (values.length < layout.expectedColumns) return null;
  if (layout.expectedColumns > 2 && values.length > layout.expectedColumns) return null;
  const current = values[layout.currentIndex];
  const comparative = values[layout.comparativeIndex];
  if (!current || !comparative) return null;
  return { selected: [current, comparative], layout };
}`,
  'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1',
  'statement column-layout helpers',
);

replaceRequired(
  `      const label = labelMatch?.label || null;
      if (!label) continue;
      if (options.exclude?.some((candidate) => normalized.includes(normalizeLine(candidate)))) continue;`,
  `      const label = labelMatch?.label || null;
      if (!label) continue;
      if (!metricLabelTailAllowed(normalized, labelMatch, options)) continue;
      if (options.exclude?.some((candidate) => normalized.includes(normalizeLine(candidate)))) continue;`,
  'exact metric row tail gate',
);

replaceRequired(
  `      const numbers = financialNumericTokens(line, { decimalMode: options.decimalMode === true });
      const needed = Number(options.minimumNumbers || 2);
      if (numbers.length < needed || numbers.length > maximumNumbers) continue;
      const selected = numbers.slice(0, Math.max(needed, 2));`,
  `      const numbers = financialNumericTokens(line, { decimalMode: options.decimalMode === true });
      const needed = Number(options.minimumNumbers || 2);
      if (numbers.length < needed) continue;
      const columnSelection = statementValues(numbers, pageText, contexts);
      if (!columnSelection) {
        if (numbers.length > maximumNumbers) continue;
      }
      const selected = columnSelection?.selected || numbers.slice(0, Math.max(needed, 2));`,
  'multi-column value selection',
);

replaceRequired(
  `        numberMode: options.decimalMode === true ? 'DECIMAL' : 'FINANCIAL_AMOUNT',
        selectionScore:`,
  `        numberMode: options.decimalMode === true ? 'DECIMAL' : 'FINANCIAL_AMOUNT',
        statementColumnPolicy: columnSelection?.layout?.policy || 'STANDARD_CURRENT_COMPARATIVE_V1',
        statementColumnCount: columnSelection?.layout?.expectedColumns || 2,
        selectionScore:`,
  'column-selection audit fields',
);

replaceRequired(
  `      numberMode: row.numberMode || null,
    },`,
  `      numberMode: row.numberMode || null,
      statementColumnPolicy: row.statementColumnPolicy || null,
      statementColumnCount: Number.isFinite(Number(row.statementColumnCount)) ? Number(row.statementColumnCount) : null,
    },`,
  'column policy provenance',
);

replaceRequired(
  "  const revenueRow = findMetricRow(pages, ['sales', 'revenue', 'turnover'], { statementContexts: ['INCOME_STATEMENT'], exclude: ['cost of sales', 'revenue reserve', 'revenue recognition'] });",
  "  const revenueRow = findMetricRow(pages, ['revenue from sale of inventories', 'revenue from contracts with customers', 'sales', 'revenue', 'turnover'], { statementContexts: ['INCOME_STATEMENT'], exclude: ['cost of sales', 'revenue reserve', 'revenue recognition'] });",
  'canonical extended revenue labels',
);

replaceRequired(
  "  const netIncomeRow = findMetricRow(pages, ['net profit for the period', 'profit for the period', 'profit after tax', 'profit after taxes', 'net income'], { statementContexts: ['INCOME_STATEMENT'], exclude: ['before tax', 'before taxes'] });",
  "  const netIncomeRow = findMetricRow(pages, ['net profit/ (loss) for the period', 'net profit/(loss) for the period', 'net profit for the period', 'profit/(loss) for the period', 'profit for the period', 'profit after tax', 'profit after taxes', 'net income'], { statementContexts: ['INCOME_STATEMENT'], exclude: ['before tax', 'before taxes'] });",
  'profit-loss row labels',
);

replaceRequired(
  "  const cashRow = findMetricRow(pages, ['cash and cash equivalents', 'cash & cash equivalents'], { statementContexts: ['BALANCE_SHEET'], exclude: ['beginning of period', 'end of period', 'change in'] });",
  "  const cashRow = findMetricRow(pages, ['cash and cash equivalents', 'cash & cash equivalents'], { statementContexts: ['BALANCE_SHEET'], exclude: ['beginning of period', 'end of period', 'change in', 'period start', 'at period start'] });",
  'cash period-start exclusion',
);

replaceRequired(
  "  const epsRow = findMetricRow(pages, ['basic and diluted', 'basic & diluted', 'diluted earnings per share'], { statementContexts: ['INCOME_STATEMENT'], minimumNumbers: 2, maximumNumbers: 4, decimalMode: true });",
  "  const epsRow = findMetricRow(pages, ['restated basic earnings per share', 'basic earnings per share', 'basic and diluted', 'basic & diluted', 'diluted earnings per share'], { statementContexts: ['INCOME_STATEMENT'], minimumNumbers: 2, maximumNumbers: 8, decimalMode: true, allowUnitQualifier: true });",
  'multi-column EPS label support',
);

replaceRequired(
  `function derivedShares(netIncome, epsRow, period) {
  const eps = epsRow?.values?.slice(-2)?.[0];`,
  `function derivedShares(netIncome, epsRow, period) {
  if (epsRow?.statementColumnPolicy === 'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1') return [];
  const eps = epsRow?.values?.slice(-2)?.[0];`,
  'disable unsafe complex EPS share derivation',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'metricLabelTailAllowed',
  'statementColumnLayout',
  'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1',
  'GROUP_CURRENT_COMPARATIVE_V1',
  'statementColumnPolicy',
  'revenue from sale of inventories',
  'net profit/ (loss) for the period',
  "exclude: ['beginning of period', 'end of period', 'change in', 'period start', 'at period start']",
  "if (epsRow?.statementColumnPolicy === 'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1') return [];",
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.4.4 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.4.4 Athens multi-column statement integrity applied.');
