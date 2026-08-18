import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateForecastCalibration } from '../src/forecast-calibration.js';
import {
  buildProspectiveHoldoutProtocolV2,
  verifyProspectiveHoldoutCaptureV2,
} from '../src/forecast-prospective-holdout-protocol-v2.js';
import { loadV2CapturesFromDirectory } from './run-prospective-holdout-v2-outcome-maturation-v1837.js';
import { assertV1838StructuralGateSafe } from './run-prospective-holdout-v2-structural-gate-v1838.js';

export const V1839_PERFORMANCE_EVALUATION_CONTRACT = 'PROSPECTIVE_HOLDOUT_V2_POST_GATE_PERFORMANCE_EVALUATION_V1';
export const V1839_PERFORMANCE_EVALUATION_VERSION = '2026-08-17.1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function sha256(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function round(value, digits = 6) { return Number.isFinite(value) ? Number(value.toFixed(digits)) : null; }
function dateKey(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function emptyLockedArtifact(input, protocol, structuralGate) {
  const core = {
    format: 'investor-control-prospective-holdout-v2-post-gate-performance-evaluation',
    version: 1,
    policyVersion: V1839_PERFORMANCE_EVALUATION_VERSION,
    contract: V1839_PERFORMANCE_EVALUATION_CONTRACT,
    sourceCommit: input.sourceCommit || null,
    holdoutId: protocol.holdoutId,
    protocolContract: protocol.contract,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    structuralGateContract: structuralGate?.contract || null,
    structuralGateContentHash: structuralGate?.contentHash || null,
    structuralGateEligible: false,
    status: 'PERFORMANCE_EVALUATION_LOCKED',
    evaluationGateOpened: false,
    performanceMetricsIncluded: false,
    performancePeeked: false,
    evaluationCount: 0,
    evaluations: [],
    predictiveStandardSignalCount: 0,
    anyPredictiveStandardSignalDetected: false,
    sameHoldoutVariantSelectionAllowed: false,
    postHocWinnerSelectionAllowed: false,
    confirmatoryHoldoutRequiredBeforeAnyVariantSelection: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
    nextAllowedAction: 'CONTINUE_PROSPECTIVE_CAPTURE_MATURATION_AND_STRUCTURAL_GATE_ONLY',
  };
  return { ...core, contentHashAlgorithm: 'SHA256_CANONICAL_JSON', contentHash: sha256(core) };
}

function readyStructuralGroupKeys(structuralGate = {}) {
  return new Set((Array.isArray(structuralGate?.groups) ? structuralGate.groups : [])
    .filter((group) => group?.ready === true)
    .map((group) => `${group.horizon}|${group.regimeKey}`));
}

function maturedOutcomeMap(maturationArtifact = {}) {
  return new Map((Array.isArray(maturationArtifact?.outcomes) ? maturationArtifact.outcomes : [])
    .filter((outcome) => outcome?.status === 'MATURED_OUTCOME_AVAILABLE' && outcome?.sourceCaptureVerified === true)
    .map((outcome) => [`${outcome.captureHash}|${outcome.companyId}|${outcome.horizon}`, outcome]));
}

function buildEvaluationRows(captures, maturationArtifact, structuralGate, protocol) {
  const readyGroups = readyStructuralGroupKeys(structuralGate);
  const outcomes = maturedOutcomeMap(maturationArtifact);
  const rows = [];
  for (const capture of captures) {
    const verification = verifyProspectiveHoldoutCaptureV2(capture, protocol);
    if (!verification.verified) throw new Error(`v1839 refuses unverified v2 capture: ${(verification.blockers || []).join(',')}`);
    const targets = new Map();
    for (const slot of capture.slots || []) {
      const key = `${slot.companyId}|${slot.horizon}`;
      const current = targets.get(key) || [];
      current.push(slot);
      targets.set(key, current);
    }
    for (const slots of targets.values()) {
      const first = slots[0];
      const groupKey = `${first.horizon}|${first.regimeKey}`;
      if (!readyGroups.has(groupKey)) continue;
      const expectedVariants = new Set(protocol.modelFreeze.modelVariants);
      const actualVariants = new Set(slots.map((slot) => slot.modelVariant));
      if (slots.length !== expectedVariants.size || actualVariants.size !== expectedVariants.size || ![...expectedVariants].every((variant) => actualVariants.has(variant))) continue;
      if (!slots.every((slot) => slot.status === 'FORECAST_AVAILABLE')) continue;
      if (!slots.every((slot) => slot.targetFeatureFingerprint === first.targetFeatureFingerprint && slot.regimeKey === first.regimeKey && slot.featureAsOf === first.featureAsOf && slot.rawPatternProbabilityPositive === first.rawPatternProbabilityPositive)) continue;
      const outcome = outcomes.get(`${capture.contentHash}|${first.companyId}|${first.horizon}`);
      if (!outcome || (outcome.positiveOutcome !== 0 && outcome.positiveOutcome !== 1)) continue;
      for (const slot of slots) {
        rows.push({
          groupKey,
          horizon: slot.horizon,
          regimeKey: slot.regimeKey,
          modelVariant: slot.modelVariant,
          companyId: slot.companyId,
          forecastAt: slot.featureAsOf,
          forecastDate: dateKey(slot.featureAsOf),
          probabilityPositive: slot.probabilityPositive,
          rawPatternProbabilityPositive: slot.rawPatternProbabilityPositive,
          positiveOutcome: outcome.positiveOutcome,
        });
      }
    }
  }
  return rows;
}

function chronologicalPerformanceBlocks(rows, blockCount, minimumBlockSample) {
  const dates = [...new Set(rows.map((row) => row.forecastDate).filter(Boolean))].sort();
  const blocks = [];
  for (let block = 0; block < blockCount; block += 1) {
    const startIndex = Math.floor((block * dates.length) / blockCount);
    const endIndex = Math.floor(((block + 1) * dates.length) / blockCount);
    const blockDates = new Set(dates.slice(startIndex, endIndex));
    const slice = rows.filter((row) => blockDates.has(row.forecastDate));
    const calibration = evaluateForecastCalibration(slice.map((row) => ({
      validationMode: 'LIVE_SHADOW_OOS',
      forecastAt: row.forecastAt,
      rawProbabilityPositive: row.probabilityPositive,
      positiveOutcome: row.positiveOutcome,
    })), { minimumTotal: minimumBlockSample, binCount: 10 });
    blocks.push({
      block: block + 1,
      startDate: dates[startIndex] || null,
      endDate: dates[Math.max(startIndex, endIndex - 1)] || null,
      sampleSize: slice.length,
      skillVsBaseRatePct: calibration.skillVsBaseRatePct,
      status: calibration.status,
    });
  }
  return blocks;
}

function evaluateGroupVariant(rows, protocol) {
  const thresholds = protocol.evaluationProtocol;
  const modelRecords = rows.map((row) => ({
    validationMode: 'LIVE_SHADOW_OOS',
    forecastAt: row.forecastAt,
    rawProbabilityPositive: row.probabilityPositive,
    positiveOutcome: row.positiveOutcome,
  }));
  const rawRecords = rows.map((row) => ({
    validationMode: 'LIVE_SHADOW_OOS',
    forecastAt: row.forecastAt,
    rawProbabilityPositive: row.rawPatternProbabilityPositive,
    positiveOutcome: row.positiveOutcome,
  }));
  const model = evaluateForecastCalibration(modelRecords, { minimumTotal: thresholds.minimumEvaluationSamplePerGroup, binCount: 10 });
  const raw = evaluateForecastCalibration(rawRecords, { minimumTotal: thresholds.minimumEvaluationSamplePerGroup, binCount: 10 });
  const positiveCount = rows.filter((row) => row.positiveOutcome === 1).length;
  const negativeCount = rows.filter((row) => row.positiveOutcome === 0).length;
  const brierImprovementPctVsRawPattern = Number(raw.brierScore) > 0 && Number.isFinite(Number(model.brierScore))
    ? ((Number(raw.brierScore) - Number(model.brierScore)) / Number(raw.brierScore)) * 100
    : null;
  const logLossImprovementPctVsRawPattern = Number(raw.logLoss) > 0 && Number.isFinite(Number(model.logLoss))
    ? ((Number(raw.logLoss) - Number(model.logLoss)) / Number(raw.logLoss)) * 100
    : null;
  const eceImprovementVsRawPattern = Number.isFinite(Number(raw.expectedCalibrationError)) && Number.isFinite(Number(model.expectedCalibrationError))
    ? Number(raw.expectedCalibrationError) - Number(model.expectedCalibrationError)
    : null;
  const chronologicalBlocks = chronologicalPerformanceBlocks(rows, thresholds.chronologicalBlockCount, thresholds.minimumChronologicalBlockSample);
  const blockers = [];
  if (model.status !== 'OOS_METRICS_READY' || model.sampleSize < thresholds.minimumEvaluationSamplePerGroup) blockers.push('POST_GATE_EVALUATION_SAMPLE_TOO_SMALL');
  if (Math.min(positiveCount, negativeCount) < thresholds.minimumClassCountPerGroup) blockers.push('POST_GATE_CLASS_COUNT_TOO_SMALL');
  if (!Number.isFinite(Number(model.skillVsBaseRatePct)) || Number(model.skillVsBaseRatePct) < thresholds.minimumSkillPctVsBaseRate) blockers.push('POST_GATE_PROBABILISTIC_SKILL_TOO_SMALL');
  if (!Number.isFinite(Number(model.expectedCalibrationError)) || Number(model.expectedCalibrationError) > thresholds.maximumExpectedCalibrationError) blockers.push('POST_GATE_CALIBRATION_ERROR_TOO_HIGH');
  if (!Number.isFinite(brierImprovementPctVsRawPattern) || brierImprovementPctVsRawPattern < thresholds.minimumBrierImprovementPctVsRawPattern) blockers.push('POST_GATE_BRIER_IMPROVEMENT_TOO_SMALL');
  if (!Number.isFinite(logLossImprovementPctVsRawPattern) || logLossImprovementPctVsRawPattern < thresholds.minimumLogLossImprovementPctVsRawPattern) blockers.push('POST_GATE_LOGLOSS_IMPROVEMENT_TOO_SMALL');
  if (!Number.isFinite(eceImprovementVsRawPattern) || eceImprovementVsRawPattern < thresholds.minimumEceImprovementVsRawPattern) blockers.push('POST_GATE_ECE_REGRESSION_TOO_LARGE');
  if (chronologicalBlocks.length !== thresholds.chronologicalBlockCount || chronologicalBlocks.some((block) => block.sampleSize < thresholds.minimumChronologicalBlockSample || !Number.isFinite(Number(block.skillVsBaseRatePct)) || Number(block.skillVsBaseRatePct) < thresholds.chronologicalBlockSkillFloorPct)) blockers.push('POST_GATE_CHRONOLOGICAL_SKILL_NOT_STABLE');
  return {
    status: blockers.length ? 'PREDICTIVE_STANDARD_NOT_MET' : 'PREDICTIVE_STANDARD_MET_ON_EXPLORATORY_HOLDOUT',
    predictiveStandardMet: blockers.length === 0,
    sampleSize: rows.length,
    positiveCount,
    negativeCount,
    modelMetrics: {
      brierScore: model.brierScore,
      logLoss: model.logLoss,
      expectedCalibrationError: model.expectedCalibrationError,
      baseRate: model.baseRate,
      naiveBrierScore: model.naiveBrierScore,
      skillVsBaseRatePct: model.skillVsBaseRatePct,
    },
    rawPatternMetrics: {
      brierScore: raw.brierScore,
      logLoss: raw.logLoss,
      expectedCalibrationError: raw.expectedCalibrationError,
    },
    improvementsVsRawPattern: {
      brierImprovementPct: round(brierImprovementPctVsRawPattern),
      logLossImprovementPct: round(logLossImprovementPctVsRawPattern),
      eceImprovement: round(eceImprovementVsRawPattern),
    },
    chronologicalBlocks,
    performanceThresholds: {
      minimumEvaluationSamplePerGroup: thresholds.minimumEvaluationSamplePerGroup,
      minimumClassCountPerGroup: thresholds.minimumClassCountPerGroup,
      minimumSkillPctVsBaseRate: thresholds.minimumSkillPctVsBaseRate,
      maximumExpectedCalibrationError: thresholds.maximumExpectedCalibrationError,
      minimumBrierImprovementPctVsRawPattern: thresholds.minimumBrierImprovementPctVsRawPattern,
      minimumLogLossImprovementPctVsRawPattern: thresholds.minimumLogLossImprovementPctVsRawPattern,
      minimumEceImprovementVsRawPattern: thresholds.minimumEceImprovementVsRawPattern,
      chronologicalBlockCount: thresholds.chronologicalBlockCount,
      minimumChronologicalBlockSample: thresholds.minimumChronologicalBlockSample,
      chronologicalBlockSkillFloorPct: thresholds.chronologicalBlockSkillFloorPct,
    },
    blockers,
  };
}

export function buildV1839PostGatePerformanceEvaluation(input = {}) {
  const protocol = input.protocol || buildProspectiveHoldoutProtocolV2();
  const structuralGate = input.structuralGate || {};
  assertV1838StructuralGateSafe(structuralGate);
  if (structuralGate.performanceGateEligible !== true) return emptyLockedArtifact(input, protocol, structuralGate);
  const maturationArtifact = input.maturationArtifact || {};
  if (maturationArtifact?.contract !== 'PROSPECTIVE_HOLDOUT_V2_OUTCOME_MATURATION_V1' || maturationArtifact?.holdoutId !== protocol.holdoutId || maturationArtifact?.protocolContract !== protocol.contract) throw new Error('v1839 maturation lineage mismatch');
  const captures = Array.isArray(input.captures) ? input.captures : [];
  const rows = buildEvaluationRows(captures, maturationArtifact, structuralGate, protocol);
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.groupKey}|${row.modelVariant}`;
    const current = grouped.get(key) || { horizon: row.horizon, regimeKey: row.regimeKey, modelVariant: row.modelVariant, rows: [] };
    current.rows.push(row);
    grouped.set(key, current);
  }
  const evaluations = [...grouped.values()]
    .map((group) => ({
      horizon: group.horizon,
      regimeKey: group.regimeKey,
      modelVariant: group.modelVariant,
      ...evaluateGroupVariant(group.rows, protocol),
    }))
    .sort((a, b) => a.horizon.localeCompare(b.horizon) || a.regimeKey.localeCompare(b.regimeKey) || a.modelVariant.localeCompare(b.modelVariant));
  const predictiveStandardSignalCount = evaluations.filter((item) => item.predictiveStandardMet).length;
  const core = {
    format: 'investor-control-prospective-holdout-v2-post-gate-performance-evaluation',
    version: 1,
    policyVersion: V1839_PERFORMANCE_EVALUATION_VERSION,
    contract: V1839_PERFORMANCE_EVALUATION_CONTRACT,
    sourceCommit: input.sourceCommit || null,
    holdoutId: protocol.holdoutId,
    protocolContract: protocol.contract,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    structuralGateContract: structuralGate.contract,
    structuralGateContentHash: structuralGate.contentHash,
    structuralGateEligible: true,
    status: predictiveStandardSignalCount ? 'PREDICTIVE_SIGNAL_DETECTED_CONFIRMATION_REQUIRED' : 'NO_PREDICTIVE_STANDARD_SIGNAL_DETECTED',
    evaluationGateOpened: true,
    performanceMetricsIncluded: true,
    performancePeeked: true,
    evaluationCount: evaluations.length,
    evaluations,
    predictiveStandardSignalCount,
    anyPredictiveStandardSignalDetected: predictiveStandardSignalCount > 0,
    sameHoldoutVariantSelectionAllowed: false,
    postHocWinnerSelectionAllowed: false,
    confirmatoryHoldoutRequiredBeforeAnyVariantSelection: true,
    confirmatoryHoldoutRequiredBeforeAnyProductionPromotion: true,
    modelRankingPublished: false,
    rawForecastRecordsIncluded: false,
    rawOutcomeRecordsIncluded: false,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
    nextAllowedAction: predictiveStandardSignalCount
      ? 'PREREGISTER_SEPARATE_CONFIRMATORY_HOLDOUT_WITHOUT_SELECTING_A_WINNER_FROM_THIS_HOLDOUT'
      : 'CONTINUE_RESEARCH_WITHOUT_MODEL_PROMOTION_OR_THRESHOLD_WEAKENING',
  };
  return { ...core, contentHashAlgorithm: 'SHA256_CANONICAL_JSON', contentHash: sha256(core) };
}

export function assertV1839PerformanceEvaluationSafe(artifact = {}) {
  const blockers = [];
  if (artifact?.contract !== V1839_PERFORMANCE_EVALUATION_CONTRACT) blockers.push('V1839_CONTRACT_CHANGED');
  if (artifact?.sameHoldoutVariantSelectionAllowed !== false || artifact?.postHocWinnerSelectionAllowed !== false || artifact?.confirmatoryHoldoutRequiredBeforeAnyVariantSelection !== true) blockers.push('V1839_MULTIPLICITY_BOUNDARY_BROKEN');
  if (artifact?.automaticModelPromotionEnabled !== false || artifact?.probabilityCalibrationEnabled !== false || artifact?.decisionIntegrationEnabled !== false || artifact?.forecastMayInfluenceFinalAction !== false || artifact?.finalActionEligible !== false || artifact?.brokerExecutionEligible !== false || artifact?.decisionImpact !== 'NONE') blockers.push('V1839_AUTHORITY_BOUNDARY_BROKEN');
  if (artifact?.structuralGateEligible !== true && (artifact?.evaluationGateOpened !== false || artifact?.performanceMetricsIncluded !== false || artifact?.performancePeeked !== false || artifact?.evaluationCount !== 0)) blockers.push('V1839_PERFORMANCE_OPENED_BEFORE_STRUCTURAL_GATE');
  if (artifact?.structuralGateEligible === true && (artifact?.evaluationGateOpened !== true || artifact?.performanceMetricsIncluded !== true || artifact?.performancePeeked !== true)) blockers.push('V1839_POST_GATE_STATE_INCONSISTENT');
  if (artifact?.contentHashAlgorithm !== 'SHA256_CANONICAL_JSON' || !artifact?.contentHash) blockers.push('V1839_HASH_MISSING');
  const { contentHash: _hash, contentHashAlgorithm: _algorithm, ...core } = artifact || {};
  if (artifact?.contentHash !== sha256(core)) blockers.push('V1839_HASH_INVALID');
  const unique = [...new Set(blockers)];
  if (unique.length) throw new Error(`v1839 performance evaluation blocked: ${unique.join(',')}`);
  return true;
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1839-performance-evaluation.json');
  const captureDirectory = process.env.PROSPECTIVE_V2_CAPTURE_ARTIFACT_DIRECTORY || process.argv[3];
  const maturationPath = process.env.PROSPECTIVE_V2_MATURATION_ARTIFACT_PATH || process.argv[4];
  const structuralGatePath = process.env.PROSPECTIVE_V2_STRUCTURAL_GATE_ARTIFACT_PATH || process.argv[5];
  if (!captureDirectory || !maturationPath || !structuralGatePath) throw new Error('v1839 requires v2 capture directory, v1837 maturation artifact and v1838 structural gate artifact');
  const captures = await loadV2CapturesFromDirectory(path.resolve(process.cwd(), captureDirectory));
  const maturationArtifact = JSON.parse(await readFile(path.resolve(process.cwd(), maturationPath), 'utf8'));
  const structuralGate = JSON.parse(await readFile(path.resolve(process.cwd(), structuralGatePath), 'utf8'));
  const artifact = buildV1839PostGatePerformanceEvaluation({ captures, maturationArtifact, structuralGate, sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT || null });
  assertV1839PerformanceEvaluationSafe(artifact);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(`Wrote v1839 post-gate performance evaluation to ${outputPath}`);
  console.log(`Structural gate eligible: ${artifact.structuralGateEligible}`);
  console.log(`Performance metrics included: ${artifact.performanceMetricsIncluded}`);
  console.log(`Evaluation count: ${artifact.evaluationCount}; predictive-standard signals: ${artifact.predictiveStandardSignalCount}`);
  console.log(`Same-holdout winner selection allowed: ${artifact.sameHoldoutVariantSelectionAllowed}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) main().catch((error) => { console.error(error); process.exitCode = 1; });
