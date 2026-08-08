import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.5.7.1 share-note patch failed: missing ${label}`);
  source = source.replace(from, to);
}

replaceRequired(
  `  for (const context of contexts) {
    const patterns = STATEMENT_CONTEXT_PATTERNS[context] || [];
    if (patterns.some((pattern) => pattern.test(current))) best = Math.max(best, 100);
    else if (previous && patterns.some((pattern) => pattern.test(previous))) best = Math.max(best, 60);
  }`,
  `  for (const context of contexts) {
    if (context === 'SHARE_COUNT_NOTE') {
      const shareDisclosure = /(?:earnings per share|weighted average number of (?:ordinary|diluted )?shares)/i;
      if (shareDisclosure.test(current)) best = Math.max(best, 100);
      else if (previous && shareDisclosure.test(previous)) best = Math.max(best, 60);
      continue;
    }
    const patterns = STATEMENT_CONTEXT_PATTERNS[context] || [];
    if (patterns.some((pattern) => pattern.test(current))) best = Math.max(best, 100);
    else if (previous && patterns.some((pattern) => pattern.test(previous))) best = Math.max(best, 60);
  }`,
  'share-count disclosure context',
);

replaceRequired(
  `  if (contexts.includes('CASH_FLOW') && lines.some((line) => /^(?:condensed )?(?:statement of cash flows?|cash flow statement)(?: |$)/i.test(line))) score += 140;
  return score;`,
  `  if (contexts.includes('CASH_FLOW') && lines.some((line) => /^(?:condensed )?(?:statement of cash flows?|cash flow statement)(?: |$)/i.test(line))) score += 140;
  if (contexts.includes('SHARE_COUNT_NOTE')) {
    const hasEpsHeading = lines.some((line) => /(?:^|\\b)(?:earnings per share|eps)(?:\\b|$)/i.test(line));
    const hasWeightedShareRow = lines.some((line) => /^weighted average number of (?:ordinary|diluted )?shares\\b/i.test(line));
    if (hasEpsHeading && hasWeightedShareRow) score += 220;
    else if (hasWeightedShareRow) score += 160;
  }
  return score;`,
  'share-count note authority',
);

replaceRequired(
  "  const directSharesRow = findMetricRow(pages, ['weighted average number of diluted shares', 'weighted average number of ordinary shares', 'weighted average number of shares', 'average number of shares'], { statementContexts: ['INCOME_STATEMENT'], minimumNumbers: 1, maximumNumbers: 4, maxPages: 40 });",
  "  const directSharesRow = findMetricRow(pages, ['weighted average number of diluted shares', 'weighted average number of ordinary shares', 'weighted average number of shares', 'average number of shares'], { statementContexts: ['INCOME_STATEMENT', 'SHARE_COUNT_NOTE'], minimumNumbers: 1, maximumNumbers: 4, maxPages: 40 });",
  'direct share disclosure routing',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  "context === 'SHARE_COUNT_NOTE'",
  "contexts.includes('SHARE_COUNT_NOTE')",
  'hasWeightedShareRow',
  "statementContexts: ['INCOME_STATEMENT', 'SHARE_COUNT_NOTE']",
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.5.7.1 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.5.7.1 reviewed EPS share-count note context applied.');
