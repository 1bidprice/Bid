import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.4.6 Athens language fallback failed: missing ${label}`);
  source = source.replace(from, to);
}

replaceRequired(
  `  const pageUrl = financialDataUrl(company);\n  if (!pageUrl) return { snapshot: null, diagnostics: [{ code: 'ATHENS_FINANCIAL_ISSUER_ID_MISSING', companyId: company?.companyId }] };\n\n  const pageResponse = await fetchImpl(pageUrl, {\n    headers: { Accept: 'text/html,application/xhtml+xml', 'Cache-Control': 'no-cache', 'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/1.0' },\n  });\n  if (!pageResponse.ok) return { snapshot: null, diagnostics: [{ code: 'ATHENS_FINANCIAL_INDEX_HTTP_ERROR', companyId: company?.companyId, status: pageResponse.status }] };\n  const html = await pageResponse.text();\n  const documents = extractAthensFinancialDocuments(html, company, options);\n  const verified = documents.filter((item) => item.identityVerified && item.pdfUrl);\n  if (!verified.length) {\n    return {\n      snapshot: null,\n      diagnostics: [{\n        code: documents.length ? 'ATHENS_FINANCIAL_IDENTITY_NOT_VERIFIED' : 'ATHENS_FINANCIAL_DOCUMENT_NOT_FOUND',\n        companyId: company?.companyId,\n        pageUrl,\n        candidateCount: documents.length,\n      }],\n    };\n  }\n\n  const document = verified[0];`,
  `  const pageUrl = financialDataUrl(company);\n  if (!pageUrl) return { snapshot: null, diagnostics: [{ code: 'ATHENS_FINANCIAL_ISSUER_ID_MISSING', companyId: company?.companyId }] };\n\n  const pageUrls = [pageUrl];\n  try {\n    const parsed = new URL(pageUrl);\n    if (parsed.hostname === 'athens.euronext.com' && parsed.pathname.includes('/en/market-data/issuers/')) {\n      parsed.pathname = parsed.pathname.replace('/en/market-data/issuers/', '/el/market-data/issuers/');\n      if (!parsed.searchParams.has('page')) parsed.searchParams.set('page', '0');\n      pageUrls.push(parsed.toString());\n    }\n  } catch {}\n\n  let documents = [];\n  let verified = [];\n  let selectedIndexUrl = null;\n  const indexDiagnostics = [];\n  for (const indexUrl of [...new Set(pageUrls)]) {\n    let pageResponse;\n    try {\n      pageResponse = await fetchImpl(indexUrl, {\n        headers: { Accept: 'text/html,application/xhtml+xml', 'Cache-Control': 'no-cache', 'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/1.0' },\n      });\n    } catch (error) {\n      indexDiagnostics.push({ code: 'ATHENS_FINANCIAL_INDEX_FETCH_ERROR', companyId: company?.companyId, pageUrl: indexUrl, error: String(error?.message || error) });\n      continue;\n    }\n    if (!pageResponse.ok) {\n      indexDiagnostics.push({ code: 'ATHENS_FINANCIAL_INDEX_HTTP_ERROR', companyId: company?.companyId, pageUrl: indexUrl, status: pageResponse.status });\n      continue;\n    }\n    const html = await pageResponse.text();\n    const candidateDocuments = extractAthensFinancialDocuments(html, company, options);\n    documents.push(...candidateDocuments);\n    const candidateVerified = candidateDocuments.filter((item) => item.identityVerified && item.pdfUrl);\n    if (candidateVerified.length) {\n      verified = candidateVerified;\n      selectedIndexUrl = indexUrl;\n      break;\n    }\n  }\n\n  if (!verified.length) {\n    return {\n      snapshot: null,\n      diagnostics: [{\n        code: documents.length ? 'ATHENS_FINANCIAL_IDENTITY_NOT_VERIFIED' : 'ATHENS_FINANCIAL_DOCUMENT_NOT_FOUND',\n        companyId: company?.companyId,\n        pageUrl,\n        attemptedIndexUrls: [...new Set(pageUrls)],\n        candidateCount: documents.length,\n      }, ...indexDiagnostics],\n    };\n  }\n\n  const document = { ...verified[0], indexUrl: selectedIndexUrl };`,
  'official language fallback in financial index fetch',
);

replaceRequired(
  `      detailUrl: document?.detailUrl || null,\n      modifiedAt: document?.modifiedAt || null,`,
  `      detailUrl: document?.detailUrl || null,\n      indexUrl: document?.indexUrl || null,\n      modifiedAt: document?.modifiedAt || null,`,
  'financial index provenance',
);

fs.writeFileSync(filePath, source);

const verifiedSource = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  "parsed.pathname.replace('/en/market-data/issuers/', '/el/market-data/issuers/')",
  "parsed.searchParams.set('page', '0')",
  'attemptedIndexUrls',
  'selectedIndexUrl',
  'indexUrl: document?.indexUrl || null',
]) {
  if (!verifiedSource.includes(invariant)) throw new Error(`v1.4.6 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.4.6 Athens official-language fundamentals fallback applied.');
