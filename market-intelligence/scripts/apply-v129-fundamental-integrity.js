import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.2.9 fundamental integrity patch failed: missing ${label}`);
  return content.replace(from, to);
}

function replaceRegexRequired(content, regex, replacement, marker, label) {
  if (content.includes(marker)) return content;
  let matched = false;
  const next = content.replace(regex, () => {
    matched = true;
    return replacement;
  });
  if (!matched) throw new Error(`v1.2.9 fundamental integrity patch failed: missing ${label}`);
  return next;
}

function patchAthensMetricExtraction() {
  let source = read('src/adapters/euronext-athens-fundamentals.js');

  const replacement = `function looksLikeTableOfContentsLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (/table of contents|contents/.test(lower) && raw.length < 160) return true;
  const dotLeader = /\\.{4,}|…{3,}/.test(raw);
  const trailingPageNumber = /\\s\\d{1,3}\\s*$/.test(raw);
  return dotLeader && trailingPageNumber;
}

function metricLineScale(line) {
  const text = String(line || '').toLowerCase();
  if (/\\b(million|millions|mn|mio)\\b|εκατ\\.?/.test(text)) return 1_000_000;
  if (/\\b(thousand|thousands)\\b|χιλ\\.?/.test(text)) return 1_000;
  return 1;
}

function scrubMetricLine(line) {
  return String(line || '')
    .replace(/^\\s*\\d+(?:\\.\\d+)+\\s+(?=[A-Za-zΑ-Ω])/iu, ' ')
    .replace(/\\b(?:note|σημ(?:είωση|ειωση)?\\.?)\\s*[A-ZΑ-Ω]?\\d+(?:\\.\\d+)*\\b/giu, ' ')
    .replace(/\\b[A-ZΑ-Ω]\\.\\d+(?:\\.\\d+)*\\b/gu, ' ');
}

function financialNumericTokens(line) {
  return numericTokens(scrubMetricLine(line)).filter((item) => {
    const value = Number(item.value);
    const yearLike = Number.isInteger(value) && value >= 1900 && value <= 2100 && /^[-+]?\\d{4}$/.test(String(item.raw || '').trim());
    return !yearLike;
  });
}

function findMetricRow(pages, labels, options = {}) {
  const maxPages = Math.min(pages.length, Number(options.maxPages || 10));
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const lines = String(pages[pageIndex] || '').split(/\\n+/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const normalized = normalizeLine(line);
      const label = labels.find((candidate) => normalized.includes(candidate));
      if (!label) continue;
      if (options.exclude?.some((candidate) => normalized.includes(candidate))) continue;
      if (looksLikeTableOfContentsLine(line)) continue;
      const numbers = financialNumericTokens(line);
      const needed = Number(options.minimumNumbers || 2);
      if (numbers.length < needed) continue;
      const selected = numbers.slice(0, Math.max(needed, 2));
      return {
        label,
        line,
        pageNumber: pageIndex + 1,
        values: selected.map((item) => item.value),
        scaleMultiplier: metricLineScale(line),
        extractionPolicy: 'STATEMENT_ROW_ONLY_V2',
      };
    }
  }
  return null;
}

function metricPair`;

  source = replaceRegexRequired(
    source,
    /function findMetricRow\(pages, labels, options = \{\}\) \{[\s\S]*?\n\}\n\nfunction metricPair/,
    replacement,
    'STATEMENT_ROW_ONLY_V2',
    'Athens metric row parser',
  );

  source = replaceRequired(
    source,
    '  const values = row.values.slice(-2).map((value) => value * scale);',
    `  const rowScale = Number(row?.scaleMultiplier || 1);
  const effectiveScale = rowScale > 1 ? rowScale : scale;
  const values = row.values.slice(0, 2).map((value) => value * effectiveScale);`,
    'current/comparative column order and row scale',
  );

  source = replaceRequired(
    source,
    "      sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT'\n    },",
    "      sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT',\n      metricExtractionPolicy: 'STATEMENT_ROW_ONLY_V2'\n    },",
    'parser integrity audit marker',
  );

  write('src/adapters/euronext-athens-fundamentals.js', source);
}

function patchCurrencyIntegrity() {
  let daily = read('src/run-daily-intelligence.js');
  daily = replaceRequired(
    daily,
    "          currency: company.currency || company.listings?.[0]?.currency || 'USD',",
    "          currency: company.currency || company.primaryListing?.currency || company.listings?.[0]?.currency || fundamentalSnapshot?.reporting?.currency || 'USD',",
    'listing/reporting currency propagation',
  );
  write('src/run-daily-intelligence.js', daily);

  let risk = read('src/fundamental-risk.js');
  risk = replaceRequired(
    risk,
    '  const dilutionPct = finite(fundamentals?.metrics?.dilutedSharesChangePct);',
    `  const dilutionPct = finite(fundamentals?.metrics?.dilutedSharesChangePct);
  const reportedCurrency = fundamentals?.reporting?.currency || fundamentals?.annual?.revenue?.[0]?.unit || fundamentals?.instant?.assets?.unit || null;
  const expectedCurrency = options.currency || reportedCurrency || 'USD';
  const currencyConsistent = !reportedCurrency || reportedCurrency === expectedCurrency;`,
    'reported currency integrity state',
  );
  risk = replaceRequired(
    risk,
    `    coverage >= Number(options.minimumCoverage || 6),
  );`,
    `    coverage >= Number(options.minimumCoverage || 6) &&
    currencyConsistent,
  );`,
    'currency consistency readiness gate',
  );
  risk = replaceRequired(
    risk,
    "    currency: options.currency || 'USD',",
    `    currency: expectedCurrency,
    reportedCurrency,
    currencyConsistent,`,
    'currency output integrity',
  );
  risk = replaceRequired(
    risk,
    '    flags,\n    riskScore,\n    metricsReady,',
    `    flags,
    riskScore,
    riskDataStatus: metricsReady ? 'READY' : 'INSUFFICIENT_DATA',
    metricsReady,`,
    'risk data status',
  );
  write('src/fundamental-risk.js', risk);
}

patchAthensMetricExtraction();
patchCurrencyIntegrity();

for (const [file, invariants] of Object.entries({
  'src/adapters/euronext-athens-fundamentals.js': [
    'STATEMENT_ROW_ONLY_V2',
    'looksLikeTableOfContentsLine',
    'metricLineScale',
    'financialNumericTokens',
    'row.values.slice(0, 2)',
  ],
  'src/run-daily-intelligence.js': ['company.primaryListing?.currency', 'fundamentalSnapshot?.reporting?.currency'],
  'src/fundamental-risk.js': ['reportedCurrency', 'currencyConsistent', "riskDataStatus: metricsReady ? 'READY' : 'INSUFFICIENT_DATA'"],
})) {
  const source = read(file);
  for (const invariant of invariants) {
    if (!source.includes(invariant)) throw new Error(`v1.2.9 verification failed: ${file} missing ${invariant}`);
  }
}

console.log('Investor Control market intelligence v1.2.9 fundamental integrity gate applied.');
