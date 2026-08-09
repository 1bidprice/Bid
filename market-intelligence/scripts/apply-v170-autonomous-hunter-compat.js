import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/run-autonomous-intelligence.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.7.0 hunter compatibility failed: missing ${label}`);
  source = source.replace(from, to);
}

replaceRequired(
  "import { buildSecFramesBroadEquityScreen } from './adapters/sec-frames-broad-equity-screen.js';",
  "import { buildSecFramesBroadEquityScreen } from './adapters/sec-frames-broad-equity-screen.js';\nimport { classifyFundamentalModel } from './fundamental-model.js';",
  'fundamental model classifier import',
);

const canonical = `  const finalActionCount = Object.entries(finalActionCounts)
    .filter(([key]) => key !== 'BLOCKED')
    .reduce((sum, [, value]) => sum + value, 0);`;
const compact = `  const finalActionCount = Object.entries(finalActionCounts).filter(([key]) => key !== 'BLOCKED').reduce((sum, [, value]) => sum + value, 0);`;
replaceRequired(compact, canonical, 'finalActionCount canonical formatting');

replaceRequired(
  `    if (profile.assetClass !== 'EQUITY' || profile.analysisModel !== 'EQUITY_OPERATING') {`,
  `    const deepFundamentalModel = fundamentals?.model || null;
    const genericDeepModelReady =
      deepFundamentalModel?.type === 'GENERIC_OPERATING' &&
      deepFundamentalModel?.genericValuationEligible === true &&
      deepFundamentalModel?.specializedModelRequired !== true &&
      deepFundamentalModel?.modelReady !== false;

    if (profile.assetClass !== 'EQUITY' || profile.analysisModel !== 'EQUITY_OPERATING' || !genericDeepModelReady) {`,
  'deep fundamental model quarantine',
);

replaceRequired(
  `    return {
      ...screen,
      enabled: true,
      directoryEligibleCount: directory.totalEligibleCount ?? directory.instruments?.length ?? 0,
      directoryTruncated: directory.truncated === true,
      candidates: (screen.candidates || []).filter((candidate) => Number(candidate.broadScreen?.preliminaryRiskScore || 100) < 80),
    };`,
  `    const riskFiltered = (screen.candidates || []).filter((candidate) => Number(candidate.broadScreen?.preliminaryRiskScore || 100) < 80);
    const specializedQuarantine = riskFiltered.filter((candidate) => classifyFundamentalModel(candidate).specializedModelRequired === true);
    const genericCandidates = riskFiltered.filter((candidate) => classifyFundamentalModel(candidate).genericValuationEligible === true);
    return {
      ...screen,
      enabled: true,
      directoryEligibleCount: directory.totalEligibleCount ?? directory.instruments?.length ?? 0,
      directoryTruncated: directory.truncated === true,
      candidates: genericCandidates,
      specializedQuarantineCount: specializedQuarantine.length,
      specializedQuarantine: specializedQuarantine.map((candidate) => ({
        instrumentId: candidate.instrumentId,
        companyId: candidate.companyId,
        displayName: candidate.displayName,
        primaryListing: candidate.primaryListing,
        model: classifyFundamentalModel(candidate),
        reason: 'SPECIALIZED_MODEL_REQUIRES_DEDICATED_OPPORTUNITY_LANE',
      })),
    };`,
  'broad specialized model quarantine',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  canonical,
  "classifyFundamentalModel } from './fundamental-model.js'",
  "deepFundamentalModel?.type === 'GENERIC_OPERATING'",
  'SPECIALIZED_MODEL_REQUIRES_DEDICATED_OPPORTUNITY_LANE',
  'specializedQuarantineCount',
  'broadOpportunityScan',
  'opportunityUniverse',
  'opportunityDeepVerificationQueue',
  "finalActionEligible: false",
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.7.0 hunter compatibility failed: missing ${invariant}`);
}

console.log('Investor Control v1.7.0 autonomous hunter compatibility and specialized-equity quarantine applied.');
