import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, v) => fs.writeFileSync(path.join(root, p), v);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.5.7 patch failed: missing ${label}`);
  return content.replace(from, to);
}

function replaceRegexRequired(content, regex, replacement, marker, label) {
  if (content.includes(marker)) return content;
  regex.lastIndex = 0;
  if (!regex.test(content)) throw new Error(`v1.5.7 patch failed: missing ${label}`);
  regex.lastIndex = 0;
  return content.replace(regex, replacement);
}

function patchFinancialResolver() {
  let source = read('src/adapters/euronext-athens-financial-resolver.js');
  source = replaceRequired(
    source,
    "import { extractEuronextAthensAnnouncements } from './euronext-athens-announcements.js';",
    "import { extractEuronextAthensAnnouncements } from './euronext-athens-announcements.js';\nimport { resolveCanonicalIssuerFinancialDocuments } from './issuer-ir-financial-resolver.js';",
    'issuer IR resolver import',
  );
  source = source.replace(
    "export const EURONEXT_FINANCIAL_RESOLVER_VERSION = '2026-08-08.1';",
    "export const EURONEXT_FINANCIAL_RESOLVER_VERSION = '2026-08-08.2';",
  );

  source = replaceRequired(
    source,
    `  const announcementsUrl = company?.marketData?.euronextIssuerAnnouncementsUrl || null;`,
    `  const issuerIr = await resolveCanonicalIssuerFinancialDocuments(company, {
    fetchImpl,
    userAgent,
    issuerFinancialDetailLimit: options.issuerFinancialDetailLimit,
    issuerFinancialPdfLimit: options.issuerFinancialPdfLimit,
  });
  diagnostics.push(...(issuerIr.diagnostics || []));
  for (const candidate of issuerIr.candidates || []) candidates.push(candidate);

  const announcementsUrl = company?.marketData?.euronextIssuerAnnouncementsUrl || null;`,
    'canonical issuer IR candidate collection',
  );

  write('src/adapters/euronext-athens-financial-resolver.js', source);
}

function patchAthensAdapterProvenanceAndShareSearch() {
  let source = read('src/adapters/euronext-athens-fundamentals.js');

  source = replaceRequired(
    source,
    "  const directSharesRow = findMetricRow(pages, ['weighted average number of diluted shares', 'weighted average number of shares', 'average number of shares'], { statementContexts: ['INCOME_STATEMENT'], minimumNumbers: 1, maximumNumbers: 4 });",
    "  const directSharesRow = findMetricRow(pages, ['weighted average number of diluted shares', 'weighted average number of ordinary shares', 'weighted average number of shares', 'average number of shares'], { statementContexts: ['INCOME_STATEMENT'], minimumNumbers: 1, maximumNumbers: 4, maxPages: 40 });",
    'deep direct share-count search',
  );

  const helper = `function stampFinancialSourceRole(snapshot, document) {
  const sourceRole = document?.sourceChannel === 'ISSUER_IR_OFFICIAL'
    ? 'PRIMARY_ISSUER_FINANCIAL_DOCUMENT'
    : 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT';
  const stamp = (fact) => {
    if (!fact) return;
    fact.provenance = {
      ...(fact.provenance || {}),
      sourceRole,
      sourceChannel: document?.sourceChannel || null,
      sourceUrl: document?.pdfUrl || null,
      identityBinding: document?.identityBinding || null,
    };
  };
  for (const series of Object.values(snapshot?.annual || {})) {
    if (Array.isArray(series)) for (const fact of series) stamp(fact);
  }
  for (const fact of Object.values(snapshot?.instant || {})) stamp(fact);
  snapshot.sourceDocument = {
    ...(snapshot.sourceDocument || {}),
    sourceRole,
    sourceChannel: document?.sourceChannel || null,
    authorityScore: document?.authorityScore ?? null,
    identityBinding: document?.identityBinding || null,
  };
  snapshot.quality = { ...(snapshot.quality || {}), sourceRole };
  return snapshot;
}

`;
  source = replaceRequired(
    source,
    'export async function fetchEuronextAthensFundamentals(company, options = {}) {',
    `${helper}export async function fetchEuronextAthensFundamentals(company, options = {}) {`,
    'financial source-role stamping helper',
  );

  source = replaceRegexRequired(
    source,
    /(    const candidateSnapshot = buildAthensFundamentalSnapshotFromText\(extracted\.text, document, company, \{[\s\S]*?    \}\);\n)(\n    if \(candidateSnapshot\.model\?\.type === 'FINANCIAL_INSTITUTION'\))/,
    `$1    stampFinancialSourceRole(candidateSnapshot, document);\n$2`,
    'stampFinancialSourceRole(candidateSnapshot, document);',
    'candidate provenance stamping',
  );

  write('src/adapters/euronext-athens-fundamentals.js', source);
}

function patchDecisionEvidence() {
  let source = read('src/decision-evidence.js');

  const helpers = `function organizationRoot(url) {
  try {
    const host = new URL(String(url || '')).hostname.toLowerCase().replace(/^www\\./, '');
    const parts = host.split('.').filter(Boolean);
    return parts.length <= 2 ? host : parts.slice(-2).join('.');
  } catch { return null; }
}

function canonicalIssuerFinancialHost(sourceHost, company) {
  if (!sourceHost) return false;
  const roots = [company?.website, company?.investorRelationsUrl].map(organizationRoot).filter(Boolean);
  return roots.some((root) => sourceHost === root || sourceHost.endsWith(\`.\${root}\`));
}

`;
  source = replaceRequired(
    source,
    'function officialFundamentalSource(snapshot) {',
    `${helpers}function officialFundamentalSource(snapshot, company) {`,
    'issuer financial identity helpers',
  );

  source = replaceRequired(
    source,
    `  const official = sourceHost === 'data.sec.gov'
    || sourceHost === 'www.sec.gov'
    || sourceHost === 'sec.gov'
    || sourceHost === 'athens.euronext.com';
  return { sourceUrl, sourceHost, official };`,
    `  const issuerBound = snapshot?.sourceDocument?.sourceRole === 'PRIMARY_ISSUER_FINANCIAL_DOCUMENT'
    && snapshot?.sourceDocument?.identityBinding === 'CANONICAL_ISSUER_IR_DOMAIN'
    && canonicalIssuerFinancialHost(sourceHost, company);
  const official = sourceHost === 'data.sec.gov'
    || sourceHost === 'www.sec.gov'
    || sourceHost === 'sec.gov'
    || sourceHost === 'athens.euronext.com'
    || issuerBound;
  return { sourceUrl, sourceHost, official, issuerBound };`,
    'canonical issuer official source evaluation',
  );

  source = replaceRequired(
    source,
    '    const source = officialFundamentalSource(fundamentals);',
    '    const source = officialFundamentalSource(fundamentals, company);',
    'company-bound fundamental source call',
  );

  source = replaceRequired(
    source,
    "        sourceName: source.sourceHost?.includes('sec.gov') ? 'SEC structured financial data' : 'Euronext Athens reviewed financial data',",
    "        sourceName: source.sourceHost?.includes('sec.gov') ? 'SEC structured financial data' : source.issuerBound ? 'Issuer reviewed financial statements' : 'Euronext Athens reviewed financial data',",
    'issuer source naming',
  );

  source = replaceRequired(
    source,
    "          sourceRole: 'PRIMARY_REGULATORY_OR_EXCHANGE_FINANCIAL_DATA',",
    "          sourceRole: source.issuerBound ? 'PRIMARY_ISSUER_FINANCIAL_DOCUMENT' : 'PRIMARY_REGULATORY_OR_EXCHANGE_FINANCIAL_DATA',",
    'issuer source role in structured evidence',
  );

  write('src/decision-evidence.js', source);
}

function patchExtremeMarginNarrative() {
  let source = read('src/fundamental-baseline-synthesis.js');
  source = replaceRequired(
    source,
    '  const margin = finite(f?.metrics?.annualNetMarginPct);\n  const dilution =',
    "  const margin = finite(f?.metrics?.annualNetMarginPct);\n  const marginComparable = risk?.profitability?.netMarginComparable !== false && (margin === null || Math.abs(margin) <= 1000);\n  const dilution =",
    'baseline margin comparability',
  );
  source = replaceRequired(
    source,
    '    margin !== null && margin > 0 &&\n    positive && !valuationExtreme',
    '    marginComparable && margin !== null && margin > 0 &&\n    positive && !valuationExtreme',
    'buy logic margin comparability',
  );
  source = replaceRequired(
    source,
    '    margin !== null ? `καθαρό περιθώριο ${fmt(margin)}%` : null,',
    "    margin !== null ? (marginComparable ? `καθαρό περιθώριο ${fmt(margin)}%` : 'καθαρό περιθώριο μη συγκρίσιμο λόγω πολύ χαμηλής βάσης εσόδων') : null,",
    'baseline margin display guard',
  );
  write('src/fundamental-baseline-synthesis.js', source);
}

patchFinancialResolver();
patchAthensAdapterProvenanceAndShareSearch();
patchDecisionEvidence();
patchExtremeMarginNarrative();

for (const [file, invariants] of Object.entries({
  'src/adapters/euronext-athens-financial-resolver.js': ['resolveCanonicalIssuerFinancialDocuments', "EURONEXT_FINANCIAL_RESOLVER_VERSION = '2026-08-08.2'", 'issuerIr.candidates'],
  'src/adapters/euronext-athens-fundamentals.js': ['PRIMARY_ISSUER_FINANCIAL_DOCUMENT', 'stampFinancialSourceRole(candidateSnapshot, document);', 'weighted average number of ordinary shares', 'maxPages: 40'],
  'src/decision-evidence.js': ['canonicalIssuerFinancialHost', 'source.issuerBound', 'PRIMARY_ISSUER_FINANCIAL_DOCUMENT'],
  'src/fundamental-baseline-synthesis.js': ['marginComparable', 'καθαρό περιθώριο μη συγκρίσιμο λόγω πολύ χαμηλής βάσης εσόδων'],
})) {
  const source = read(file);
  for (const invariant of invariants) if (!source.includes(invariant)) throw new Error(`v1.5.7 verification failed: ${file} missing ${invariant}`);
}

console.log('Investor Control v1.5.7 canonical issuer financial statements and narrative quality applied.');
