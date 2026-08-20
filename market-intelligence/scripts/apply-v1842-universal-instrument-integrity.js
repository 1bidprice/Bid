import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function replaceRequired(file, from, to, label) {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes(to)) return;
  if (!content.includes(from)) throw new Error(`v1.8.5 universal-instrument-integrity patch failed: ${label}`);
  content = content.replace(from, to);
  fs.writeFileSync(file, content);
}

const finalActionFile = path.join(root, 'src/final-action-policy.js');
replaceRequired(
  finalActionFile,
  "export const FINAL_ACTION_POLICY_VERSION = '2026-08-18.3';",
  "import { evaluateInstrumentIntegrity } from './instrument-integrity-gate.js';\n\nexport const FINAL_ACTION_POLICY_VERSION = '2026-08-20.1';",
  'final action import and policy version',
);
replaceRequired(
  finalActionFile,
  "  const evidence = Array.isArray(dossier?.evidence) ? dossier.evidence : [];\n\n  if ((!companyId || companyId === 'company:unknown') && strict) blockers.push('COMPANY_IDENTITY_REQUIRED');",
  "  const evidence = Array.isArray(dossier?.evidence) ? dossier.evidence : [];\n  const universalIntegrity = evaluateInstrumentIntegrity({\n    instrument: {\n      instrumentId: companyId,\n      companyId,\n      assetClass: dossier?.assetClass || 'EQUITY',\n      primaryListing: {\n        ...(dossier?.listing || {}),\n        currency: dossier?.listing?.currency || reference?.nativeCurrency || reference?.currency || null,\n        activeTradingVerified: dossier?.listingIntegrity?.activeTradingVerified === true,\n        status: dossier?.listingIntegrity?.lifecycleStatus || dossier?.listing?.status || null,\n        verifiedAt: dossier?.listingIntegrity?.verifiedAt || null,\n      },\n    },\n    quote: reference ? {\n      ...reference,\n      valuationEligible: reference?.valuationEligible === true || reference?.analysisReferenceEligible === true,\n    } : null,\n    purpose: executionSensitive ? 'DECISION' : directional ? 'VALUATION' : 'ROUTING',\n  });\n  blockers.push(...universalIntegrity.blockers);\n\n  if ((!companyId || companyId === 'company:unknown') && strict) blockers.push('COMPANY_IDENTITY_REQUIRED');",
  'universal decision gate',
);
replaceRequired(
  finalActionFile,
  "    evidenceCount: evidence.length,\n  };\n}",
  "    evidenceCount: evidence.length,\n    universal: universalIntegrity,\n  };\n}",
  'universal integrity result lineage',
);

const routerFile = path.join(root, 'src/instrument-router.js');
replaceRequired(
  routerFile,
  "import { buildInstrumentProfile, ASSET_CLASS } from './instrument-profile.js';",
  "import { buildInstrumentProfile, ASSET_CLASS } from './instrument-profile.js';\nimport { evaluateInstrumentIntegrity } from './instrument-integrity-gate.js';",
  'router integrity import',
);
replaceRequired(
  routerFile,
  "  const unavailable = Object.values(routes).filter((item) => item.status === 'UNAVAILABLE' || item.status === 'REQUIRES_PROVIDER');\n  return {",
  "  const integrity = evaluateInstrumentIntegrity({ profile, instrument, purpose: 'ROUTING' });\n  const unavailable = Object.values(routes).filter((item) => item.status === 'UNAVAILABLE' || item.status === 'REQUIRES_PROVIDER');\n  const blockers = [...new Set([\n    ...integrity.blockers,\n    ...unavailable.map((item) => `${item.capability}:${item.status}`),\n  ])];\n  return {",
  'router universal gate',
);
replaceRequired(
  routerFile,
  "    routes,\n    endToEndReady: unavailable.length === 0,\n    blockers: unavailable.map((item) => `${item.capability}:${item.status}`),",
  "    routes,\n    integrity,\n    endToEndReady: integrity.routingReady === true && unavailable.length === 0,\n    blockers,",
  'router readiness invariant',
);

console.log('Investor Control v1.8.5 universal instrument integrity gate applied to routing and final actions.');
