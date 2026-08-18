import { createHash } from 'node:crypto';
import {
  HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_CONTRACT,
  HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_VERSION,
  buildHistoricalResearchValidationUniverse,
} from './historical-research-validation-universe.js';

export const PROSPECTIVE_HOLDOUT_PROTOCOL_CONTRACT = 'PROSPECTIVE_UNSEEN_HOLDOUT_PROTOCOL_V1';
export const PROSPECTIVE_HOLDOUT_PROTOCOL_VERSION = '2026-08-16.1';
export const PROSPECTIVE_HOLDOUT_MODEL_FREEZE_SOURCE_COMMIT = '0e13074f1e8d89c5f52f3825c07203f0e62f20a8';
export const PROSPECTIVE_HOLDOUT_ID = 'investor-control-us-equity-unseen-holdout-2026q3-v1';

export const PROSPECTIVE_HOLDOUT_MODEL_VARIANTS = Object.freeze([
  'SCALAR_MARKET_FACTOR',
  'DOMAIN_SEPARATED_MARKET_FACTOR',
  'PRIOR_SHRUNK_SCALAR_MARKET_FACTOR',
  'ADAPTIVE_PRIOR_SHRUNK_SCALAR_MARKET_FACTOR',
]);

export const PROSPECTIVE_HOLDOUT_HORIZONS = Object.freeze([
  Object.freeze({ horizon: 'week1', tradingDays: 5 }),
  Object.freeze({ horizon: 'month1', tradingDays: 21 }),
]);

const FORBIDDEN_OUTCOME_KEYS = new Set([
  'positiveOutcome',
  'realisedOutcome',
  'realizedOutcome',
  'realisedReturnPct',
  'realizedReturnPct',
  'outcomeKnownAt',
  'outcomeValue',
  'actualReturnPct',
  'directionalScore',
  'brierScore',
  'logLoss',
  'skillVsBaseRatePct',
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

function iso(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function forbiddenOutcomePaths(value, path = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => forbiddenOutcomePaths(item, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, item] of Object.entries(value)) {
    const child = `${path}.${key}`;
    if (FORBIDDEN_OUTCOME_KEYS.has(key)) found.push(child);
    forbiddenOutcomePaths(item, child, found);
  }
  return found;
}

function frozenInstrument(company = {}) {
  return {
    companyId: company.companyId || null,
    symbol: company.primaryListing?.symbol || null,
    mic: company.primaryListing?.mic || null,
    country: company.country || null,
    currency: company.currency || null,
    sector: company.sector || null,
  };
}

export function buildProspectiveHoldoutProtocol() {
  const universe = buildHistoricalResearchValidationUniverse().map(frozenInstrument);
  return {
    format: 'investor-control-prospective-unseen-holdout-protocol',
    version: 1,
    policyVersion: PROSPECTIVE_HOLDOUT_PROTOCOL_VERSION,
    contract: PROSPECTIVE_HOLDOUT_PROTOCOL_CONTRACT,
    holdoutId: PROSPECTIVE_HOLDOUT_ID,
    status: 'PREREGISTERED_NOT_YET_STARTED',
    preregistrationRule: 'HOLDOUT_STARTS_ONLY_WITH_FIRST_SUCCESSFUL_CAPTURE_CREATED_AFTER_THIS_PROTOCOL_EXISTS_ON_GITHUB_SOURCE_CONTROL',
    historicalBackfillAllowed: false,
    modelFreeze: {
      sourceCommit: PROSPECTIVE_HOLDOUT_MODEL_FREEZE_SOURCE_COMMIT,
      sourceProofContract: 'HISTORICAL_MARKET_EXISTING_STACK_FALSIFICATION_PROOF_V1',
      sourceProofVerdict: 'NO_EXISTING_STACK_VARIANT_MEETS_PREDECLARED_PREDICTIVE_STANDARD',
      modelVariants: [...PROSPECTIVE_HOLDOUT_MODEL_VARIANTS],
      refitRule: 'REFIT_ONLY_FROM_INFORMATION_AVAILABLE_STRICTLY_BEFORE_EACH_PROSPECTIVE_CAPTURE',
      specificationChangeAllowedInsideHoldout: false,
      variantRemovalAllowedInsideHoldout: false,
      postHocWinnerSelectionAllowed: false,
    },
    universeFreeze: {
      sourceContract: HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_CONTRACT,
      sourceVersion: HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_VERSION,
      marketDomain: 'US_EQUITY',
      benchmarkFamily: 'SPY',
      instrumentCount: universe.length,
      instruments: universe,
      currentNewsDependentSelection: false,
      eventDiscoveryAdditionsAllowed: false,
      broadOpportunityAdditionsAllowed: false,
      pointInTimeUniverseBiasControlled: false,
      limitation: 'SURVIVORSHIP_BIAS_REMAINS_A_HISTORICAL_LIMITATION_AND_BLOCKS_PRODUCTION_PROMOTION',
    },
    horizons: [...PROSPECTIVE_HOLDOUT_HORIZONS],
    captureProtocol: {
      expectedSlotCountPerCapture: universe.length * PROSPECTIVE_HOLDOUT_HORIZONS.length * PROSPECTIVE_HOLDOUT_MODEL_VARIANTS.length,
      requiredSlotPolicy: 'EXACTLY_ONE_SLOT_FOR_EVERY_FROZEN_INSTRUMENT_HORIZON_MODEL_VARIANT_TUPLE',
      missingForecastPolicy: 'WRITE_WITHHELD_SLOT_WITH_PREOUTCOME_BLOCKER_NEVER_DROP_THE_TUPLE',
      forecastStatuses: ['FORECAST_AVAILABLE', 'WITHHELD'],
      outcomeFieldsAllowedAtCapture: false,
      performanceMetricsAllowedAtCapture: false,
      capturedAtMustPrecedeOutcomeWindow: true,
      sourceDataAsOfMustNotExceedCapturedAt: true,
      immutableContentHashRequired: true,
      previousCaptureHashChainSupported: true,
      replacementOfExistingCaptureAllowed: false,
      deletionForPerformanceReasonsAllowed: false,
    },
    maturationProtocol: {
      scoreOnlyAfterHorizonMatures: true,
      verifyOriginalCaptureHashBeforeScoring: true,
      outcomeMutationOfCaptureForbidden: true,
      outcomesStoredSeparatelyFromCapture: true,
      benchmarkRelativeOutcomeRequired: true,
      benchmarkFamily: 'SPY',
    },
    evaluationProtocol: {
      performancePeekingBeforeGateAllowed: false,
      operationalCountsBeforeGateAllowed: true,
      minimumEvaluationSamplePerGroup: 200,
      minimumClassCountPerGroup: 40,
      minimumSkillPctVsBaseRate: 5,
      maximumExpectedCalibrationError: 0.08,
      minimumBrierImprovementPctVsRawPattern: 3,
      minimumLogLossImprovementPctVsRawPattern: 0,
      minimumEceImprovementVsRawPattern: -0.01,
      minimumDistinctForecastDates: 40,
      minimumDistinctInstruments: 10,
      maximumSingleForecastDateSharePct: 10,
      minimumEffectiveNonOverlappingWindows: 12,
      maximumSingleInstrumentSharePct: 25,
      minimumEffectiveInstrumentCount: 6,
      chronologicalBlockCount: 3,
      minimumChronologicalBlockSample: 20,
      chronologicalBlockSkillFloorPct: 0,
      multiplicityPolicy: 'NO_VARIANT_SELECTION_FROM_HOLDOUT_UNLESS_A_SEPARATE_PREDECLARED_CONFIRMATORY_HOLDOUT_IS_CREATED',
      earlyStoppingForPositivePerformanceAllowed: false,
      thresholdWeakeningAllowed: false,
    },
    publication: {
      captureArtifactOnly: true,
      rawCaptureMayBeStoredForAudit: true,
      performanceMetricsBeforeGate: false,
      finalActionWriteAllowed: false,
      liveFeedWriteAllowed: false,
      decisionHistoryWriteAllowed: false,
      brokerWriteAllowed: false,
      gitPushOfOutcomesAllowed: false,
    },
    historicalResearchOnly: false,
    prospectiveResearchOnly: true,
    taxonomyPromotionEligible: false,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

export function buildProspectiveHoldoutCapture(input = {}) {
  const protocol = input.protocol || buildProspectiveHoldoutProtocol();
  const capturedAt = iso(input.capturedAt);
  const sourceDataAsOf = iso(input.sourceDataAsOf);
  const slots = Array.isArray(input.slots) ? input.slots.map((slot) => ({ ...slot })) : [];
  const captureCore = {
    format: 'investor-control-prospective-unseen-holdout-capture',
    version: 1,
    protocolContract: protocol.contract,
    protocolVersion: protocol.policyVersion,
    holdoutId: protocol.holdoutId,
    modelFreezeSourceCommit: protocol.modelFreeze.sourceCommit,
    capturedAt,
    sourceDataAsOf,
    previousCaptureHash: input.previousCaptureHash || null,
    slots,
    prospectiveResearchOnly: true,
    automaticModelPromotionEnabled: false,
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

export function verifyProspectiveHoldoutCapture(capture = {}, protocol = buildProspectiveHoldoutProtocol()) {
  const blockers = [];
  if (capture?.protocolContract !== protocol.contract || capture?.protocolVersion !== protocol.policyVersion || capture?.holdoutId !== protocol.holdoutId) blockers.push('PROSPECTIVE_CAPTURE_PROTOCOL_LINEAGE_MISMATCH');
  if (capture?.modelFreezeSourceCommit !== protocol.modelFreeze.sourceCommit) blockers.push('PROSPECTIVE_CAPTURE_MODEL_FREEZE_MISMATCH');
  const capturedAt = iso(capture?.capturedAt);
  const sourceDataAsOf = iso(capture?.sourceDataAsOf);
  if (!capturedAt) blockers.push('PROSPECTIVE_CAPTURE_TIMESTAMP_INVALID');
  if (!sourceDataAsOf) blockers.push('PROSPECTIVE_CAPTURE_SOURCE_ASOF_INVALID');
  if (capturedAt && sourceDataAsOf && Date.parse(sourceDataAsOf) > Date.parse(capturedAt)) blockers.push('PROSPECTIVE_CAPTURE_SOURCE_DATA_FROM_FUTURE');
  if (capture?.contentHashAlgorithm !== 'SHA256_CANONICAL_JSON') blockers.push('PROSPECTIVE_CAPTURE_HASH_ALGORITHM_CHANGED');

  const { contentHash: _hash, contentHashAlgorithm: _algorithm, ...captureCore } = capture || {};
  const expectedHash = sha256(captureCore);
  if (capture?.contentHash !== expectedHash) blockers.push('PROSPECTIVE_CAPTURE_CONTENT_HASH_INVALID');

  const forbidden = forbiddenOutcomePaths(capture?.slots || []);
  if (forbidden.length) blockers.push('PROSPECTIVE_CAPTURE_CONTAINS_OUTCOME_OR_PERFORMANCE_FIELDS');

  const slots = Array.isArray(capture?.slots) ? capture.slots : [];
  const expected = new Set();
  for (const instrument of protocol.universeFreeze.instruments) {
    for (const horizon of protocol.horizons) {
      for (const modelVariant of protocol.modelFreeze.modelVariants) {
        expected.add(`${instrument.companyId}|${horizon.horizon}|${modelVariant}`);
      }
    }
  }
  const seen = new Set();
  for (const slot of slots) {
    const key = `${slot?.companyId || ''}|${slot?.horizon || ''}|${slot?.modelVariant || ''}`;
    if (!expected.has(key)) blockers.push('PROSPECTIVE_CAPTURE_UNKNOWN_SLOT');
    if (seen.has(key)) blockers.push('PROSPECTIVE_CAPTURE_DUPLICATE_SLOT');
    seen.add(key);
    const instrument = protocol.universeFreeze.instruments.find((item) => item.companyId === slot?.companyId);
    const horizon = protocol.horizons.find((item) => item.horizon === slot?.horizon);
    if (!instrument || slot?.symbol !== instrument.symbol || !horizon || Number(slot?.tradingDays) !== horizon.tradingDays) blockers.push('PROSPECTIVE_CAPTURE_SLOT_LINEAGE_MISMATCH');
    if (!['FORECAST_AVAILABLE', 'WITHHELD'].includes(slot?.status)) blockers.push('PROSPECTIVE_CAPTURE_SLOT_STATUS_INVALID');
    if (slot?.status === 'FORECAST_AVAILABLE') {
      if (!finiteProbability(slot?.probabilityPositive)) blockers.push('PROSPECTIVE_CAPTURE_PROBABILITY_INVALID');
      if (typeof slot?.withheldReason === 'string' && slot.withheldReason.trim()) blockers.push('PROSPECTIVE_CAPTURE_AVAILABLE_SLOT_HAS_WITHHELD_REASON');
    }
    if (slot?.status === 'WITHHELD') {
      if (slot?.probabilityPositive !== null && slot?.probabilityPositive !== undefined) blockers.push('PROSPECTIVE_CAPTURE_WITHHELD_SLOT_HAS_PROBABILITY');
      if (typeof slot?.withheldReason !== 'string' || !slot.withheldReason.trim()) blockers.push('PROSPECTIVE_CAPTURE_WITHHELD_REASON_REQUIRED');
    }
    const featureAsOf = iso(slot?.featureAsOf);
    if (!featureAsOf || (capturedAt && Date.parse(featureAsOf) > Date.parse(capturedAt))) blockers.push('PROSPECTIVE_CAPTURE_FEATURE_ASOF_INVALID');
  }
  if (slots.length !== protocol.captureProtocol.expectedSlotCountPerCapture || seen.size !== expected.size || [...expected].some((key) => !seen.has(key))) blockers.push('PROSPECTIVE_CAPTURE_SLOT_MATRIX_INCOMPLETE');

  if (capture?.prospectiveResearchOnly !== true
      || capture?.automaticModelPromotionEnabled !== false
      || capture?.decisionIntegrationEnabled !== false
      || capture?.forecastMayInfluenceFinalAction !== false
      || capture?.finalActionEligible !== false
      || capture?.brokerExecutionEligible !== false
      || capture?.decisionImpact !== 'NONE') blockers.push('PROSPECTIVE_CAPTURE_AUTHORITY_BOUNDARY_BROKEN');

  const uniqueBlockers = [...new Set(blockers)];
  return {
    contract: 'PROSPECTIVE_UNSEEN_HOLDOUT_CAPTURE_VERIFICATION_V1',
    status: uniqueBlockers.length ? 'PROSPECTIVE_CAPTURE_REJECTED' : 'PROSPECTIVE_CAPTURE_VERIFIED',
    verified: uniqueBlockers.length === 0,
    holdoutId: protocol.holdoutId,
    expectedSlotCount: protocol.captureProtocol.expectedSlotCountPerCapture,
    actualSlotCount: slots.length,
    forbiddenOutcomePathCount: forbidden.length,
    blockers: uniqueBlockers,
    prospectiveResearchOnly: true,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

export function protocolFingerprint(protocol = buildProspectiveHoldoutProtocol()) {
  return sha256(protocol);
}
