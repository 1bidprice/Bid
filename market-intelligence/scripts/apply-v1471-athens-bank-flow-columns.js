import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/athens-bank-passport.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.4.7.1 Athens bank flow-column patch failed: missing ${label}`);
  source = source.replace(from, to);
}

replaceRequired(
  `function dateNeedles(periodEnd) {`,
  `function findGroupPeriodFlowRow(pages, patterns, options = {}) {
  const exclude = options.exclude || [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = String(pages[pageIndex] || '');
    const pageValue = normalize(page);
    if (!statementPage(page)) continue;
    if (!/ενδιαμεση ενοποιημενη κατασταση αποτελεσματων|consolidated income statement|consolidated statement of profit/.test(pageValue)) continue;
    if (!/ομιλος|\\bgroup\\b/.test(pageValue)) continue;
    const lines = page.split(/\\n/);
    for (const line of lines) {
      const value = normalize(line);
      if (!matchesAny(value, patterns) || exclude.some((pattern) => pattern.test(value))) continue;
      const numbers = amountTokens(line);
      if (numbers.length < 2) continue;
      return {
        pageNumber: pageIndex + 1,
        line,
        scale: pageScale(page),
        current: numbers[0].value,
        previous: numbers[1].value,
        columnPolicy: 'GROUP_PERIOD_CURRENT_COMPARATIVE_V1',
      };
    }
  }
  return null;
}

function dateNeedles(periodEnd) {`,
  'consolidated period-flow row parser',
);

replaceRequired(
  `  const profitRow = findGroupFourColumnRow(pages, [/^κερδη περιοδου μετα απο φορ/, /^κερδη περιοδου μετα φορ/, /^profit for the period after tax/, /^net profit for the period/]);`,
  `  const profitRow = findGroupPeriodFlowRow(pages, [/^κερδη περιοδου μετα απο φορ/, /^κερδη περιοδου μετα φορ/, /^profit for the period after tax/, /^net profit for the period/]);`,
  'period profit row semantics',
);

replaceRequired(
  `  const periodNetIncome = profitRow ? moneyFact('PeriodNetIncome', profitRow.groupCurrent, profitRow.pageNumber, profitRow.line, profitRow.scale) : null;`,
  `  const periodNetIncome = profitRow ? moneyFact('PeriodNetIncome', profitRow.current, profitRow.pageNumber, profitRow.line, profitRow.scale, { provenance: { columnPolicy: profitRow.columnPolicy } }) : null;`,
  'period profit current column',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'findGroupPeriodFlowRow',
  "columnPolicy: 'GROUP_PERIOD_CURRENT_COMPARATIVE_V1'",
  "moneyFact('PeriodNetIncome', profitRow.current",
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.4.7.1 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.4.7 Athens bank period-flow column policy applied.');
