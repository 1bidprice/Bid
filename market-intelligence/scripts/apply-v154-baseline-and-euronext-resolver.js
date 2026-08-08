import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, v) => fs.writeFileSync(path.join(root, p), v);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.5.4 patch failed: missing ${label}`);
  return content.replace(from, to);
}

function replaceRegexRequired(content, regex, replacement, marker, label) {
  if (content.includes(marker)) return content;
  regex.lastIndex = 0;
  if (!regex.test(content)) throw new Error(`v1.5.4 patch failed: missing ${label}`);
  regex.lastIndex = 0;
  return content.replace(regex, replacement);
}

function patchDossierDecisionCorroboration() {
  let source = read('src/research-dossier.js');

  source = replaceRegexRequired(
    source,
    /(\s*fundamentalRisk:\s*input\.fundamentalRisk\s*\|\|\s*null,\n\s*crossCheck,)/,
    `$1\n      decisionCorroboration: input.decisionCorroboration || null,`,
    'decisionCorroboration: input.decisionCorroboration || null,\n    },\n    readiness:',
    'decision corroboration inside dossier metrics',
  );

  source = replaceRegexRequired(
    source,
    /(\s*listing:\s*company\.primaryListing\s*\|\|\s*\{[^\n]+\},\n)/,
    `$1    decisionBasis: input.decisionBasis || 'EVENT_DRIVEN',\n`,
    "listing: company.primaryListing || { exchange: 'Unknown', symbol: 'UNKNOWN', mic: null },\n    decisionBasis: input.decisionBasis || 'EVENT_DRIVEN',",
    'decision basis at dossier top level',
  );

  write('src/research-dossier.js', source);
}

function patchEuronextFinancialResolver() {
  let source = read('src/adapters/euronext-athens-fundamentals.js');

  source = replaceRequired(
    source,
    "import { classifyFundamentalModel } from '../fundamental-model.js';",
    "import { classifyFundamentalModel } from '../fundamental-model.js';\nimport { resolveEuronextAthensFinancialDocument } from './euronext-athens-financial-resolver.js';",
    'financial resolver import',
  );

  const resolverBlock = `  const resolvedDocument = await resolveEuronextAthensFinancialDocument(company, {
    fetchImpl,
    financialDataUrl: pageUrl,
    extractFinancialDocuments: extractAthensFinancialDocuments,
    generatedAt: options.generatedAt,
    userAgent: options.userAgent || 'Investor-Control-Market-Intelligence/1.5',
    minimumIdentityScore: options.minimumIdentityScore,
    announcementLimit: options.announcementLimit,
    detailLimit: options.financialAnnouncementDetailLimit,
  });
  if (!resolvedDocument.document) {
    return {
      snapshot: null,
      diagnostics: resolvedDocument.diagnostics || [{ code: 'EURONEXT_FINANCIAL_DOCUMENT_RESOLUTION_FAILED', companyId: company?.companyId }],
    };
  }
  const document = resolvedDocument.document;
  const resolverDiagnostics = resolvedDocument.diagnostics || [];`;

  source = replaceRegexRequired(
    source,
    /  const pageUrls = \[pageUrl\];[\s\S]*?  const document = \{ \.\.\.verified\[0\], indexUrl: selectedIndexUrl \};/,
    resolverBlock,
    'const resolverDiagnostics = resolvedDocument.diagnostics || [];',
    'legacy language-only financial document selection block',
  );

  source = replaceRegexRequired(
    source,
    /(\s*detailUrl:\s*document\?\.detailUrl\s*\|\|\s*null,\n\s*indexUrl:\s*document\?\.indexUrl\s*\|\|\s*null,)/,
    `$1\n      sourceChannel: document?.sourceChannel || null,\n      authorityScore: document?.authorityScore ?? null,\n      identityBinding: document?.identityBinding || null,`,
    'sourceChannel: document?.sourceChannel || null,',
    'resolver provenance in source document',
  );

  source = replaceRegexRequired(
    source,
    /  const diagnostics = \[\];\n  if \(!snapshot\.quality\.identityVerified\)/,
    `  const diagnostics = [...resolverDiagnostics];\n  if (!snapshot.quality.identityVerified)`,
    'const diagnostics = [...resolverDiagnostics];',
    'resolver diagnostics propagation',
  );

  write('src/adapters/euronext-athens-fundamentals.js', source);
}

patchDossierDecisionCorroboration();
patchEuronextFinancialResolver();

for (const [file, invariants] of Object.entries({
  'src/research-dossier.js': [
    "decisionBasis: input.decisionBasis || 'EVENT_DRIVEN'",
    'decisionCorroboration: input.decisionCorroboration || null',
  ],
  'src/adapters/euronext-athens-fundamentals.js': [
    'resolveEuronextAthensFinancialDocument',
    'const resolverDiagnostics = resolvedDocument.diagnostics || [];',
    'sourceChannel: document?.sourceChannel || null',
    'identityBinding: document?.identityBinding || null',
    'const diagnostics = [...resolverDiagnostics];',
  ],
})) {
  const source = read(file);
  for (const invariant of invariants) {
    if (!source.includes(invariant)) throw new Error(`v1.5.4 verification failed: ${file} missing ${invariant}`);
  }
}

console.log('Investor Control v1.5.4 baseline final-action wiring and universal Euronext financial resolver applied.');
