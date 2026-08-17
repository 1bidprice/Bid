import { createHash } from 'node:crypto';
import { buildProspectiveHoldoutProtocol } from './forecast-prospective-holdout-protocol.js';
import {
  PROSPECTIVE_TARGET_BUILDER_CONTRACT,
  PROSPECTIVE_TARGET_BUILDER_VERSION,
} from './forecast-prospective-target-builder.js';
import {
  PROSPECTIVE_FROZEN_STACK_BRIDGE_CONTRACT,
  PROSPECTIVE_FROZEN_STACK_MODEL_SOURCE_COMMIT,
} from './forecast-prospective-frozen-stack-bridge.js';

export const PROSPECTIVE_HOLDOUT_PROTOCOL_V2_CONTRACT = 'PROSPECTIVE_UNSEEN_HOLDOUT_PROTOCOL_V2';
export const PROSPECTIVE_HOLDOUT_PROTOCOL_V2_VERSION = '2026-08-17.2';
export const PROSPECTIVE_HOLDOUT_V2_ID = 'investor-control-us-equity-unseen-holdout-2026q3-v2';
export const PROSPECTIVE_HOLDOUT_V2_CAPTURE_CONTRACT = 'PROSPECTIVE_UNSEEN_HOLDOUT_CAPTURE_V2';

const RETIRED_V1 = Object.freeze({
  holdoutId: 'investor-control-us-equity-unseen-holdout-2026q3-v1',
  firstCaptureHash: '73325cb66a5ee3fb0a403d696da57b1b144918ac1d8d08ae1dea43f71e65c6a2',
  outcomeMaturationProofSourceCommit: '0d41f9709ba1b378bd07ff4e2303332cff7dfa1d',
  outcomeMaturationProofContract: 'PROSPECTIVE_HOLDOUT_OUTCOME_MATURATION_V1',
  maturedOutcomeCountAtRetirement: 0,
  pendingOutcomeCountAtRetirement: 32,
  performancePeekedAtRetirement: false,
  evaluationGateOpenedAtRetirement: false,
  retirementReason: 'CAPTURE_SCHEMA_LACKED_IMMUTABLE_RAW_PATTERN_BASELINE_AND_REGIME_KEY_REQUIRED_FOR_PREDECLARED_EVALUATION',
});

const FORBIDDEN_OUTCOME_KEYS = new Set([
  'positiveOutcome', 'outcomeKnownAt', 'realizedOutcome', 'realisedOutcome',
  'realizedReturnPct', 'realisedReturnPct', 'benchmarkReturnPct',
  'benchmarkRelativeReturnPct', 'brierScore', 'logLoss', 'skillVsBaseRatePct',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function finiteProbability(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function iso(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function forbiddenPaths(value, path = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => forbiddenPaths(item, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, item] of Object.entries(value)) {
    const child = `${path}.${key}`;
    if (FORBIDDEN_OUTCOME_KEYS.has(key)) found.push(child);
    forbiddenPaths(item, child, found);
  }
  return found;
}

export function prospectiveTargetFeatureFingerprint(slot = {}) {
  return sha256({
    forecastId: slot.forecastId || null,
    companyId: slot.companyId || null,
    symbol: slot.symbol || null,
    horizon: slot.horizon || null,
    tradingDays: Number(slot.tradingDays || 0),
    featureAsOf: slot.featureAsOf || null,
    rawPatternProbabilityPositive: slot.rawPatternProbabilityPositive ?? null,
    regimeKey: slot.regimeKey || null,
    historicalPatternPolicyVersion: slot.historicalPatternPolicyVersion || null,
    historicalMarketFactorPolicyVersion: slot.historicalMarketFactorPolicyVersion || null,
    historicalMarketFactorScore: slot.historicalMarketFactorScore ?? null,
  });
}

export function buildProspectiveHoldoutProtocolV2() {
  const v1 = buildProspectiveHoldoutProtocol();
  return {
    ...v1,
    policyVersion: PROSPECTIVE_HOLDOUT_PROTOCOL_V2_VERSION,
    contract: PROSPECTIVE_HOLDOUT_PROTOCOL_V2_CONTRACT,
    holdoutId: PROSPECTIVE_HOLDOUT_V2_ID,
    status: 'PREREGISTERED_NOT_YET_STARTED',
    supersession: {
      supersedesProtocolContract: v1.contract,
      ...RETIRED_V1,
      v1MayContributeToV2PerformanceEvaluation: false,
      v1MayBeRetainedForAuditOnly: true,
      supersessionOccurredBeforeAnyMaturedOutcome: true,
      supersessionOccurredBeforeAnyPerformancePeek: true,
    },
    modelFreeze: {
      ...v1.modelFreeze,
      sourceCommit: PROSPECTIVE_FROZEN_STACK_MODEL_SOURCE_COMMIT,
      bridgeContract: PROSPECTIVE_FROZEN_STACK_BRIDGE_CONTRACT,
      targetBuilderContract: PROSPECTIVE_TARGET_BUILDER_CONTRACT,
      targetBuilderVersion: PROSPECTIVE_TARGET_BUILDER_VERSION,
      modelSpecificationChangedFromV1: false,
      onlyCaptureAuditSchemaChangedFromV1: true,
    },
    captureProtocol: {
      ...v1.captureProtocol,
      captureContract: PROSPECTIVE_HOLDOUT_V2_CAPTURE_CONTRACT,
      evaluationLineageCompleteAtCaptureRequired: true,
      requiredEvaluationLineageFields: [
        'forecastId',
        'featureAsOf',
        'rawPatternProbabilityPositive',
        'regimeKey',
        'historicalPatternPolicyVersion',
        'historicalMarketFactorPolicyVersion',
        'historicalMarketFactorScore',
        'targetFeatureFingerprint',
      ],
      targetFeatureFingerprintAlgorithm: 'SHA256_CANONICAL_JSON',
      sameTargetFeaturesRequiredAcrossAllFourVariants: true,
      currentIntradayQuoteMayInfluenceTargetFeatures: false,
      latestCompletedDailySessionOnly: true,
    },
    evaluationProtocol: {
      ...v1.evaluationProtocol,
      rawPatternBaselineMustBeCapturedBeforeOutcome: true,
      regimeKeyMustBeCapturedBeforeOutcome: true,
      reconstructedBaselineAfterOutcomeAllowed: false,
      reconstructedRegimeAfterOutcomeAllowed: false,
      v1PilotDataEligibleForPerformanceEvaluation: false,
    },
  };
}

export function protocolV2Fingerprint(protocol = buildProspectiveHoldoutProtocolV2()) {
  return sha256(protocol);
}

export function buildProspectiveHoldoutCaptureV2(input = {}) {
  const protocol = input.protocol || buildProspectiveHoldoutProtocolV2();
  const captureCore = {
    format: 'investor-control-prospective-unseen-holdout-capture-v2',
    version: 2,
    captureContract: PROSPECTIVE_HOLDOUT_V2_CAPTURE_CONTRACT,
    protocolContract: protocol.contract,
    protocolVersion: protocol.policyVersion,
    holdoutId: protocol.holdoutId,
    modelFreezeSourceCommit: protocol.modelFreeze.sourceCommit,
    capturedAt: iso(input.capturedAt),
    sourceDataAsOf: iso(input.sourceDataAsOf),
    previousCaptureHash: input.previousCaptureHash || null,
    slots: Array.isArray(input.slots) ? input.slots.map((slot) => ({ ...slot })) : [],
    prospectiveResearchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
  return {
    ...captureCore,
    contentHashAlgorithm: 'SHA256_CANONICAL_JSON',
    contentHash: sha256(captureCore),
  };
}

export function verifyProspectiveHoldoutCaptureV2(capture = {}, protocol = buildProspectiveHoldoutProtocolV2()) {
  const blockers = [];
  if (capture?.captureContract !== PROSPECTIVE_HOLDOUT_V2_CAPTURE_CONTRACT) blockers.push('V2_CAPTURE_CONTRACT_MISMATCH');
  if (capture?.protocolContract !== protocol.contract || capture?.protocolVersion !== protocol.policyVersion || capture?.holdoutId !== protocol.holdoutId) blockers.push('V2_CAPTURE_PROTOCOL_LINEAGE_MISMATCH');
  if (capture?.modelFreezeSourceCommit !== protocol.modelFreeze.sourceCommit) blockers.push('V2_CAPTURE_MODEL_FREEZE_MISMATCH');
  const capturedAt = iso(capture?.capturedAt);
  const sourceDataAsOf = iso(capture?.sourceDataAsOf);
  if (!capturedAt || !sourceDataAsOf) blockers.push('V2_CAPTURE_TIMESTAMP_INVALID');
  if (capturedAt && sourceDataAsOf && Date.parse(sourceDataAsOf) > Date.parse(capturedAt)) blockers.push('V2_CAPTURE_SOURCE_DATA_FROM_FUTURE');
  if (capture?.contentHashAlgorithm !== 'SHA256_CANONICAL_JSON') blockers.push('V2_CAPTURE_HASH_ALGORITHM_CHANGED');
  const { contentHash: _hash, contentHashAlgorithm: _algorithm, ...core } = capture || {};
  if (capture?.contentHash !== sha256(core)) blockers.push('V2_CAPTURE_CONTENT_HASH_INVALID');
  if (forbiddenPaths(capture?.slots || []).length) blockers.push('V2_CAPTURE_CONTAINS_OUTCOME_OR_PERFORMANCE_FIELDS');

  const expected = new Set();
  for (const instrument of protocol.universeFreeze.instruments) {
    for (const horizon of protocol.horizons) {
      for (const modelVariant of protocol.modelFreeze.modelVariants) {
        expected.add(`${instrument.companyId}|${horizon.horizon}|${modelVariant}`);
      }
    }
  }
  const seen = new Set();
  const featureFingerprintsByTarget = new Map();
  const slots = Array.isArray(capture?.slots) ? capture.slots : [];
  for (const slot of slots) {
    const key = `${slot?.companyId || ''}|${slot?.horizon || ''}|${slot?.modelVariant || ''}`;
    const targetKey = `${slot?.companyId || ''}|${slot?.horizon || ''}`;
    if (!expected.has(key)) blockers.push('V2_CAPTURE_UNKNOWN_SLOT');
    if (seen.has(key)) blockers.push('V2_CAPTURE_DUPLICATE_SLOT');
    seen.add(key);
    const instrument = protocol.universeFreeze.instruments.find((item) => item.companyId === slot?.companyId);
    const horizon = protocol.horizons.find((item) => item.horizon === slot?.horizon);
    if (!instrument || slot?.symbol !== instrument.symbol || !horizon || Number(slot?.tradingDays) !== horizon.tradingDays) blockers.push('V2_CAPTURE_SLOT_LINEAGE_MISMATCH');
    if (!['FORECAST_AVAILABLE', 'WITHHELD'].includes(slot?.status)) blockers.push('V2_CAPTURE_SLOT_STATUS_INVALID');
    if (slot?.status === 'FORECAST_AVAILABLE' && !finiteProbability(slot?.probabilityPositive)) blockers.push('V2_CAPTURE_PROBABILITY_INVALID');
    if (slot?.status === 'WITHHELD' && slot?.probabilityPositive !== null && slot?.probabilityPositive !== undefined) blockers.push('V2_CAPTURE_WITHHELD_SLOT_HAS_PROBABILITY');
    if (!finiteProbability(slot?.rawPatternProbabilityPositive)) blockers.push('V2_CAPTURE_RAW_PATTERN_BASELINE_MISSING');
    if (typeof slot?.regimeKey !== 'string' || !slot.regimeKey.trim()) blockers.push('V2_CAPTURE_REGIME_KEY_MISSING');
    if (typeof slot?.forecastId !== 'string' || !slot.forecastId.trim()) blockers.push('V2_CAPTURE_FORECAST_ID_MISSING');
    const featureAsOf = iso(slot?.featureAsOf);
    if (!featureAsOf || (capturedAt && Date.parse(featureAsOf) > Date.parse(capturedAt))) blockers.push('V2_CAPTURE_FEATURE_ASOF_INVALID');
    if (typeof slot?.historicalPatternPolicyVersion !== 'string' || !slot.historicalPatternPolicyVersion.trim()) blockers.push('V2_CAPTURE_PATTERN_POLICY_VERSION_MISSING');
    if (typeof slot?.historicalMarketFactorPolicyVersion !== 'string' || !slot.historicalMarketFactorPolicyVersion.trim()) blockers.push('V2_CAPTURE_MARKET_FACTOR_POLICY_VERSION_MISSING');
    if (!finiteNumber(slot?.historicalMarketFactorScore)) blockers.push('V2_CAPTURE_MARKET_FACTOR_SCORE_MISSING');
    const expectedFingerprint = prospectiveTargetFeatureFingerprint(slot);
    if (slot?.targetFeatureFingerprint !== expectedFingerprint) blockers.push('V2_CAPTURE_TARGET_FEATURE_FINGERPRINT_INVALID');
    const priorFingerprint = featureFingerprintsByTarget.get(targetKey);
    if (priorFingerprint && priorFingerprint !== slot?.targetFeatureFingerprint) blockers.push('V2_CAPTURE_VARIANTS_DO_NOT_SHARE_IDENTICAL_TARGET_FEATURES');
    featureFingerprintsByTarget.set(targetKey, slot?.targetFeatureFingerprint);
  }
  if (slots.length !== protocol.captureProtocol.expectedSlotCountPerCapture || seen.size !== expected.size || [...expected].some((key) => !seen.has(key))) blockers.push('V2_CAPTURE_SLOT_MATRIX_INCOMPLETE');
  if (featureFingerprintsByTarget.size !== protocol.universeFreeze.instrumentCount * protocol.horizons.length) blockers.push('V2_CAPTURE_TARGET_FEATURE_MATRIX_INCOMPLETE');
  if (capture?.prospectiveResearchOnly !== true
      || capture?.automaticModelPromotionEnabled !== false
      || capture?.probabilityCalibrationEnabled !== false
      || capture?.decisionIntegrationEnabled !== false
      || capture?.forecastMayInfluenceFinalAction !== false
      || capture?.finalActionEligible !== false
      || capture?.brokerExecutionEligible !== false
      || capture?.decisionImpact !== 'NONE') blockers.push('V2_CAPTURE_AUTHORITY_BOUNDARY_BROKEN');

  const unique = [...new Set(blockers)];
  return {
    contract: 'PROSPECTIVE_UNSEEN_HOLDOUT_CAPTURE_V2_VERIFICATION_V1',
    status: unique.length ? 'PROSPECTIVE_V2_CAPTURE_REJECTED' : 'PROSPECTIVE_V2_CAPTURE_VERIFIED',
    verified: unique.length === 0,
    expectedSlotCount: protocol.captureProtocol.expectedSlotCountPerCapture,
    actualSlotCount: slots.length,
    targetFeatureFingerprintCount: featureFingerprintsByTarget.size,
    blockers: unique,
    prospectiveResearchOnly: true,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}
