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
  const current = normalizeLine(String(pages[pageIndex] || ''));
  const previous = pageIndex > 0 ? normalizeLine(String(pages[pageIndex - 1] || '')) : '';
  const vicinity = current + ' ' + previous;
  let score = 0;

  // Audited/reviewed statement sections outrank Board Report, APM and ratio
  // summaries even when those summaries contain words such as "Income Statement".
  if (/summary interim financial statements|interim condensed financial information|interim financial statements|condensed financial statements/.test(vicinity)) score += 300;
  if (/notes? to (?:the )?(?:interim |condensed |consolidated )?financial statements/.test(current)) score -= 80;
  if (/board of directors report|review of h1 .* results|remarks on key figures|alternative performance measures|profitability ratios|definitions of financial figures/.test(current)) score -= 180;

  // A page headed by the requested primary statement receives a bounded bonus.
  if (contexts.includes('INCOME_STATEMENT') && /(?:^|\n)\s*(?:income statement|statement of comprehensive income)\b/i.test(String(pages[pageIndex] || ''))) score += 80;
  if (contexts.includes('BALANCE_SHEET') && /(?:^|\n)\s*(?:statement of financial position|(?:condensed )?balance sheet)\b/i.test(String(pages[pageIndex] || ''))) score += 80;
  if (contexts.includes('CASH_FLOW') && /(?:^|\n)\s*(?:statement of cash flows?|cash flow statement)\b/i.test(String(pages[pageIndex] || ''))) score += 80;
  return score;
}`,
  'statementPageAuthorityScore',
  'statement authority scorer',
);

replaceRequired(
  `    const contextScore = statementContextScore(pages, pageIndex, contexts);
    if (contexts.length && contextScore <= 0) continue;`,
  `    const baseContextScore = statementContextScore(pages, pageIndex, contexts);
    if (contexts.length && baseContextScore <= 0) continue;
    const authorityScore = statementPageAuthorityScore(pages, pageIndex, contexts);
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
  `      statementColumnCount: Number.isFinite(Number(row.statementColumnCount)) ? Number(row.statementColumnCount) : null,
    },`,
  `      statementColumnCount: Number.isFinite(Number(row.statementColumnCount)) ? Number(row.statementColumnCount) : null,
      statementAuthorityScore: Number.isFinite(Number(row.statementAuthorityScore)) ? Number(row.statementAuthorityScore) : null,
    },`,
  'authority provenance',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'statementPageAuthorityScore',
  'summary interim financial statements',
  'alternative performance measures',
  'const authorityScore = statementPageAuthorityScore',
  'columnSelection ? 0 : Math.max(0, numbers.length - needed) * 4',
  'statementAuthorityScore: authorityScore',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.4.5 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.4.5 Athens statement authority gate applied.');
