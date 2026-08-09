import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/run-autonomous-intelligence.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.7 hunter compatibility failed: missing ${label}`);
  source = source.replace(from, to);
}

replaceRequired(
  "import { buildSecFramesBroadEquityScreen } from './adapters/sec-frames-broad-equity-screen.js';",
  "import { buildSecFramesBroadEquityScreen } from './adapters/sec-frames-broad-equity-screen.js';\nimport { gateBroadEquityOpportunityCandidate, gateDeepEquityOpportunityModel } from './opportunity-model-gate.js';\nimport { selectBroadFundamentalCandidates } from './broad-equity-fundamental-selector.js';\nimport { screenBroadEquityMarketCandidates } from './broad-equity-market-screen.js';",
  'opportunity hunter imports',
);

const canonical = `  const finalActionCount = Object.entries(finalActionCounts)
    .filter(([key]) => key !== 'BLOCKED')
    .reduce((sum, [, value]) => sum + value, 0);`;
const compact = `  const finalActionCount = Object.entries(finalActionCounts).filter(([key]) => key !== 'BLOCKED').reduce((sum, [, value]) => sum + value, 0);`;
replaceRequired(compact, canonical, 'finalActionCount canonical formatting');

replaceRequired(
  `    if (profile.assetClass !== 'EQUITY' || profile.analysisModel !== 'EQUITY_OPERATING') {`,
  `    const deepOpportunityModelGate = gateDeepEquityOpportunityModel(profile, fundamentals);

    if (!deepOpportunityModelGate.eligible) {`,
  'deep fundamental model quarantine',
);

replaceRequired(
  `      limit: options.broadOpportunityDeepAnalysisLimit || 12,`,
  `      limit: options.broadOpportunityFundamentalPoolLimit || 800,`,
  'broad fundamental pool budget',
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
    const gated = riskFiltered.map((candidate) => ({ candidate, gate: gateBroadEquityOpportunityCandidate(candidate) }));
    const genericCandidates = gated.filter((item) => item.gate.eligible).map((item) => item.candidate);
    const specializedQuarantine = gated.filter((item) => !item.gate.eligible);
    const fundamentalSelection = selectBroadFundamentalCandidates(genericCandidates, {
      limit: options.broadOpportunityMarketScreenLimit || 240,
      maxPreliminaryRiskScore: 80,
    });
    const marketScreen = await screenBroadEquityMarketCandidates(fundamentalSelection.candidates, {
      fetchImpl: options.fetchImpl || globalThis.fetch,
      now: generatedAt,
      benchmarkSymbol: options.broadOpportunityBenchmarkSymbol || 'SPY',
      concurrency: options.broadOpportunityMarketConcurrency || 8,
      limit: options.broadOpportunityDeepAnalysisLimit || 24,
    });
    return {
      ...screen,
      enabled: true,
      directoryEligibleCount: directory.totalEligibleCount ?? directory.instruments?.length ?? 0,
      directoryTruncated: directory.truncated === true,
      fundamentalPoolCount: genericCandidates.length,
      fundamentalSelectedCount: fundamentalSelection.selectedCount,
      marketScreenInputCount: fundamentalSelection.selectedCount,
      marketScreenScorableCount: marketScreen.scorableCount,
      marketScreenEligibleCount: marketScreen.eligibleCount || 0,
      marketScreenStatus: marketScreen.status,
      marketScreenPolicyVersion: marketScreen.policyVersion,
      marketScreenDiagnostics: marketScreen.diagnostics,
      candidates: marketScreen.candidates,
      specializedQuarantineCount: specializedQuarantine.length,
      specializedQuarantine: specializedQuarantine.map(({ candidate, gate }) => ({
        instrumentId: candidate.instrumentId,
        companyId: candidate.companyId,
        displayName: candidate.displayName,
        primaryListing: candidate.primaryListing,
        model: gate.model,
        reason: gate.reason,
      })),
    };`,
  'broad specialized/model/market funnel',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  canonical,
  "gateBroadEquityOpportunityCandidate, gateDeepEquityOpportunityModel } from './opportunity-model-gate.js'",
  "selectBroadFundamentalCandidates } from './broad-equity-fundamental-selector.js'",
  "screenBroadEquityMarketCandidates } from './broad-equity-market-screen.js'",
  'const deepOpportunityModelGate = gateDeepEquityOpportunityModel(profile, fundamentals)',
  'broadOpportunityFundamentalPoolLimit || 800',
  'broadOpportunityMarketScreenLimit || 240',
  'broadOpportunityDeepAnalysisLimit || 24',
  'marketScreenScorableCount',
  'specializedQuarantineCount',
  'broadOpportunityScan',
  'opportunityUniverse',
  'opportunityDeepVerificationQueue',
  "finalActionEligible: false",
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.7 hunter compatibility failed: missing ${invariant}`);
}

console.log('Investor Control v1.7 opportunity hunter compatibility, diversified market screen and specialized-equity quarantine applied.');
