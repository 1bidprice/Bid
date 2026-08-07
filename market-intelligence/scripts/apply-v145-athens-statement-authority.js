import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.4.5 statement-authority patch failed: missing ${label}`);
  source = source.replace(from, to);
}

function insertBefore(marker, content, verificationMarker, label) {
  if (source.includes(verificationMarker)) return;
  if (!source.includes(marker)) throw new Error(`v1.4.5 statement-authority patch failed: missing ${label}`);
  source = source.replace(marker, `${content}\n\n${marker}`);
}

insertBefore(
  'function findMetricRow(pages, labels, options = {}) {',
  `function statementPageAuthorityScore(pages, pageIndex, contexts = []) {
  const rawCurrent = String(pages[pageIndex] || '');
  const current = normalizeLine(rawCurrent);
  const previous = pageIndex > 0 ? normalizeLine(String(pages[pageIndex - 1] || '')) : '';
  const vicinity = current + ' ' + previous;
  const lines = rawCurrent.split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean);
  let score = 0;

  // Audited/reviewed statement sections outrank Board Report, APM and ratio
  // summaries even when those summaries contain words such as "Income Statement".
  if (/summary interim financial statements|interim condensed financial information|interim financial statements|condensed financial statements/.test(vicinity)) score += 300;
  if (/notes? to (?:the )?(?:interim |condensed |consolidated )?financial statements/.test(current)) score -= 80;
  if (/board of directors report|review of h1 .* results|remarks on key figures|alternative performance measures|profitability ratios|definitions of financial figures/.test(current)) score -= 180;

  // The primary Income Statement outranks comprehensive-income recaps for
  // revenue/profit extraction. Condensed variants are equally authoritative.
  if (contexts.includes('INCOME_STATEMENT')) {
    if (lines.some((line) => /^(?:condensed )?income statement(?: |$)/i.test(line))) score += 140;
    else if (lines.some((line) => /^(?:condensed )?statement of comprehensive income(?: |$)/i.test(line))) score += 40;
  }
  if (contexts.includes('BALANCE_SHEET') && lines.some((line) => /^(?:(?:condensed )?statement of financial position|(?:condensed )?balance sheet)(?: |$)/i.test(line))) score += 140;
  if (contexts.includes('CASH_FLOW') && lines.some((line) => /^(?:condensed )?(?:statement of cash flows?|cash flow statement)(?: |$)/i.test(line))) score += 140;
  return score;
}

function hasAuthoritativeFinancialStatementSection(pages) {
  return pages.some((page) => /summary interim financial statements|interim condensed financial information|interim financial statements|condensed financial statements/i.test(String(page || '')));
}`,
  'hasAuthoritativeFinancialStatementSection',
  'statement authority scorer',
);

replaceRequired(
  `  const contexts = Array.isArray(options.statementContexts) ? options.statementContexts : [];
  const maximumNumbers = Number(options.maximumNumbers || 4);
  const candidates = [];

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {`,
  `  const contexts = Array.isArray(options.statementContexts) ? options.statementContexts : [];
  const maximumNumbers = Number(options.maximumNumbers || 4);
  const candidates = [];
  const authoritativeSectionPresent = contexts.length > 0 && hasAuthoritativeFinancialStatementSection(pages);

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {`,
  'document-level authoritative statement gate',
);

replaceRequired(
  `    const contextScore = statementContextScore(pages, pageIndex, contexts);
    if (contexts.length && contextScore <= 0) continue;`,
  `    const baseContextScore = statementContextScore(pages, pageIndex, contexts);
    if (contexts.length && baseContextScore <= 0) continue;
    const authorityScore = statementPageAuthorityScore(pages, pageIndex, contexts);
    if (authoritativeSectionPresent && authorityScore <= 0) continue;
    const contextScore = baseContextScore + authorityScore;`,
  'authority-aware context score',
);

replaceRequired(
  `        statementColumnCount: columnSelection?.layout?.expectedColumns || 2,
        selectionScore: contextScore + (labelMatch?.score || 0) - notesPenalty - Math.max(0, numbers.length - needed) * 4,`,
  `        statementColumnCount: columnSelection?.layout?.expectedColumns || 2,
        statementAuthorityScore: authorityScore,
        selectionScore: contextScore + (labelMatch?.score || 0) - notesPenalty - (columnSelection ? 0 : Math.max(0, numbers.length - needed) * 4),`,
  'recognized multi-column rows are not penalized',
);

replaceRequired(
  `  return candidates.sort((a, b) => b.selectionScore - a.selectionScore || a.pageNumber - b.pageNumber)[0] || null;`,
  `  const ranked = candidates.sort((a, b) => b.selectionScore - a.selectionScore || a.pageNumber - b.pageNumber);
  if (!ranked.length) return null;
  const winner = ranked[0];
  winner.candidateAudit = ranked.slice(0, 5).map((candidate) => ({
    pageNumber: candidate.pageNumber,
    line: candidate.line,
    selectionScore: candidate.selectionScore,
    contextScore: candidate.contextScore,
    statementAuthorityScore: candidate.statementAuthorityScore,
    statementColumnPolicy: candidate.statementColumnPolicy,
    statementColumnCount: candidate.statementColumnCount,
  }));
  return winner;`,
  'candidate ranking audit',
);

replaceRequired(
  `      statementColumnCount: Number.isFinite(Number(row.statementColumnCount)) ? Number(row.statementColumnCount) : null,
    },`,
  `      statementColumnCount: Number.isFinite(Number(row.statementColumnCount)) ? Number(row.statementColumnCount) : null,
      statementAuthorityScore: Number.isFinite(Number(row.statementAuthorityScore)) ? Number(row.statementAuthorityScore) : null,
      candidateAudit: Array.isArray(row.candidateAudit) ? row.candidateAudit : [],
    },`,
  'authority provenance',
);

replaceRequired(
  `  if (epsRow?.statementColumnPolicy === 'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1') return [];`,
  `  if (epsRow?.statementColumnPolicy === 'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1' || Number(epsRow?.statementColumnCount || 2) > 2) return [];`,
  'complex EPS share-derivation guard',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'statementPageAuthorityScore',
  'hasAuthoritativeFinancialStatementSection',
  'authoritativeSectionPresent && authorityScore <= 0',
  '(?:condensed )?income statement',
  '(?:condensed )?statement of comprehensive income',
  '(?:condensed )?statement of financial position',
  '(?:condensed )?(?:statement of cash flows?',
  'candidateAudit',
  'columnSelection ? 0 : Math.max(0, numbers.length - needed) * 4',
  'Number(epsRow?.statementColumnCount || 2) > 2',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.4.5 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.4.5 Athens statement authority gate applied.');
