import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHistoricalResearchValidationUniverse } from '../src/historical-research-validation-universe.js';
import { fetchProfessionalHistoricalMetrics } from '../src/professional-market-data.js';
import {
  buildProspectiveHoldoutProtocolV2,
  verifyProspectiveHoldoutCaptureV2,
} from '../src/forecast-prospective-holdout-protocol-v2.js';

export const V1837_V2_OUTCOME_MATURATION_CONTRACT = 'PROSPECTIVE_HOLDOUT_V2_OUTCOME_MATURATION_V1';
export const V1837_V2_OUTCOME_MATURATION_VERSION = '2026-08-17.1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function sha256(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function isoFromSeconds(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null; }
function dateKey(value) { const n = Date.parse(value || ''); return Number.isFinite(n) ? new Date(n).toISOString().slice(0, 10) : null; }
function round(value, digits = 8) { return Number.isFinite(value) ? Number(value.toFixed(digits)) : null; }
function candles(series = {}) {
  return (Array.isArray(series?.candles) ? series.candles : [])
    .filter((c) => Number.isFinite(Number(c?.timestamp)) && Number.isFinite(Number(c?.close)) && Number(c.close) > 0)
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
}
function sessionIndex(series, featureAsOf) {
  const date = dateKey(featureAsOf);
  return date ? candles(series).findIndex((c) => isoFromSeconds(c.timestamp)?.slice(0, 10) === date) : -1;
}
function extractV2Capture(proof = {}) {
  if (proof?.contract === 'PROSPECTIVE_UNSEEN_HOLDOUT_V2_FIRST_CAPTURE_PROOF_V1') return proof.capture || null;
  if (proof?.contract === 'PROSPECTIVE_UNSEEN_HOLDOUT_V2_CHAINED_SESSION_CAPTURE_V1' && proof?.captureCreated === true) return proof.capture || null;
  return null;
}

export async function loadV2CapturesFromDirectory(directoryPath) {
  const files = [];
  async function walk(base) {
    for (const item of await readdir(base, { withFileTypes: true })) {
      const full = path.join(base, item.name);
      if (item.isDirectory()) await walk(full);
      else if (item.isFile() && item.name.endsWith('.json')) files.push(full);
    }
  }
  await walk(directoryPath);
  const captures = [];
  for (const file of files) {
    try {
      const proof = JSON.parse(await readFile(file, 'utf8'));
      const capture = extractV2Capture(proof);
      if (capture?.contentHash) captures.push(capture);
    } catch { /* unrelated downloaded artifacts are ignored */ }
  }
  return [...new Map(captures.map((capture) => [capture.contentHash, capture])).values()]
    .sort((a, b) => Date.parse(a.capturedAt || 0) - Date.parse(b.capturedAt || 0));
}

async function loadOutcomeMarketData(input = {}) {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const universe = buildHistoricalResearchValidationUniverse();
  const benchmarkCache = new Map();
  const loaded = [];
  for (const company of universe) {
    const history = await fetchProfessionalHistoricalMetrics(company, {
      generatedAt,
      token: '',
      fetchImpl: input.fetchImpl || globalThis.fetch,
      marketSnapshot: null,
      lookbackDays: 365,
      benchmarkMinimumObservationCount: 200,
      benchmarkFetchMaxAttempts: 3,
      benchmarkRetryDelayMs: 500,
      benchmarkCache,
    });
    loaded.push({ company, series: history.series || null, benchmarkSeries: history.benchmarkSeries || null });
  }
  return { universe, loaded };
}

export function matureV2CaptureOutcomes(capture, marketData, protocol = buildProspectiveHoldoutProtocolV2()) {
  const verification = verifyProspectiveHoldoutCaptureV2(capture, protocol);
  if (!verification.verified) throw new Error(`v1837 refuses unverified v2 capture: ${(verification.blockers || []).join(',')}`);
  const tuples = new Map();
  for (const slot of capture.slots || []) {
    const key = `${slot.companyId}|${slot.horizon}`;
    if (!tuples.has(key)) tuples.set(key, slot);
  }
  const outcomes = [];
  for (const slot of tuples.values()) {
    const loaded = marketData.loaded.find((item) => item.company.companyId === slot.companyId) || null;
    const companyCandles = candles(loaded?.series);
    const benchmarkCandles = candles(loaded?.benchmarkSeries);
    const companyAnchor = sessionIndex(loaded?.series, slot.featureAsOf);
    const benchmarkAnchor = sessionIndex(loaded?.benchmarkSeries, slot.featureAsOf);
    const tradingDays = Math.max(1, Math.trunc(Number(slot.tradingDays || 0)));
    const companyOutcomeIndex = companyAnchor >= 0 ? companyAnchor + tradingDays : -1;
    const benchmarkOutcomeIndex = benchmarkAnchor >= 0 ? benchmarkAnchor + tradingDays : -1;
    const matured = companyAnchor >= 0 && benchmarkAnchor >= 0
      && companyOutcomeIndex < companyCandles.length && benchmarkOutcomeIndex < benchmarkCandles.length;
    const common = {
      captureHash: capture.contentHash,
      holdoutId: capture.holdoutId,
      companyId: slot.companyId,
      symbol: slot.symbol,
      horizon: slot.horizon,
      tradingDays,
      featureAsOf: slot.featureAsOf,
      sourceCaptureVerified: true,
    };
    if (!matured) {
      outcomes.push({
        ...common,
        status: 'PENDING_HORIZON_MATURATION',
        completedCompanySessionsAfterFeature: companyAnchor >= 0 ? Math.max(0, companyCandles.length - companyAnchor - 1) : 0,
        completedBenchmarkSessionsAfterFeature: benchmarkAnchor >= 0 ? Math.max(0, benchmarkCandles.length - benchmarkAnchor - 1) : 0,
        outcomeKnownAt: null,
        positiveOutcome: null,
        realizedReturnPct: null,
        benchmarkReturnPct: null,
        benchmarkRelativeReturnPct: null,
      });
      continue;
    }
    const start = Number(companyCandles[companyAnchor].close);
    const end = Number(companyCandles[companyOutcomeIndex].close);
    const benchmarkStart = Number(benchmarkCandles[benchmarkAnchor].close);
    const benchmarkEnd = Number(benchmarkCandles[benchmarkOutcomeIndex].close);
    const realizedReturnPct = ((end / start) - 1) * 100;
    const benchmarkReturnPct = ((benchmarkEnd / benchmarkStart) - 1) * 100;
    outcomes.push({
      ...common,
      status: 'MATURED_OUTCOME_AVAILABLE',
      completedCompanySessionsAfterFeature: companyCandles.length - companyAnchor - 1,
      completedBenchmarkSessionsAfterFeature: benchmarkCandles.length - benchmarkAnchor - 1,
      outcomeKnownAt: isoFromSeconds(Math.max(Number(companyCandles[companyOutcomeIndex].timestamp), Number(benchmarkCandles[benchmarkOutcomeIndex].timestamp))),
      positiveOutcome: realizedReturnPct > 0 ? 1 : 0,
      realizedReturnPct: round(realizedReturnPct),
      benchmarkReturnPct: round(benchmarkReturnPct),
      benchmarkRelativeReturnPct: round(realizedReturnPct - benchmarkReturnPct),
    });
  }
  return { verification, outcomes };
}

export function assertV1837V2MaturationReady(artifact = {}) {
  const blockers = [];
  if (artifact?.contract !== V1837_V2_OUTCOME_MATURATION_CONTRACT) blockers.push('V1837_CONTRACT_CHANGED');
  if (artifact?.captureCount < 1) blockers.push('V1837_NO_V2_CAPTURES');
  if (artifact?.sourceCaptureVerificationFailureCount !== 0) blockers.push('V1837_CAPTURE_VERIFICATION_FAILURE');
  if (artifact?.outcomeTupleCount !== artifact?.captureCount * 32) blockers.push('V1837_OUTCOME_TUPLE_MATRIX_INCOMPLETE');
  if (artifact?.performanceMetricsIncluded !== false || artifact?.performancePeeked !== false || artifact?.evaluationGateOpened !== false) blockers.push('V1837_PRE_GATE_PERFORMANCE_PEEK');
  if (artifact?.automaticModelPromotionEnabled !== false || artifact?.decisionIntegrationEnabled !== false || artifact?.forecastMayInfluenceFinalAction !== false || artifact?.brokerExecutionEligible !== false || artifact?.decisionImpact !== 'NONE') blockers.push('V1837_AUTHORITY_BOUNDARY_BROKEN');
  if (artifact?.contentHashAlgorithm !== 'SHA256_CANONICAL_JSON' || !artifact?.contentHash) blockers.push('V1837_HASH_MISSING');
  const { contentHash: _hash, contentHashAlgorithm: _algorithm, ...core } = artifact || {};
  if (artifact?.contentHash !== sha256(core)) blockers.push('V1837_HASH_INVALID');
  const unique = [...new Set(blockers)];
  if (unique.length) throw new Error(`v1837 v2 maturation blocked: ${unique.join(',')}`);
  return true;
}

export async function runV1837V2OutcomeMaturation(input = {}) {
  const captures = Array.isArray(input.captures) ? input.captures : [];
  if (!captures.length) throw new Error('v1837 requires at least one v2 capture');
  const protocol = buildProspectiveHoldoutProtocolV2();
  const generatedAt = new Date(input.generatedAt || Date.now()).toISOString();
  const marketData = input.marketData || await loadOutcomeMarketData({ generatedAt, fetchImpl: input.fetchImpl });
  const outcomes = [];
  let verificationFailures = 0;
  for (const capture of captures) {
    try { outcomes.push(...matureV2CaptureOutcomes(capture, marketData, protocol).outcomes); }
    catch { verificationFailures += 1; }
  }
  const core = {
    format: 'investor-control-prospective-holdout-v2-outcome-maturation',
    version: 1,
    policyVersion: V1837_V2_OUTCOME_MATURATION_VERSION,
    contract: V1837_V2_OUTCOME_MATURATION_CONTRACT,
    sourceCommit: input.sourceCommit || null,
    holdoutId: protocol.holdoutId,
    protocolContract: protocol.contract,
    generatedAt,
    captureCount: captures.length,
    sourceCaptureVerificationFailureCount: verificationFailures,
    outcomeTupleCount: outcomes.length,
    maturedOutcomeCount: outcomes.filter((item) => item.status === 'MATURED_OUTCOME_AVAILABLE').length,
    pendingOutcomeCount: outcomes.filter((item) => item.status === 'PENDING_HORIZON_MATURATION').length,
    outcomes,
    outcomeStorageMode: 'SEPARATE_FROM_IMMUTABLE_V2_FORECAST_CAPTURES',
    benchmarkRelativeOutcomeRequired: true,
    benchmarkFamily: 'SPY',
    modelProbabilitiesIncluded: false,
    rawPatternBaselinesIncluded: false,
    regimeKeysIncluded: false,
    performanceMetricsIncluded: false,
    performancePeeked: false,
    evaluationGateOpened: false,
    prospectiveResearchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
  const artifact = { ...core, contentHashAlgorithm: 'SHA256_CANONICAL_JSON', contentHash: sha256(core) };
  assertV1837V2MaturationReady(artifact);
  return artifact;
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1837-v2-outcome-maturation.json');
  const directory = process.env.PROSPECTIVE_V2_CAPTURE_ARTIFACT_DIRECTORY || process.argv[3];
  if (!directory) throw new Error('PROSPECTIVE_V2_CAPTURE_ARTIFACT_DIRECTORY is required');
  const captures = await loadV2CapturesFromDirectory(path.resolve(process.cwd(), directory));
  const artifact = await runV1837V2OutcomeMaturation({ captures, sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT || null });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(`Wrote v1837 v2 outcome maturation to ${outputPath}`);
  console.log(`V2 captures=${artifact.captureCount}; matured=${artifact.maturedOutcomeCount}; pending=${artifact.pendingOutcomeCount}`);
  console.log(`Performance peeked=${artifact.performancePeeked}; gate opened=${artifact.evaluationGateOpened}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) main().catch((error) => { console.error(error); process.exitCode = 1; });
