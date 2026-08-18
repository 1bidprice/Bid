import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, "src/opportunity-universe-scanner.js");

function replaceRequired(content, from, to, name) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.8.4 recommendation-integrity patch failed: ${name}`);
  return content.replace(from, to);
}

let content = fs.readFileSync(file, 'utf8');
const operations = [
  [
    "export const OPPORTUNITY_UNIVERSE_SCANNER_VERSION = '2026-08-09.1';",
    "export const OPPORTUNITY_UNIVERSE_SCANNER_VERSION = '2026-08-18.1';"
  ],
  [
    "function factorCapability(capabilities) {\n  const raw = capabilities?.capabilities?.OPPORTUNITY_FACTORS;\n  if (!raw || typeof raw !== 'object' || raw.verified !== true) return null;\n  return raw.factors && typeof raw.factors === 'object' ? raw.factors : null;\n}",
    "function factorCapability(capabilities) {\n  const raw = capabilities?.capabilities?.OPPORTUNITY_FACTORS;\n  if (!raw || typeof raw !== 'object' || raw.verified !== true) return null;\n  const factors = raw.factors && typeof raw.factors === 'object' ? raw.factors : null;\n  if (!factors) return null;\n  const entries = Object.entries(factors);\n  if (!entries.length) return null;\n  if (entries.some(([, factor]) =>\n    !factor ||\n    typeof factor !== 'object' ||\n    factor.verified !== true ||\n    !Number.isFinite(Number(factor.score)) ||\n    !Number.isFinite(Number(factor.sourceCount)) ||\n    Number(factor.sourceCount) < 1\n  )) return null;\n  return factors;\n}"
  ],
  [
    "    const evaluation = evaluateInstrumentCapabilities(profile, capabilities);\n    const providerFactors = factorCapability(capabilities);\n    const declaredFactors = instrument.opportunityFactors && typeof instrument.opportunityFactors === 'object' ? instrument.opportunityFactors : null;\n    const factors = providerFactors || declaredFactors;\n\n    if (!factors) {",
    "    const evaluation = evaluateInstrumentCapabilities(profile, capabilities);\n    const factors = factorCapability(capabilities);\n\n    if (!factors) {"
  ],
  [
    "reason: 'OPPORTUNITY_FACTORS_REQUIRED',",
    "reason: 'VERIFIED_OPPORTUNITY_FACTORS_REQUIRED',"
  ],
  [
    "    const equityRisk = Number(instrument.opportunityRiskScore);\n    const riskScore = Number.isFinite(equityRisk) ? equityRisk : evaluation.riskScore;\n    scoredCandidates.push({\n      instrumentId: profile.instrumentId,\n      displayName: profile.displayName,\n      profile,\n      factors,\n      riskScore: Number.isFinite(Number(riskScore)) ? Number(riskScore) : 100,\n      liquidityScore: scoreFromLiquidity(capabilities),\n      executionQualityScore: Number.isFinite(Number(instrument.executionQualityScore)) ? Number(instrument.executionQualityScore) : scoreFromLiquidity(capabilities),\n      evidenceQualityScore: Number.isFinite(Number(instrument.evidenceQualityScore)) ? Number(instrument.evidenceQualityScore) : evidenceQuality(capabilities, evaluation),\n      contradictionCount: Number(instrument.contradictionCount || 0),\n      severeRiskFlags: [...new Set([...(evaluation.riskFlags || []), ...(instrument.severeRiskFlags || [])].filter((flag) => /^SEVERE_|^EXTREME_|DISTRESS|SOLVENCY|DEFAULT/.test(String(flag))))],\n      strategyContextVerified: evaluation.strategyContextReady === true,\n      source: {\n        universeProviderId: instrument.universeProviderId || 'SEED_UNIVERSE',\n        capabilityProviderCount: capabilities.providerCount,\n      },\n    });",
    "    const riskScore = Number(evaluation.riskScore);\n    const executionQualityScore = scoreFromLiquidity(capabilities);\n    const evidenceQualityScore = evidenceQuality(capabilities, evaluation);\n    const contradictionCapability = capabilities?.capabilities?.CONTRADICTIONS;\n    const contradictionCount = contradictionCapability?.verified === true && Number.isFinite(Number(contradictionCapability.count))\n      ? Math.max(0, Number(contradictionCapability.count))\n      : 0;\n    scoredCandidates.push({\n      instrumentId: profile.instrumentId,\n      displayName: profile.displayName,\n      profile,\n      factors,\n      riskScore: Number.isFinite(riskScore) ? riskScore : 100,\n      liquidityScore: executionQualityScore,\n      executionQualityScore,\n      evidenceQualityScore,\n      contradictionCount,\n      severeRiskFlags: [...new Set((evaluation.riskFlags || []).filter((flag) => /^SEVERE_|^EXTREME_|DISTRESS|SOLVENCY|DEFAULT/.test(String(flag))))],\n      strategyContextVerified: evaluation.strategyContextReady === true,\n      source: {\n        universeProviderId: instrument.universeProviderId || 'SEED_UNIVERSE',\n        capabilityProviderCount: capabilities.providerCount,\n        opportunityFactorsVerified: true,\n        rawSeedScoresIgnored: true,\n      },\n    });"
  ],
  [
    "    format: 'investor-control-opportunity-universe-scan',\n    version: 1,",
    "    format: 'investor-control-opportunity-universe-scan',\n    version: 2,"
  ],
  [
    "invariant: 'DISCOVERY_CAN_PRIORITIZE_DEEP_RESEARCH_BUT_CANNOT_BYPASS_FINAL_ACTION_POLICY',",
    "invariant: 'ONLY_PROVIDER_VERIFIED_FACTORS_MAY_ENTER_OPPORTUNITY_SCORING_AND_DISCOVERY_CAN_NEVER_BYPASS_FINAL_ACTION_POLICY',"
  ]
];
for (let index = 0; index < operations.length; index += 1) {
  const [from, to] = operations[index];
  content = replaceRequired(content, from, to, `opportunity-universe-scanner replacement ${index + 1}`);
}
fs.writeFileSync(file, content);
console.log("Investor Control v1.8.4 opportunity-universe-scanner integrity patch applied.");
