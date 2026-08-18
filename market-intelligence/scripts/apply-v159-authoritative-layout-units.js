import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRegexRequired(regex, replacement, marker, label) {
  if (source.includes(marker)) return;
  regex.lastIndex = 0;
  if (!regex.test(source)) throw new Error(`v1.5.9 patch failed: missing ${label}`);
  regex.lastIndex = 0;
  source = source.replace(regex, replacement);
}

replaceRegexRequired(
  /function unitScaleDeclaration\(line\) \{[\s\S]*?\n\}/,
  `function unitScaleDeclaration(line) {
  const text = normalizedScaleLine(line);
  if (!text) return null;
  const explicitPatterns = [
    /^(?:\\(?\\s*)?(?:amounts?|figures?)\\s+(?:are\\s+)?(?:presented\\s+|expressed\\s+|stated\\s+)?in\\s+(?:€\\s*)?(?:(?:eur|euro|euros)\\s+)?(thousand|thousands|000|million|millions|mn)\\b/,
    /^(?:\\(?\\s*)?(?:amounts?|figures?)\\s+(?:are\\s+)?(?:presented\\s+|expressed\\s+|stated\\s+)?in\\s+(thousand|thousands|million|millions)\\s+of\\s+(?:eur|euro|euros)\\b/,
    /^(?:\\(?\\s*)?in\\s+(thousand|thousands|million|millions)\\s+of\\s+(?:eur|euro|euros)\\b/,
    /^(?:\\(?\\s*)?(?:amounts?|figures?)\\s+(?:are\\s+)?(?:presented\\s+|expressed\\s+|stated\\s+)?in\\s+(?:€|eur|euro|euros)\\s*(000|mn)\\b/,
  ];
  for (const pattern of explicitPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const unit = String(match[1] || '').toLowerCase();
    return /million|mn/.test(unit) ? 1_000_000 : 1_000;
  }

  // Reviewed IFRS packs often place the unit declaration in a repeated
  // statement title/footer rather than on a standalone "Amounts in ..." row.
  // Accept that suffix only when the same line is structurally tied to the
  // financial statements; narrative sentences containing monetary amounts do
  // not qualify as a document-wide scale declaration.
  const authoritativeStatementLine = /(?:financial statements?|statement of (?:comprehensive income|financial position|cash flows?)|income statement|balance sheet|cash flow statement)/.test(text);
  if (authoritativeStatementLine) {
    const suffix = text.match(/\\(\\s*in\\s+(thousand|thousands|million|millions)\\s+of\\s+(?:eur|euro|euros)\\s*\\)/);
    if (suffix) return /million/.test(String(suffix[1] || '')) ? 1_000_000 : 1_000;
  }
  return null;
}`,
  'authoritativeStatementLine',
  'authoritative parenthetical unit declaration',
);

replaceRegexRequired(
  /function statementColumnLayout\(pageText, contexts = \[\]\) \{[\s\S]*?\n\}/,
  `function explicitGroupCompanyColumns(pageText) {
  const lines = String(pageText || '')
    .split(/\\r?\\n/)
    .map((line) => normalizeLine(line))
    .filter(Boolean)
    .slice(0, 45);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // Structural table headers such as "GROUP COMPANY" are authoritative.
    // Ordinary prose mentioning both words is intentionally ignored.
    if (/^(?:group\\s+company|company\\s+group)$/.test(line)) return true;
    if (/^(?:group\\s+company|company\\s+group)\\s+(?:note\\s+)?(?:20\\d{2}|\\d{1,2}[./-]\\d{1,2}[./-]20\\d{2})/.test(line)) return true;

    const next = lines[index + 1] || '';
    if ((line === 'group' && next === 'company') || (line === 'company' && next === 'group')) return true;
  }
  return false;
}

function statementColumnLayout(pageText, contexts = []) {
  const text = normalizeLine(pageText);
  const hasGroupCompany = explicitGroupCompanyColumns(pageText);
  const hasContinuing = /\\bcontinuing\\b/.test(text);
  const hasDiscontinued = /\\bdiscontinued\\b/.test(text);
  if (contexts.includes('INCOME_STATEMENT') && hasContinuing && hasDiscontinued) {
    return { policy: 'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1', expectedColumns: 6, currentIndex: 2, comparativeIndex: 5 };
  }
  if (hasGroupCompany) {
    return { policy: 'GROUP_CURRENT_COMPARATIVE_V1', expectedColumns: 4, currentIndex: 0, comparativeIndex: 1 };
  }
  return { policy: 'STANDARD_CURRENT_COMPARATIVE_V1', expectedColumns: 2, currentIndex: 0, comparativeIndex: 1 };
}`,
  'function explicitGroupCompanyColumns(pageText)',
  'structural Group/Company column detection',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'authoritativeStatementLine',
  'function explicitGroupCompanyColumns(pageText)',
  "const hasGroupCompany = explicitGroupCompanyColumns(pageText);",
  "policy: 'GROUP_CURRENT_COMPARATIVE_V1'",
  "policy: 'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1'",
  'statementPageAuthorityScore',
  'stripAlignedStatementNoteReference',
  'normalizePdfGlyphs',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.5.9 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.5.9 authoritative unit suffix and structural statement-column layout applied.');
