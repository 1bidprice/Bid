import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.4.3 Athens integrity patch failed: missing ${label}`);
  source = source.replace(from, to);
}

function replaceRegexRequired(regex, replacement, marker, label) {
  if (source.includes(marker)) return;
  let matched = false;
  source = source.replace(regex, () => {
    matched = true;
    return replacement;
  });
  if (!matched) throw new Error(`v1.4.3 Athens integrity patch failed: missing ${label}`);
}

replaceRequired(
  "function normalizeLine(value) {\n  return plainText(value).toLowerCase().replace(/[’']/g, '').replace(/\\s+/g, ' ').trim();\n}",
  "function normalizeLine(value) {\n  return plainText(value).toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/\\s+/g, ' ').trim();\n}",
  'normalized ampersand semantics',
);

replaceRegexRequired(
  /function financialNumericTokens\(line\) \{[\s\S]*?\n\}/,
  `function parseStatementNumber(token, options = {}) {
  let raw = String(token || '').trim();
  if (!raw || raw === '-' || raw === '—') return null;
  const negative = /^\\(.*\\)$/.test(raw) || /^-/.test(raw);
  raw = raw.replace(/[()€$£\\s]/g, '').replace(/^[-+]/, '');
  if (!raw || !/[0-9]/.test(raw)) return null;

  const decimalMode = options.decimalMode === true;
  const commaCount = (raw.match(/,/g) || []).length;
  const dotCount = (raw.match(/\\./g) || []).length;

  if (decimalMode) {
    if (commaCount && dotCount) {
      const decimalComma = raw.lastIndexOf(',') > raw.lastIndexOf('.');
      raw = decimalComma ? raw.replace(/\\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    } else if (commaCount) {
      raw = raw.replace(/,/g, '.');
    }
  } else if (commaCount && dotCount) {
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    const lastSeparator = Math.max(lastComma, lastDot);
    const suffixLength = raw.length - lastSeparator - 1;
    if (suffixLength === 3) {
      raw = raw.replace(/[.,]/g, '');
    } else if (lastComma > lastDot) {
      raw = raw.replace(/\\./g, '').replace(',', '.');
    } else {
      raw = raw.replace(/,/g, '');
    }
  } else if (commaCount) {
    const parts = raw.split(',');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0] !== '0')) raw = raw.replace(/,/g, '');
    else raw = raw.replace(',', '.');
  } else if (dotCount) {
    const parts = raw.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0] !== '0')) raw = raw.replace(/\\./g, '');
  }

  const value = Number(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

function financialNumericTokens(line, options = {}) {
  const matches = String(scrubMetricLine(line) || '').match(/\\(?[-+]?\\d[\\d.,]*\\)?/g) || [];
  return matches.map((raw) => ({ raw, value: parseStatementNumber(raw, options) })).filter((item) => {
    if (item.value === null) return false;
    const value = Number(item.value);
    const yearLike = Number.isInteger(value) && value >= 1900 && value <= 2100 && /^[-+]?\\d{4}$/.test(String(item.raw || '').trim());
    return !yearLike;
  });
}

function metricRowLabel(normalized, labels = []) {
  let best = null;
  for (const candidate of labels) {
    const label = normalizeLine(candidate);
    if (!label) continue;
    const index = normalized.indexOf(label);
    if (index < 0) continue;
    const prefix = normalized.slice(0, index).trim();
    let score = 0;
    if (index === 0) score = 100;
    else if (prefix.length <= 16 && /^(?:(?:note|σημ(?:ειωση)?)\\s*)?(?:[a-zα-ω]?\\d+(?:[.]\\d+)*|[a-zα-ω][.]\\d+(?:[.]\\d+)*)[ .:()-]*$/i.test(prefix)) score = 75;
    if (!score) continue;
    if (!best || score > best.score || (score === best.score && label.length > best.label.length)) best = { label: candidate, normalizedLabel: label, score };
  }
  return best;
}`,
  'function parseStatementNumber(',
  'context-aware statement number parser',
);

replaceRequired(
  `      const normalized = normalizeLine(line);
      const label = labels.find((candidate) => normalized.includes(candidate));
      if (!label) continue;
      if (options.exclude?.some((candidate) => normalized.includes(candidate))) continue;`,
  `      const normalized = normalizeLine(line);
      const labelMatch = metricRowLabel(normalized, labels);
      const label = labelMatch?.label || null;
      if (!label) continue;
      if (options.exclude?.some((candidate) => normalized.includes(normalizeLine(candidate)))) continue;`,
  'row-label anchoring',
);

replaceRequired(
  '      const numbers = financialNumericTokens(line);',
  '      const numbers = financialNumericTokens(line, { decimalMode: options.decimalMode === true });',
  'metric-specific number mode',
);

replaceRequired(
  `        contextScore,
        selectionScore: contextScore - notesPenalty - Math.max(0, numbers.length - needed) * 4,`,
  `        contextScore,
        labelScore: labelMatch?.score || 0,
        numberMode: options.decimalMode === true ? 'DECIMAL' : 'FINANCIAL_AMOUNT',
        selectionScore: contextScore + (labelMatch?.score || 0) - notesPenalty - Math.max(0, numbers.length - needed) * 4,`,
  'row-label selection score and number mode audit',
);

replaceRequired(
  "  const epsRow = findMetricRow(pages, ['basic and diluted', 'basic & diluted', 'diluted earnings per share'], { statementContexts: ['INCOME_STATEMENT'], minimumNumbers: 2, maximumNumbers: 4 });",
  "  const epsRow = findMetricRow(pages, ['basic and diluted', 'basic & diluted', 'diluted earnings per share'], { statementContexts: ['INCOME_STATEMENT'], minimumNumbers: 2, maximumNumbers: 4, decimalMode: true });",
  'EPS decimal semantics',
);

replaceRequired(
  `      contextScore: Number.isFinite(Number(row.contextScore)) ? Number(row.contextScore) : null,
    },`,
  `      contextScore: Number.isFinite(Number(row.contextScore)) ? Number(row.contextScore) : null,
      labelScore: Number.isFinite(Number(row.labelScore)) ? Number(row.labelScore) : null,
      numberMode: row.numberMode || null,
    },`,
  'metric numeric-semantics provenance',
);

if (!source.includes('function assessBalanceSheetIntegrity(')) {
  replaceRequired(
    `function derivedShares(netIncome, epsRow, period) {`,
    `function assessBalanceSheetIntegrity({ cash, assets, liabilities, equity } = {}) {
  const amount = (entry) => {
    const value = Number(entry?.value);
    return Number.isFinite(value) ? value : null;
  };
  const cashValue = amount(cash);
  const assetsValue = amount(assets);
  const liabilitiesValue = amount(liabilities);
  const equityValue = amount(equity);
  const issues = [];
  const checks = [];
  let balanceEquationDifferencePct = null;

  if (assetsValue !== null && assetsValue <= 0) issues.push('ASSETS_NON_POSITIVE');
  if (assetsValue !== null && cashValue !== null) {
    checks.push('CASH_NOT_GREATER_THAN_ASSETS');
    if (Math.abs(cashValue) > Math.abs(assetsValue) * 1.05) issues.push('CASH_EXCEEDS_ASSETS');
  }
  if (assetsValue !== null && liabilitiesValue !== null && equityValue !== null && assetsValue !== 0) {
    checks.push('ASSETS_EQUALS_LIABILITIES_PLUS_EQUITY');
    balanceEquationDifferencePct = Number((Math.abs(assetsValue - (liabilitiesValue + equityValue)) / Math.abs(assetsValue) * 100).toFixed(2));
    if (balanceEquationDifferencePct > 5) issues.push('BALANCE_SHEET_EQUATION_FAILED');
  }

  const ready = checks.includes('ASSETS_EQUALS_LIABILITIES_PLUS_EQUITY') && issues.length === 0;
  return {
    status: issues.length ? 'FAILED' : ready ? 'PASSED' : 'INSUFFICIENT_DATA',
    ready,
    checks,
    issues,
    balanceEquationDifferencePct,
    tolerancePct: 5,
  };
}

function derivedShares(netIncome, epsRow, period) {`,
    'balance-sheet integrity function',
  );
}

replaceRequired(
  `  const freeCashFlow = operatingCashFlow[0] && capitalExpenditure[0]
    ? Number(operatingCashFlow[0].value) - Math.abs(Number(capitalExpenditure[0].value))
    : null;

  const required = [revenue[0], netIncome[0], cash, assets, liabilities, equity, dilutedShares[0]];`,
  `  const freeCashFlow = operatingCashFlow[0] && capitalExpenditure[0]
    ? Number(operatingCashFlow[0].value) - Math.abs(Number(capitalExpenditure[0].value))
    : null;
  const balanceSheetIntegrity = assessBalanceSheetIntegrity({ cash, assets, liabilities, equity });

  const required = [revenue[0], netIncome[0], cash, assets, liabilities, equity, dilutedShares[0]];`,
  'balance integrity calculation',
);

replaceRequired(
  `    metricsReady: Boolean(document?.identityVerified && extractionReady && genericModelEligible),
    quality: {`,
  `    metricsReady: Boolean(document?.identityVerified && extractionReady && genericModelEligible && balanceSheetIntegrity.ready),
    quality: {`,
  'balance integrity readiness gate',
);

replaceRequired(
  `      sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT',
    },`,
  `      sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT',
      balanceSheetIntegrity,
      rowLabelPolicy: 'ROW_LABEL_ANCHORED_V1',
      numericSemanticsPolicy: 'FINANCIAL_TABLE_NUMBER_V1',
    },`,
  'Athens quality integrity passport',
);

replaceRequired(
  `  if (!snapshot.quality.extractionReady) diagnostics.push({ code: 'ATHENS_FINANCIAL_METRICS_INCOMPLETE', companyId: company?.companyId, coverage: snapshot.coverage.score });
  if (!snapshot.quality.genericModelEligible) diagnostics.push({ code: 'ATHENS_FINANCIAL_SECTOR_MODEL_REQUIRED', companyId: company?.companyId });`,
  `  if (!snapshot.quality.extractionReady) diagnostics.push({ code: 'ATHENS_FINANCIAL_METRICS_INCOMPLETE', companyId: company?.companyId, coverage: snapshot.coverage.score });
  if (snapshot.quality.balanceSheetIntegrity?.status === 'FAILED') diagnostics.push({
    code: 'ATHENS_FINANCIAL_BALANCE_SHEET_INTEGRITY_FAILED',
    companyId: company?.companyId,
    issues: snapshot.quality.balanceSheetIntegrity.issues,
    balanceEquationDifferencePct: snapshot.quality.balanceSheetIntegrity.balanceEquationDifferencePct,
  });
  if (!snapshot.quality.genericModelEligible) diagnostics.push({ code: 'ATHENS_FINANCIAL_SECTOR_MODEL_REQUIRED', companyId: company?.companyId });`,
  'balance integrity diagnostic',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'parseStatementNumber',
  'metricRowLabel',
  "numberMode: options.decimalMode === true ? 'DECIMAL' : 'FINANCIAL_AMOUNT'",
  "decimalMode: true",
  'assessBalanceSheetIntegrity',
  'BALANCE_SHEET_EQUATION_FAILED',
  'CASH_EXCEEDS_ASSETS',
  "rowLabelPolicy: 'ROW_LABEL_ANCHORED_V1'",
  "numericSemanticsPolicy: 'FINANCIAL_TABLE_NUMBER_V1'",
  'ATHENS_FINANCIAL_BALANCE_SHEET_INTEGRITY_FAILED',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.4.3 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.4.3 Athens unit, row-label and balance-sheet integrity applied.');
