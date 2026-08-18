import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, "src/final-action-policy.js");

function replaceRequired(content, from, to, name) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.8.4 recommendation-integrity patch failed: ${name}`);
  return content.replace(from, to);
}

let content = fs.readFileSync(file, 'utf8');
const operations = [
  [
    "export const FINAL_ACTION_POLICY_VERSION = '2026-08-07.1';",
    "export const FINAL_ACTION_POLICY_VERSION = '2026-08-18.3';"
  ],
  [
    "function actionLabel(action) {",
    "function normalizedSymbol(value) {\n  return String(value || '').trim().toUpperCase().replace(/\\.(US|GR)$/i, '');\n}\n\nfunction decisionIntegrity(dossier) {\n  const blockers = [];\n  const strict = Number(dossier?.integrityContractVersion || 0) >= 1;\n  const companyId = dossier?.companyId || null;\n  const proposed = dossier?.proposedAction || 'WATCH';\n  const directional = proposed !== 'WATCH';\n  const reference = dossier?.referencePrice || null;\n  const listingSymbol = normalizedSymbol(dossier?.listing?.symbol);\n  const referenceSymbol = normalizedSymbol(reference?.appSymbol || reference?.symbol || reference?.providerSymbol);\n  const evidence = Array.isArray(dossier?.evidence) ? dossier.evidence : [];\n\n  if ((!companyId || companyId === 'company:unknown') && strict) blockers.push('COMPANY_IDENTITY_REQUIRED');\n\n  if (directional) {\n    if (!evidence.length && strict) blockers.push('DECISION_EVIDENCE_REQUIRED');\n    for (const record of evidence) {\n      const ids = Array.isArray(record?.companyIds) ? record.companyIds.filter(Boolean) : [];\n      if (!ids.length) {\n        if (strict) blockers.push('EVIDENCE_ENTITY_UNVERIFIED');\n      } else if (companyId && !ids.includes(companyId)) {\n        blockers.push('EVIDENCE_ENTITY_MISMATCH');\n      }\n    }\n\n    if (reference?.companyId && companyId && reference.companyId !== companyId) blockers.push('REFERENCE_PRICE_ENTITY_MISMATCH');\n    if (strict && reference?.sourceApproved !== true) blockers.push('REFERENCE_PRICE_SOURCE_NOT_APPROVED');\n    if (strict && reference?.timestampVerified !== true) blockers.push('REFERENCE_PRICE_TIMESTAMP_NOT_VERIFIED');\n    if (strict && reference?.decisionEligible !== true) blockers.push('REFERENCE_PRICE_NOT_DECISION_ELIGIBLE');\n    if (strict && reference?.executionFreshnessEligible !== true) blockers.push('REFERENCE_PRICE_NOT_EXECUTION_ELIGIBLE');\n    if (listingSymbol && referenceSymbol && listingSymbol !== referenceSymbol) blockers.push('LISTING_IDENTITY_MISMATCH');\n  }\n\n  if (proposed === 'CONSIDER_BUY' && strict) {\n    if (dossier?.listingIntegrity?.activeTradingVerified !== true) blockers.push('ACTIVE_LISTING_NOT_VERIFIED');\n    const lifecycle = String(dossier?.listingIntegrity?.lifecycleStatus || '').toUpperCase();\n    if (['DELISTED', 'INACTIVE', 'PRIVATE', 'ACQUIRED', 'CEASED_TRADING'].includes(lifecycle)) blockers.push('LISTING_NOT_ACTIVE');\n  }\n\n  return {\n    contractVersion: Number(dossier?.integrityContractVersion || 0),\n    strict,\n    passed: blockers.length === 0,\n    blockers: unique(blockers),\n    companyId,\n    listingSymbol: listingSymbol || null,\n    referenceSymbol: referenceSymbol || null,\n    evidenceCount: evidence.length,\n  };\n}\n\nfunction actionLabel(action) {"
  ],
  [
    "function dataQualityScore(dossier) {",
    "function dataQualityScore(dossier, integrity) {"
  ],
  [
    "  return clamp(score);\n}\n\nfunction confidenceScore(dossier, flags) {",
    "  const raw = clamp(score);\n  return integrity?.passed === true ? raw : Math.min(raw, 79);\n}\n\nfunction confidenceScore(dossier, flags, integrity) {"
  ],
  [
    "  return clamp(score);\n}\n\nfunction finalBlockers(dossier, now, options) {\n  const blockers = [];",
    "  const raw = clamp(score);\n  return integrity?.passed === true ? raw : Math.min(raw, 79);\n}\n\nfunction finalBlockers(dossier, now, options, integrity) {\n  const blockers = [...(integrity?.blockers || [])];"
  ],
  [
    "  const now = new Date(options.now || Date.now());\n  const freshness = finalBlockers(dossier, now, options);\n  const flags = riskFlags(dossier);\n  const quality = dataQualityScore(dossier);\n  const confidence = confidenceScore(dossier, flags);",
    "  const now = new Date(options.now || Date.now());\n  const integrity = decisionIntegrity(dossier);\n  const freshness = finalBlockers(dossier, now, options, integrity);\n  const flags = riskFlags(dossier);\n  const quality = dataQualityScore(dossier, integrity);\n  const confidence = confidenceScore(dossier, flags, integrity);"
  ],
  [
    "    confidenceScore: confidence,\n    dataQualityScore: quality,\n    reasons:",
    "    confidenceScore: confidence,\n    confidenceMeaning: 'POLICY_COMPLETENESS_HEURISTIC_NOT_PROBABILITY',\n    dataQualityScore: quality,\n    integrity,\n    reasons:"
  ]
];
for (let index = 0; index < operations.length; index += 1) {
  const [from, to] = operations[index];
  content = replaceRequired(content, from, to, `final-action-policy replacement ${index + 1}`);
}
fs.writeFileSync(file, content);
console.log("Investor Control v1.8.4 final-action-policy integrity patch applied.");
