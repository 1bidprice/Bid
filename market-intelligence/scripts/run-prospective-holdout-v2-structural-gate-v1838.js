import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildProspectiveHoldoutProtocolV2,
  verifyProspectiveHoldoutCaptureV2,
} from '../src/forecast-prospective-holdout-protocol-v2.js';
import { loadV2CapturesFromDirectory } from './run-prospective-holdout-v2-outcome-maturation-v1837.js';

export const V1838_STRUCTURAL_GATE_CONTRACT = 'PROSPECTIVE_HOLDOUT_V2_STRUCTURAL_EVALUATION_GATE_V1';
export const V1838_STRUCTURAL_GATE_VERSION = '2026-08-17.1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function sha256(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function dateKey(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}
function finiteTime(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}
function pct(value) { return Number.isFinite(value) ? Number(value.toFixed(4)) : 0; }

function extractStructuralOutcomeView(maturationArtifact = {}) {
  return (Array.isArray(maturationArtifact?.outcomes) ? maturationArtifact.outcomes : [])
    .map((item) => ({
      captureHash: item?.captureHash || null,
      companyId: item?.companyId || null,
      horizon: item?.horizon || null,
      tradingDays: Number(item?.tradingDays || 0),
      featureAsOf: item?.featureAsOf || null,
      status: item?.status || null,
      outcomeKnownAt: item?.status === 'MATURED_OUTCOME_AVAILABLE' ? item?.outcomeKnownAt || null : null,
      sourceCaptureVerified: item?.sourceCaptureVerified === true,
    }));
}

function targetRowsFromCapture(capture, structuralOutcomes, protocol) {
  const outcomeMap = new Map(structuralOutcomes.map((item) => [`${item.captureHash}|${item.companyId}|${item.horizon}`, item]));
  const variants = new Set(protocol.modelFreeze.modelVariants);
  const targets = new Map();
  for (const slot of capture.slots || []) {
    const key = `${slot.companyId}|${slot.horizon}`;
    const current = targets.get(key) || { slots: [], companyId: slot.companyId, horizon: slot.horizon };
    current.slots.push(slot);
    targets.set(key, current);
  }
  const rows = [];
  for (const target of targets.values()) {
    const modelVariants = new Set(target.slots.map((slot) => slot.modelVariant));
    const allVariantsPresent = variants.size === modelVariants.size && [...variants].every((variant) => modelVariants.has(variant));
    const allVariantsForecastAvailable = allVariantsPresent && target.slots.every((slot) => slot.status === 'FORECAST_AVAILABLE');
    if (!allVariantsForecastAvailable) continue;
    const first = target.slots[0];
    const sameFingerprint = target.slots.every((slot) => slot.targetFeatureFingerprint === first.targetFeatureFingerprint);
    const sameRegime = target.slots.every((slot) => slot.regimeKey === first.regimeKey);
    const sameFeatureAsOf = target.slots.every((slot) => slot.featureAsOf === first.featureAsOf);
    if (!sameFingerprint || !sameRegime || !sameFeatureAsOf) continue;
    const outcome = outcomeMap.get(`${capture.contentHash}|${target.companyId}|${target.horizon}`);
    if (!outcome || outcome.status !== 'MATURED_OUTCOME_AVAILABLE' || outcome.sourceCaptureVerified !== true) continue;
    const startMs = finiteTime(first.featureAsOf);
    const endMs = finiteTime(outcome.outcomeKnownAt);
    if (startMs === null || endMs === null || endMs <= startMs) continue;
    rows.push({
      captureHash: capture.contentHash,
      companyId: target.companyId,
      horizon: target.horizon,
      tradingDays: Number(first.tradingDays || outcome.tradingDays || 0),
      regimeKey: first.regimeKey,
      targetFeatureFingerprint: first.targetFeatureFingerprint,
      featureAsOf: first.featureAsOf,
      outcomeKnownAt: outcome.outcomeKnownAt,
      forecastDate: dateKey(first.featureAsOf),
      startMs,
      endMs,
    });
  }
  return rows;
}

function maximumNonOverlappingForecastDates(rows = []) {
  const byDate = new Map();
  for (const row of rows) {
    const current = byDate.get(row.forecastDate) || { forecastDate: row.forecastDate, startMs: row.startMs, endMs: row.endMs };
    current.startMs = Math.min(current.startMs, row.startMs);
    current.endMs = Math.max(current.endMs, row.endMs);
    byDate.set(row.forecastDate, current);
  }
  const ordered = [...byDate.values()].sort((a, b) => a.endMs - b.endMs || a.startMs - b.startMs || String(a.forecastDate).localeCompare(String(b.forecastDate)));
  let lastEnd = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const item of ordered) {
    if (item.startMs < lastEnd) continue;
    count += 1;
    lastEnd = item.endMs;
  }
  return count;
}

function chronologicalBlocks(rows = [], blockCount = 3) {
  const dates = [...new Set(rows.map((row) => row.forecastDate).filter(Boolean))].sort();
  if (!dates.length) return [];
  const blocks = [];
  for (let block = 0; block < blockCount; block += 1) {
    const startIndex = Math.floor((block * dates.length) / blockCount);
    const endIndex = Math.floor(((block + 1) * dates.length) / blockCount);
    const blockDates = new Set(dates.slice(startIndex, endIndex));
    const sampleSize = rows.filter((row) => blockDates.has(row.forecastDate)).length;
    blocks.push({
      block: block + 1,
      startDate: dates[startIndex] || null,
      endDate: dates[Math.max(startIndex, endIndex - 1)] || null,
      distinctForecastDates: blockDates.size,
      sampleSize,
    });
  }
  return blocks;
}

function structuralGroupSummary(rows, protocol) {
  const thresholds = protocol.evaluationProtocol;
  const sampleSize = rows.length;
  const dateCounts = new Map();
  const instrumentCounts = new Map();
  for (const row of rows) {
    dateCounts.set(row.forecastDate, (dateCounts.get(row.forecastDate) || 0) + 1);
    instrumentCounts.set(row.companyId, (instrumentCounts.get(row.companyId) || 0) + 1);
  }
  const distinctForecastDates = dateCounts.size;
  const distinctInstruments = instrumentCounts.size;
  const maximumSingleForecastDateSharePct = sampleSize ? Math.max(...dateCounts.values()) / sampleSize * 100 : 100;
  const maximumSingleInstrumentSharePct = sampleSize ? Math.max(...instrumentCounts.values()) / sampleSize * 100 : 100;
  const shares = sampleSize ? [...instrumentCounts.values()].map((value) => value / sampleSize) : [];
  const effectiveInstrumentCount = shares.length ? 1 / shares.reduce((sum, share) => sum + share * share, 0) : 0;
  const effectiveNonOverlappingWindowCount = maximumNonOverlappingForecastDates(rows);
  const blocks = chronologicalBlocks(rows, thresholds.chronologicalBlockCount);
  const minimumChronologicalBlockSample = blocks.length ? Math.min(...blocks.map((block) => block.sampleSize)) : 0;
  const blockers = [];
  if (sampleSize < thresholds.minimumEvaluationSamplePerGroup) blockers.push('STRUCTURAL_EVALUATION_SAMPLE_TOO_SMALL');
  if (distinctForecastDates < thresholds.minimumDistinctForecastDates) blockers.push('STRUCTURAL_DISTINCT_FORECAST_DATES_TOO_SMALL');
  if (distinctInstruments < thresholds.minimumDistinctInstruments) blockers.push('STRUCTURAL_DISTINCT_INSTRUMENTS_TOO_SMALL');
  if (maximumSingleForecastDateSharePct > thresholds.maximumSingleForecastDateSharePct) blockers.push('STRUCTURAL_SINGLE_FORECAST_DATE_CONCENTRATION_TOO_HIGH');
  if (effectiveNonOverlappingWindowCount < thresholds.minimumEffectiveNonOverlappingWindows) blockers.push('STRUCTURAL_NON_OVERLAPPING_WINDOWS_TOO_SMALL');
  if (maximumSingleInstrumentSharePct > thresholds.maximumSingleInstrumentSharePct) blockers.push('STRUCTURAL_SINGLE_INSTRUMENT_CONCENTRATION_TOO_HIGH');
  if (effectiveInstrumentCount < thresholds.minimumEffectiveInstrumentCount) blockers.push('STRUCTURAL_EFFECTIVE_INSTRUMENT_COUNT_TOO_SMALL');
  if (blocks.length !== thresholds.chronologicalBlockCount || minimumChronologicalBlockSample < thresholds.minimumChronologicalBlockSample) blockers.push('STRUCTURAL_CHRONOLOGICAL_BLOCK_COVERAGE_TOO_SMALL');
  return {
    status: blockers.length ? 'STRUCTURAL_GROUP_NOT_READY' : 'STRUCTURAL_GROUP_READY',
    ready: blockers.length === 0,
    sampleSize,
    distinctForecastDates,
    distinctInstruments,
    maximumSingleForecastDateSharePct: pct(maximumSingleForecastDateSharePct),
    effectiveNonOverlappingWindowCount,
    maximumSingleInstrumentSharePct: pct(maximumSingleInstrumentSharePct),
    effectiveInstrumentCount: Number(effectiveInstrumentCount.toFixed(4)),
    chronologicalBlocks: blocks,
    minimumChronologicalBlockSample,
    thresholds: {
      minimumEvaluationSamplePerGroup: thresholds.minimumEvaluationSamplePerGroup,
      minimumDistinctForecastDates: thresholds.minimumDistinctForecastDates,
      minimumDistinctInstruments: thresholds.minimumDistinctInstruments,
      maximumSingleForecastDateSharePct: thresholds.maximumSingleForecastDateSharePct,
      minimumEffectiveNonOverlappingWindows: thresholds.minimumEffectiveNonOverlappingWindows,
      maximumSingleInstrumentSharePct: thresholds.maximumSingleInstrumentSharePct,
      minimumEffectiveInstrumentCount: thresholds.minimumEffectiveInstrumentCount,
      chronologicalBlockCount: thresholds.chronologicalBlockCount,
      minimumChronologicalBlockSample: thresholds.minimumChronologicalBlockSample,
    },
    blockers,
  };
}

export function buildV1838StructuralEvaluationGate(input = {}) {
  const protocol = input.protocol || buildProspectiveHoldoutProtocolV2();
  const captures = Array.isArray(input.captures) ? input.captures : [];
  const maturationArtifact = input.maturationArtifact || {};
  const structuralOutcomes = extractStructuralOutcomeView(maturationArtifact);
  const blockers = [];
  let sourceCaptureVerificationFailureCount = 0;
  const rows = [];
  for (const capture of captures) {
    const verification = verifyProspectiveHoldoutCaptureV2(capture, protocol);
    if (!verification.verified) {
      sourceCaptureVerificationFailureCount += 1;
      continue;
    }
    rows.push(...targetRowsFromCapture(capture, structuralOutcomes, protocol));
  }
  if (!captures.length) blockers.push('STRUCTURAL_GATE_NO_V2_CAPTURES');
  if (sourceCaptureVerificationFailureCount) blockers.push('STRUCTURAL_GATE_SOURCE_CAPTURE_VERIFICATION_FAILED');
  if (maturationArtifact?.contract !== 'PROSPECTIVE_HOLDOUT_V2_OUTCOME_MATURATION_V1'
      || maturationArtifact?.holdoutId !== protocol.holdoutId
      || maturationArtifact?.protocolContract !== protocol.contract) blockers.push('STRUCTURAL_GATE_MATURATION_LINEAGE_MISMATCH');
  if (maturationArtifact?.performancePeeked !== false || maturationArtifact?.performanceMetricsIncluded !== false || maturationArtifact?.evaluationGateOpened !== false) blockers.push('STRUCTURAL_GATE_INPUT_ALREADY_EXPOSED_PERFORMANCE');
  if (!rows.length) blockers.push('STRUCTURAL_GATE_NO_MATURED_COMMON_VARIANT_TARGETS');

  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.horizon}|${row.regimeKey}`;
    const current = grouped.get(key) || { horizon: row.horizon, regimeKey: row.regimeKey, rows: [] };
    current.rows.push(row);
    grouped.set(key, current);
  }
  const groups = [...grouped.values()]
    .map((group) => ({
      horizon: group.horizon,
      regimeKey: group.regimeKey,
      ...structuralGroupSummary(group.rows, protocol),
    }))
    .sort((a, b) => a.horizon.localeCompare(b.horizon) || a.regimeKey.localeCompare(b.regimeKey));
  const readyGroups = groups.filter((group) => group.ready);
  const performanceGateEligible = blockers.length === 0 && readyGroups.length > 0;
  if (!readyGroups.length) blockers.push('STRUCTURAL_GATE_NO_READY_HORIZON_REGIME_GROUP');

  const core = {
    format: 'investor-control-prospective-holdout-v2-structural-evaluation-gate',
    version: 1,
    policyVersion: V1838_STRUCTURAL_GATE_VERSION,
    contract: V1838_STRUCTURAL_GATE_CONTRACT,
    sourceCommit: input.sourceCommit || null,
    holdoutId: protocol.holdoutId,
    protocolContract: protocol.contract,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    status: performanceGateEligible ? 'STRUCTURAL_PERFORMANCE_GATE_ELIGIBLE' : 'STRUCTURAL_PERFORMANCE_GATE_NOT_READY',
    performanceGateEligible,
    captureCount: captures.length,
    sourceCaptureVerificationFailureCount,
    maturedCommonVariantTargetCount: rows.length,
    structuralGroupCount: groups.length,
    structurallyReadyGroupCount: readyGroups.length,
    groups,
    blockers: [...new Set(blockers)],
    structuralInputsOnly: true,
    usesMaturationStatusAndTimingOnly: true,
    probabilitiesIncluded: false,
    rawPatternBaselinesIncluded: false,
    outcomeSignsIncluded: false,
    outcomeReturnsIncluded: false,
    classCountsIncluded: false,
    performanceMetricsIncluded: false,
    performancePeeked: false,
    evaluationGateOpened: false,
    nextAllowedAction: performanceGateEligible
      ? 'MAY_RUN_SEPARATE_PREDECLARED_POST_GATE_PERFORMANCE_EVALUATOR_WITHOUT_MODEL_PROMOTION_AUTHORITY'
      : 'CONTINUE_PROSPECTIVE_CAPTURE_AND_OUTCOME_MATURATION_WITHOUT_PERFORMANCE_EVALUATION',
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
  return { ...core, contentHashAlgorithm: 'SHA256_CANONICAL_JSON', contentHash: sha256(core) };
}

export function assertV1838StructuralGateSafe(artifact = {}) {
  const blockers = [];
  if (artifact?.contract !== V1838_STRUCTURAL_GATE_CONTRACT) blockers.push('V1838_CONTRACT_CHANGED');
  if (artifact?.structuralInputsOnly !== true || artifact?.usesMaturationStatusAndTimingOnly !== true) blockers.push('V1838_NONSTRUCTURAL_INPUT_DECLARED');
  if (artifact?.probabilitiesIncluded !== false || artifact?.rawPatternBaselinesIncluded !== false || artifact?.outcomeSignsIncluded !== false || artifact?.outcomeReturnsIncluded !== false || artifact?.classCountsIncluded !== false || artifact?.performanceMetricsIncluded !== false || artifact?.performancePeeked !== false || artifact?.evaluationGateOpened !== false) blockers.push('V1838_PRE_GATE_INFORMATION_BOUNDARY_BROKEN');
  if (artifact?.automaticModelPromotionEnabled !== false || artifact?.probabilityCalibrationEnabled !== false || artifact?.decisionIntegrationEnabled !== false || artifact?.forecastMayInfluenceFinalAction !== false || artifact?.finalActionEligible !== false || artifact?.brokerExecutionEligible !== false || artifact?.decisionImpact !== 'NONE') blockers.push('V1838_AUTHORITY_BOUNDARY_BROKEN');
  if (artifact?.contentHashAlgorithm !== 'SHA256_CANONICAL_JSON' || !artifact?.contentHash) blockers.push('V1838_HASH_MISSING');
  const { contentHash: _hash, contentHashAlgorithm: _algorithm, ...core } = artifact || {};
  if (artifact?.contentHash !== sha256(core)) blockers.push('V1838_HASH_INVALID');
  if (artifact?.performanceGateEligible === true && artifact?.structurallyReadyGroupCount < 1) blockers.push('V1838_GATE_OPEN_WITHOUT_READY_GROUP');
  const unique = [...new Set(blockers)];
  if (unique.length) throw new Error(`v1838 structural gate blocked: ${unique.join(',')}`);
  return true;
}

async function loadLatestMaturationArtifact(filePath) {
  return JSON.parse(await readFile(path.resolve(process.cwd(), filePath), 'utf8'));
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1838-structural-gate.json');
  const captureDirectory = process.env.PROSPECTIVE_V2_CAPTURE_ARTIFACT_DIRECTORY || process.argv[3];
  const maturationPath = process.env.PROSPECTIVE_V2_MATURATION_ARTIFACT_PATH || process.argv[4];
  if (!captureDirectory || !maturationPath) throw new Error('v1838 requires v2 capture directory and v1837 maturation artifact path');
  const captures = await loadV2CapturesFromDirectory(path.resolve(process.cwd(), captureDirectory));
  const maturationArtifact = await loadLatestMaturationArtifact(maturationPath);
  const artifact = buildV1838StructuralEvaluationGate({
    captures,
    maturationArtifact,
    sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT || null,
  });
  assertV1838StructuralGateSafe(artifact);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(`Wrote v1838 structural gate to ${outputPath}`);
  console.log(`Matured common-variant targets: ${artifact.maturedCommonVariantTargetCount}`);
  console.log(`Structural groups: ${artifact.structuralGroupCount}; ready: ${artifact.structurallyReadyGroupCount}`);
  console.log(`Performance gate eligible: ${artifact.performanceGateEligible}`);
  console.log(`Performance peeked: ${artifact.performancePeeked}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) main().catch((error) => { console.error(error); process.exitCode = 1; });
