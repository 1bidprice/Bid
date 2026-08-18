import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.4.1 statement-context patch failed: missing ${label}`);
  source = source.replace(from, to);
}

if (!source.includes('const STATEMENT_CONTEXT_PATTERNS = Object.freeze(')) {
  replaceRequired(
    `function financialNumericTokens(line) {
  return numericTokens(scrubMetricLine(line)).filter((item) => {
    const value = Number(item.value);
    const yearLike = Number.isInteger(value) && value >= 1900 && value <= 2100 && /^[-+]?\\d{4}$/.test(String(item.raw || '').trim());
    return !yearLike;
  });
}

function findMetricRow`,
    `function financialNumericTokens(line) {
  return numericTokens(scrubMetricLine(line)).filter((item) => {
    const value = Number(item.value);
    const yearLike = Number.isInteger(value) && value >= 1900 && value <= 2100 && /^[-+]?\\d{4}$/.test(String(item.raw || '').trim());
    return !yearLike;
  });
}

const STATEMENT_CONTEXT_PATTERNS = Object.freeze({
  INCOME_STATEMENT: [
    /statement of (?:comprehensive income|profit (?:or|and) loss|income)/i,
    /(?:consolidated|condensed|interim) (?:statement of )?(?:comprehensive income|profit (?:or|and) loss|income statement)/i,
    /income statement/i,
    /κατάσταση (?:συνολικού εισοδήματος|αποτελεσμάτων)/i,
    /αποτελέσματα (?:χρήσης|περιόδου)/i,
  ],
  BALANCE_SHEET: [
    /statement of financial position/i,
    /balance sheet/i,
    /κατάσταση (?:χρηματοοικονομικής|οικονομικής) θέσης/i,
    /ισολογισμ/i,
  ],
  CASH_FLOW: [
    /statement of cash flows?/i,
    /cash flows? statement/i,
    /κατάσταση ταμειακών ροών/i,
    /ταμειακές ροές/i,
  ],
});

function statementContextScore(pages, pageIndex, contexts = []) {
  if (!contexts.length) return 1;
  const current = String(pages[pageIndex] || '');
  const previous = pageIndex > 0 ? String(pages[pageIndex - 1] || '') : '';
  let best = 0;
  for (const context of contexts) {
    const patterns = STATEMENT_CONTEXT_PATTERNS[context] || [];
    if (patterns.some((pattern) => pattern.test(current))) best = Math.max(best, 100);
    else if (previous && patterns.some((pattern) => pattern.test(previous))) best = Math.max(best, 60);
  }
  return best;
}

function findMetricRow`,
    'statement context classifier',
  );
}

const oldFind = /function findMetricRow\(pages, labels, options = \{\}\) \{[\s\S]*?\n\}\n\nfunction metricPair/;
if (!source.includes("selectionPolicy: 'ACCOUNTING_STATEMENT_CONTEXT_V1'")) {
  const match = source.match(oldFind);
  if (!match) throw new Error('v1.4.1 statement-context patch failed: findMetricRow body not found');
  source = source.replace(oldFind, `function findMetricRow(pages, labels, options = {}) {
  const maxPages = Math.min(pages.length, Number(options.maxPages || pages.length || 0));
  const contexts = Array.isArray(options.statementContexts) ? options.statementContexts : [];
  const maximumNumbers = Number(options.maximumNumbers || 4);
  const candidates = [];

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const contextScore = statementContextScore(pages, pageIndex, contexts);
    if (contexts.length && contextScore <= 0) continue;
    const pageText = String(pages[pageIndex] || '');
    const notesPenalty = /notes? to (?:the )?(?:interim |consolidated )?financial statements/i.test(pageText) ? 35 : 0;
    const lines = pageText.split(/\\n+/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const normalized = normalizeLine(line);
      const label = labels.find((candidate) => normalized.includes(candidate));
      if (!label) continue;
      if (options.exclude?.some((candidate) => normalized.includes(candidate))) continue;
      if (looksLikeTableOfContentsLine(line)) continue;
      if (looksLikeNarrativeMetricLine(line)) continue;
      const numbers = financialNumericTokens(line);
      const needed = Number(options.minimumNumbers || 2);
      if (numbers.length < needed || numbers.length > maximumNumbers) continue;
      const selected = numbers.slice(0, Math.max(needed, 2));
      candidates.push({
        label,
        line,
        pageNumber: pageIndex + 1,
        values: selected.map((item) => item.value),
        scaleMultiplier: metricLineScale(line),
        extractionPolicy: 'STATEMENT_ROW_ONLY_V2',
        selectionPolicy: 'ACCOUNTING_STATEMENT_CONTEXT_V1',
        statementContexts: contexts,
        contextScore,
        selectionScore: contextScore - notesPenalty - Math.max(0, numbers.length - needed) * 4,
      });
    }
  }

  return candidates.sort((a, b) => b.selectionScore - a.selectionScore || a.pageNumber - b.pageNumber)[0] || null;
}

function metricPair`);
}

replaceRequired(
  `    provenance: { pageNumber: row.pageNumber, extractedLine: row.line, sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT' },`,
  `    provenance: {
      pageNumber: row.pageNumber,
      extractedLine: row.line,
      sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT',
      metricExtractionPolicy: row.extractionPolicy || null,
      selectionPolicy: row.selectionPolicy || null,
      statementContexts: row.statementContexts || [],
      contextScore: Number.isFinite(Number(row.contextScore)) ? Number(row.contextScore) : null,
    },`,
  'metric statement-selection provenance',
);

replaceRequired(
  `    provenance: { pageNumber: epsRow.pageNumber, extractedLine: epsRow.line, derivation: 'netIncome / reported basic-and-diluted EPS' },`,
  `    provenance: {
      pageNumber: epsRow.pageNumber,
      extractedLine: epsRow.line,
      derivation: 'netIncome / reported basic-and-diluted EPS',
      sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT',
      metricExtractionPolicy: epsRow.extractionPolicy || null,
      selectionPolicy: epsRow.selectionPolicy || null,
      statementContexts: epsRow.statementContexts || [],
      contextScore: Number.isFinite(Number(epsRow.contextScore)) ? Number(epsRow.contextScore) : null,
    },`,
  'derived-share statement-selection provenance',
);

replaceRequired(
  `  const revenueRow = findMetricRow(pages, ['sales', 'revenue', 'turnover'], { exclude: ['cost of sales', 'revenue reserve', 'revenue recognition'] });
  const netIncomeRow = findMetricRow(pages, ['net profit for the period', 'profit for the period', 'profit after tax', 'profit after taxes', 'net income'], { exclude: ['before tax', 'before taxes'] });
  const operatingCashFlowRow = findMetricRow(pages, ['cash flow from operating activities', 'net cash from operating activities', 'net cash generated from operating activities']);
  const capexRow = findMetricRow(pages, ['purchase of tangible and intangible assets', 'purchase of property, plant and equipment', 'payments to acquire property plant and equipment', 'capital expenditure']);
  const cashRow = findMetricRow(pages, ['cash and cash equivalents', 'cash & cash equivalents'], { exclude: ['beginning of period', 'end of period', 'change in'] });
  const assetsRow = findMetricRow(pages, ['total assets']);
  const liabilitiesRow = findMetricRow(pages, ['total liabilities'], { exclude: ['equity and liabilities'] });
  const equityRow = findMetricRow(pages, ['total equity', 'total shareholders equity', 'shareholders equity'], { exclude: ['equity and liabilities'] });
  const directSharesRow = findMetricRow(pages, ['weighted average number of diluted shares', 'weighted average number of shares', 'average number of shares'], { minimumNumbers: 1 });
  const epsRow = findMetricRow(pages, ['basic and diluted', 'basic & diluted', 'diluted earnings per share'], { minimumNumbers: 2 });`,
  `  const revenueRow = findMetricRow(pages, ['sales', 'revenue', 'turnover'], { statementContexts: ['INCOME_STATEMENT'], exclude: ['cost of sales', 'revenue reserve', 'revenue recognition'] });
  const netIncomeRow = findMetricRow(pages, ['net profit for the period', 'profit for the period', 'profit after tax', 'profit after taxes', 'net income'], { statementContexts: ['INCOME_STATEMENT'], exclude: ['before tax', 'before taxes'] });
  const operatingCashFlowRow = findMetricRow(pages, ['cash flow from operating activities', 'net cash from operating activities', 'net cash generated from operating activities'], { statementContexts: ['CASH_FLOW'] });
  const capexRow = findMetricRow(pages, ['purchase of tangible and intangible assets', 'purchase of property, plant and equipment', 'payments to acquire property plant and equipment', 'capital expenditure'], { statementContexts: ['CASH_FLOW'] });
  const cashRow = findMetricRow(pages, ['cash and cash equivalents', 'cash & cash equivalents'], { statementContexts: ['BALANCE_SHEET'], exclude: ['beginning of period', 'end of period', 'change in'] });
  const assetsRow = findMetricRow(pages, ['total assets'], { statementContexts: ['BALANCE_SHEET'] });
  const liabilitiesRow = findMetricRow(pages, ['total liabilities'], { statementContexts: ['BALANCE_SHEET'], exclude: ['equity and liabilities'] });
  const equityRow = findMetricRow(pages, ['total equity', 'total shareholders equity', 'shareholders equity'], { statementContexts: ['BALANCE_SHEET'], exclude: ['equity and liabilities'] });
  const directSharesRow = findMetricRow(pages, ['weighted average number of diluted shares', 'weighted average number of shares', 'average number of shares'], { statementContexts: ['INCOME_STATEMENT'], minimumNumbers: 1, maximumNumbers: 4 });
  const epsRow = findMetricRow(pages, ['basic and diluted', 'basic & diluted', 'diluted earnings per share'], { statementContexts: ['INCOME_STATEMENT'], minimumNumbers: 2, maximumNumbers: 4 });`,
  'metric-to-statement routing',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'STATEMENT_CONTEXT_PATTERNS',
  'ACCOUNTING_STATEMENT_CONTEXT_V1',
  'options.maxPages || pages.length',
  'numbers.length > maximumNumbers',
  'metricExtractionPolicy: row.extractionPolicy || null',
  'selectionPolicy: row.selectionPolicy || null',
  "statementContexts: ['INCOME_STATEMENT']",
  "statementContexts: ['BALANCE_SHEET']",
  "statementContexts: ['CASH_FLOW']",
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.4.1 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.4.1 Athens accounting-statement context gate applied.');
