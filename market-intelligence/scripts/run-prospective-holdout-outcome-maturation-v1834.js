import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHistoricalResearchValidationUniverse } from '../src/historical-research-validation-universe.js';
import { fetchProfessionalHistoricalMetrics, fetchProfessionalMarketSnapshot } from '../src/professional-market-data.js';
import { buildProspectiveHoldoutProtocol, verifyProspectiveHoldoutCapture } from '../src/forecast-prospective-holdout-protocol.js';

export const V1834_OUTCOME_MATURATION_CONTRACT = 'PROSPECTIVE_HOLDOUT_OUTCOME_MATURATION_V1';
export const V1834_OUTCOME_MATURATION_VERSION = '2026-08-17.1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function isoFromSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return new Date(number * 1000).toISOString();
}

function sessionDate(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function candles(series = {}) {
  return (Array.isArray(series?.candles) ? series.candles : [])
    .filter((candle) => Number.isFinite(Number(candle?.timestamp)) && Number.isFinite(Number(candle?.close)) && Number(candle.close) > 0)
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
}

function findSessionIndex(series = {}, featureAsOf) {
  const date = sessionDate(featureAsOf);
  if (!date) return -1;
  return candles(series).findIndex((candle) => isoFromSeconds(candle.timestamp)?.slice(0, 10) === date);
}

function round(value, digits = 8) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function extractCapture(proof = {}) {
  if (proof?.contract === 'PROSPECTIVE_UNSEEN_HOLDOUT_FIRST_CAPTURE_PROOF_V1') return proof.capture || null;
  if (proof?.contract === 'PROSPECTIVE_UNSEEN_HOLDOUT_CHAINED_SESSION_CAPTURE_V1' && proof?.captureCreated === true) return proof.capture || null;
  return null;
}

export async function loadProspectiveCapturesFromDirectory(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];
  async function walk(base, items) {
    for (const item of items) {
      const full = path.join(base, item.name);
      if (item.isDirectory()) {
        await walk(full, await readdir(full, { withFileTypes: true }));
      } else if (item.isFile() && item.name.endsWith('.json')) {
        files.push(full);
      }
    }
  }
  await walk(directoryPath, entries);
  const captures = [];
  for (const file of files) {
    try {
      const proof = JSON.parse(await readFile(file, 'utf8'));
      const capture = extractCapture(proof);
      if (capture?.contentHash) captures.push(capture);
    } catch {
      // Ignore unrelated or malformed downloaded artifacts; verified captures below remain fail-closed.
    }
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
    const snapshotResult = await fetchProfessionalMarketSnapshot(company, {
      generatedAt,
      token: input.finnhubToken || process.env.FINNHUB_TOKEN || '',
      fetchImpl: input.fetchImpl || globalThis.fetch,
    });
    const historyResult = await fetchProfessionalHistoricalMetrics(company, {
      generatedAt,
      token: '',
      fetchImpl: input.fetchImpl || globalThis.fetch,
      marketSnapshot: snapshotResult.snapshot,
      lookbackDays: 365,
      benchmarkMinimumObservationCount: 200,
      benchmarkFetchMaxAttempts: 3,
      benchmarkRetryDelayMs: 500,
      benchmarkCache,
    });
    loaded.push({ company, series: historyResult.series || null, benchmarkSeries: historyResult.benchmarkSeries || null });
  }
  return { universe, loaded };
}

export function matureCaptureOutcomes(capture, marketData, protocol = buildProspectiveHoldoutProtocol()) {
  const verification = verifyProspectiveHoldoutCapture(capture, protocol);
  if (!verification.verified) throw new Error(`v1834 refuses unverified capture: ${(verification.blockers || []).join(',')}`);
  const uniqueTuples = new Map();
  for (const slot of capture.slots || []) {
    const key = `${slot.companyId}|${slot.horizon}`;
    if (!uniqueTuples.has(key)) uniqueTuples.set(key, slot);
  }
  const outcomes = [];
  for (const slot of uniqueTuples.values()) {
    const loaded = marketData.loaded.find((item) => item.company.companyId === slot.companyId) || null;
    const companyCandles = candles(loaded?.series);
    const benchmarkCandles = candles(loaded?.benchmarkSeries);
    const companyAnchor = findSessionIndex(loaded?.series, slot.featureAsOf);
    const benchmarkAnchor = findSessionIndex(loaded?.benchmarkSeries, slot.featureAsOf);
    const tradingDays = Math.max(1, Math.trunc(Number(slot.tradingDays || 0)));
    const companyOutcomeIndex = companyAnchor >= 0 ? companyAnchor + tradingDays : -1;
    const benchmarkOutcomeIndex = benchmarkAnchor >= 0 ? benchmarkAnchor + tradingDays : -1;
    const matured = companyAnchor >= 0
      && benchmarkAnchor >= 0
      && companyOutcomeIndex < companyCandles.length
      && benchmarkOutcomeIndex < benchmarkCandles.length;
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
    const outcomeKnownAt = isoFromSeconds(Math.max(
      Number(companyCandles[companyOutcomeIndex].timestamp),
      Number(benchmarkCandles[benchmarkOutcomeIndex].timestamp),
    ));
    outcomes.push({
      ...common,
      status: 'MATURED_OUTCOME_AVAILABLE',
      completedCompanySessionsAfterFeature: companyCandles.length - companyAnchor - 1,
      completedBenchmarkSessionsAfterFeature: benchmarkCandles.length - benchmarkAnchor - 1,
      outcomeKnownAt,
      positiveOutcome: realizedReturnPct > 0 ? 1 : 0,
      realizedReturnPct: round(realizedReturnPct),
      benchmarkReturnPct: round(benchmarkReturnPct),
      benchmarkRelativeReturnPct: round(realizedReturnPct - benchmarkReturnPct),
    });
  }
  return { verification, outcomes };
}

export function assertV1834OutcomeMaturationReady(artifact = {}) {
  const blockers = [];
  if (artifact?.contract !== V1834_OUTCOME_MATURATION_CONTRACT) blockers.push('V1834_CONTRACT_CHANGED');
  if (artifact?.captureCount < 1) blockers.push('V1834_NO_VERIFIED_CAPTURES');
  if (artifact?.outcomeTupleCount !== artifact?.captureCount * 32) blockers.push('V1834_OUTCOME_TUPLE_MATRIX_INCOMPLETE');
  if (artifact?.sourceCaptureVerificationFailureCount !== 0) blockers.push('V1834_CAPTURE_VERIFICATION_FAILURE');
  if (artifact?.performanceMetricsIncluded !== false || artifact?.performancePeeked !== false) blockers.push('V1834_PRE_GATE_PERFORMANCE_PEEK');
  if (artifact?.automaticModelPromotionEnabled !== false
      || artifact?.decisionIntegrationEnabled !== false
      || artifact?.forecastMayInfluenceFinalAction !== false
      || artifact?.brokerExecutionEligible !== false
      || artifact?.decisionImpact !== 'NONE') blockers.push('V1834_AUTHORITY_BOUNDARY_BROKEN');
  if (artifact?.contentHashAlgorithm !== 'SHA256_CANONICAL_JSON' || !artifact?.contentHash) blockers.push('V1834_ARTIFACT_HASH_MISSING');
  const { contentHash: _hash, contentHashAlgorithm: _algorithm, ...core } = artifact || {};
  if (artifact?.contentHash !== sha256(core)) blockers.push('V1834_ARTIFACT_HASH_INVALID');
  const unique = [...new Set(blockers)];
  if (unique.length) throw new Error(`v1834 outcome maturation blocked: ${unique.join(',')}`);
  return true;
}

export async function runV1834OutcomeMaturation(input = {}) {
  const protocol = buildProspectiveHoldoutProtocol();
  const captures = Array.isArray(input.captures) ? input.captures : [];
  if (!captures.length) throw new Error('v1834 requires at least one captured prospective forecast artifact');
  const generatedAt = new Date(input.generatedAt || Date.now()).toISOString();
  const marketData = input.marketData || await loadOutcomeMarketData({
    generatedAt,
    finnhubToken: input.finnhubToken,
    fetchImpl: input.fetchImpl,
  });
  const allOutcomes = [];
  let verificationFailures = 0;
  for (const capture of captures) {
    try {
      const result = matureCaptureOutcomes(capture, marketData, protocol);
      allOutcomes.push(...result.outcomes);
    } catch {
      verificationFailures += 1;
    }
  }
  const maturedOutcomeCount = allOutcomes.filter((item) => item.status === 'MATURED_OUTCOME_AVAILABLE').length;
  const pendingOutcomeCount = allOutcomes.filter((item) => item.status === 'PENDING_HORIZON_MATURATION').length;
  const core = {
    format: 'investor-control-prospective-holdout-outcome-maturation',
    version: 1,
    policyVersion: V1834_OUTCOME_MATURATION_VERSION,
    contract: V1834_OUTCOME_MATURATION_CONTRACT,
    sourceCommit: input.sourceCommit || null,
    holdoutId: protocol.holdoutId,
    protocolContract: protocol.contract,
    generatedAt,
    captureCount: captures.length,
    sourceCaptureVerificationFailureCount: verificationFailures,
    outcomeTupleCount: allOutcomes.length,
    maturedOutcomeCount,
    pendingOutcomeCount,
    outcomes: allOutcomes,
    outcomeStorageMode: 'SEPARATE_FROM_IMMUTABLE_FORECAST_CAPTURES',
    benchmarkRelativeOutcomeRequired: true,
    benchmarkFamily: 'SPY',
    performanceMetricsIncluded: false,
    performancePeeked: false,
    evaluationGateOpened: false,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
  const artifact = {
    ...core,
    contentHashAlgorithm: 'SHA256_CANONICAL_JSON',
    contentHash: sha256(core),
  };
  assertV1834OutcomeMaturationReady(artifact);
  return artifact;
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1834-outcome-maturation.json');
  const captureDirectory = process.env.PROSPECTIVE_CAPTURE_ARTIFACT_DIRECTORY || process.argv[3];
  if (!captureDirectory) throw new Error('PROSPECTIVE_CAPTURE_ARTIFACT_DIRECTORY is required');
  const captures = await loadProspectiveCapturesFromDirectory(path.resolve(process.cwd(), captureDirectory));
  const artifact = await runV1834OutcomeMaturation({
    captures,
    sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT || null,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(`Wrote v1834 outcome maturation artifact to ${outputPath}`);
  console.log(`Verified captures: ${artifact.captureCount}`);
  console.log(`Outcome tuples: matured=${artifact.maturedOutcomeCount}, pending=${artifact.pendingOutcomeCount}`);
  console.log(`Performance metrics included: ${artifact.performanceMetricsIncluded}`);
  console.log(`Evaluation gate opened: ${artifact.evaluationGateOpened}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
