import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, "src/research-dossier.js");

function replaceRequired(content, from, to, name) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.8.4 recommendation-integrity patch failed: ${name}`);
  return content.replace(from, to);
}

let content = fs.readFileSync(file, 'utf8');
const operations = [
  [
    "    isPrimarySource: record.isPrimarySource === true,\n    documentStatus: record.document?.status || null,\n  };",
    "    isPrimarySource: record.isPrimarySource === true,\n    documentStatus: record.document?.status || null,\n    companyIds: Array.isArray(record.companyIds) ? unique(record.companyIds) : [],\n  };"
  ],
  [
    "      source: marketSnapshot.source,\n      purpose: 'ANALYSIS_REFERENCE',\n      analysisReferenceEligible: true,\n      executionFreshnessEligible: marketSnapshot?.quoteContract?.executionFreshnessEligible === true,\n      decisionEligible: marketSnapshot?.quoteContract?.decisionEligible === true,\n      freshnessModel: marketSnapshot?.quoteContract?.freshnessModel || null,\n    };",
    "      source: marketSnapshot.source,\n      sourceUrl: marketSnapshot.sourceUrl || null,\n      companyId: marketSnapshot.companyId || null,\n      companyName: marketSnapshot.companyName || null,\n      appSymbol: marketSnapshot.appSymbol || marketSnapshot.symbol || null,\n      providerSymbol: marketSnapshot.providerSymbol || null,\n      sourceRole: marketSnapshot?.quoteContract?.sourceRole || null,\n      sourceApproved: marketSnapshot?.quoteContract?.sourceApproved === true,\n      timestampVerified: marketSnapshot?.quoteContract?.timestampVerified === true,\n      purpose: 'ANALYSIS_REFERENCE',\n      analysisReferenceEligible: true,\n      executionFreshnessEligible: marketSnapshot?.quoteContract?.executionFreshnessEligible === true,\n      decisionEligible: marketSnapshot?.quoteContract?.decisionEligible === true,\n      freshnessModel: marketSnapshot?.quoteContract?.freshnessModel || null,\n      publicStatus: marketSnapshot?.quoteContract?.publicStatus || null,\n      diagnosticCodes: Array.isArray(marketSnapshot?.quoteContract?.diagnosticCodes)\n        ? [...marketSnapshot.quoteContract.diagnosticCodes]\n        : [],\n    };"
  ],
  [
    "      source: 'Historical market series',\n      purpose: 'HISTORICAL_REFERENCE',\n      analysisReferenceEligible: true,\n      executionFreshnessEligible: false,\n      decisionEligible: false,\n      freshnessModel: 'HISTORICAL_CLOSE',\n    };",
    "      source: 'Historical market series',\n      sourceUrl: historicalMetrics.sourceUrl || null,\n      companyId: historicalMetrics.companyId || null,\n      companyName: historicalMetrics.companyName || null,\n      appSymbol: historicalMetrics.appSymbol || historicalMetrics.symbol || null,\n      providerSymbol: historicalMetrics.providerSymbol || null,\n      sourceRole: 'HISTORICAL_MARKET_SERIES',\n      sourceApproved: true,\n      timestampVerified: true,\n      purpose: 'HISTORICAL_REFERENCE',\n      analysisReferenceEligible: true,\n      executionFreshnessEligible: false,\n      decisionEligible: false,\n      freshnessModel: 'HISTORICAL_CLOSE',\n      publicStatus: 'HISTORICAL_REFERENCE_ONLY',\n      diagnosticCodes: ['HISTORICAL_REFERENCE_NOT_EXECUTION_ELIGIBLE'],\n    };"
  ],
  [
    "function synthesisBlockers(input) {",
    "function entityIntegrityBlockers(company, records, reference) {\n  const blockers = [];\n  const companyId = company?.companyId || null;\n  if (!companyId) blockers.push('COMPANY_IDENTITY_REQUIRED');\n\n  for (const record of records) {\n    const ids = Array.isArray(record?.companyIds) ? record.companyIds.filter(Boolean) : [];\n    if (ids.length && companyId && !ids.includes(companyId)) blockers.push('EVIDENCE_ENTITY_MISMATCH');\n  }\n\n  if (reference?.companyId && companyId && reference.companyId !== companyId) blockers.push('REFERENCE_PRICE_ENTITY_MISMATCH');\n  return unique(blockers);\n}\n\nfunction synthesisBlockers(input) {"
  ],
  [
    "    ...synthesisBlockers(input),\n    ...(reference ? [] : ['REFERENCE_PRICE_REQUIRED']),\n  ]);",
    "    ...synthesisBlockers(input),\n    ...(reference ? [] : ['REFERENCE_PRICE_REQUIRED']),\n    ...entityIntegrityBlockers(company, records, reference),\n  ]);"
  ],
  [
    "    listing: company.primaryListing || { exchange: 'Unknown', symbol: 'UNKNOWN', mic: null },\n    decisionBasis:",
    "    listing: company.primaryListing || { exchange: 'Unknown', symbol: 'UNKNOWN', mic: null },\n    integrityContractVersion: 1,\n    listingIntegrity: {\n      activeTradingVerified: company.activeTradingVerified === true || company.primaryListing?.activeTradingVerified === true,\n      lifecycleStatus: company.listingStatus || company.primaryListing?.status || null,\n      verifiedAt: company.listingVerifiedAt || company.primaryListing?.verifiedAt || null,\n    },\n    decisionBasis:"
  ]
];
for (let index = 0; index < operations.length; index += 1) {
  const [from, to] = operations[index];
  content = replaceRequired(content, from, to, `research-dossier replacement ${index + 1}`);
}
fs.writeFileSync(file, content);
console.log("Investor Control v1.8.4 research-dossier integrity patch applied.");
