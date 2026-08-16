export const HISTORICAL_MARKET_EXISTING_STACK_FALSIFICATION_CONTRACT = 'HISTORICAL_MARKET_EXISTING_STACK_FALSIFICATION_V1';
export const HISTORICAL_MARKET_EXISTING_STACK_FALSIFICATION_VERSION = '2026-08-16.1';

const VARIANTS = Object.freeze([
  ['SCALAR_MARKET_FACTOR', (stack) => stack],
  ['DOMAIN_SEPARATED_MARKET_FACTOR', (stack) => stack?.domainSeparatedCandidate],
  ['PRIOR_SHRUNK_SCALAR_MARKET_FACTOR', (stack) => stack?.priorShrunkCandidate],
  ['ADAPTIVE_PRIOR_SHRUNK_SCALAR_MARKET_FACTOR', (stack) => stack?.adaptivePriorShrunkCandidate],
]);

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function groupKey(group = {}) {
  return [
    group.historicalPatternPolicyVersion || 'NO_PATTERN_VERSION',
    group.historicalMarketFactorPolicyVersion || 'NO_MARKET_FACTOR_VERSION',
    group.assetClass || 'UNKNOWN',
    group.horizon || 'UNKNOWN',
    group.regimeKey || 'NO_REGIME',
  ].join('|');
}

function sameMetric(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return left === right;
  return Math.abs(Number(left) - Number(right)) <= 1e-9;
}

function chronologicalPass(group = {}) {
  const blocks = Array.isArray(group?.chronologicalStability?.blocks) ? group.chronologicalStability.blocks : [];
  const expected = Number(group?.thresholds?.chronologicalBlockCount || 3);
  const minimumBlockSample = Number(group?.thresholds?.minimumChronologicalBlockSample || 20);
  if (blocks.length !== expected) return false;
  return blocks.every((block) => (
    Number(block?.sampleSize || 0) >= minimumBlockSample
    && finite(block?.ensembleSkillVsBaseRatePct) !== null
    && block.ensembleSkillVsBaseRatePct >= 0
    && finite(block?.brierImprovementVsRawPatternPct) !== null
    && block.brierImprovementVsRawPatternPct >= 0
    && finite(block?.logLossImprovementVsRawPatternPct) !== null
    && block.logLossImprovementVsRawPatternPct >= 0
  ));
}

function strictSignalPass(group = {}) {
  const thresholds = group?.thresholds || {};
  const metrics = group?.ensembleMetrics || {};
  return Number(group?.sampleSize || 0) >= Number(thresholds.minimumEvaluationSample || 200)
    && Number(group?.positiveCount || 0) >= Number(thresholds.minimumClassCount || 40)
    && Number(group?.negativeCount || 0) >= Number(thresholds.minimumClassCount || 40)
    && finite(metrics.skillVsBaseRatePct) !== null
    && metrics.skillVsBaseRatePct >= Number(thresholds.minimumSkillPct || 5)
    && finite(metrics.expectedCalibrationError) !== null
    && metrics.expectedCalibrationError <= Number(thresholds.maximumEce || 0.08)
    && finite(group?.brierImprovementVsRawPatternPct) !== null
    && group.brierImprovementVsRawPatternPct >= Number(thresholds.minimumBrierImprovementPct || 3)
    && finite(group?.logLossImprovementVsRawPatternPct) !== null
    && group.logLossImprovementVsRawPatternPct >= Number(thresholds.minimumLogLossImprovementPct || 0)
    && chronologicalPass(group);
}

function variantSummary(name, candidate = {}) {
  const groups = Array.isArray(candidate?.groups) ? candidate.groups : [];
  const minimumSample = 200;
  let sampleWeight = 0;
  let weightedSkill = 0;
  let weightedBrierImprovement = 0;
  const evaluable = groups.filter((group) => Number(group?.sampleSize || 0) >= minimumSample);
  for (const group of evaluable) {
    const n = Number(group.sampleSize || 0);
    const skill = finite(group?.ensembleMetrics?.skillVsBaseRatePct);
    const brierImprovement = finite(group?.brierImprovementVsRawPatternPct);
    if (skill !== null) {
      sampleWeight += n;
      weightedSkill += skill * n;
      if (brierImprovement !== null) weightedBrierImprovement += brierImprovement * n;
    }
  }
  return {
    modelVariant: name,
    sourceStatus: candidate?.status || null,
    sourcePredictionCount: Number(candidate?.predictionCount || 0),
    groupCount: groups.length,
    evaluableGroupCount: evaluable.length,
    positiveSkillGroupCount: evaluable.filter((group) => finite(group?.ensembleMetrics?.skillVsBaseRatePct) !== null && group.ensembleMetrics.skillVsBaseRatePct > 0).length,
    promotionSkillGroupCount: evaluable.filter((group) => finite(group?.ensembleMetrics?.skillVsBaseRatePct) !== null && group.ensembleMetrics.skillVsBaseRatePct >= Number(group?.thresholds?.minimumSkillPct || 5)).length,
    calibratedGroupCount: evaluable.filter((group) => finite(group?.ensembleMetrics?.expectedCalibrationError) !== null && group.ensembleMetrics.expectedCalibrationError <= Number(group?.thresholds?.maximumEce || 0.08)).length,
    rawBrierImprovedGroupCount: evaluable.filter((group) => finite(group?.brierImprovementVsRawPatternPct) !== null && group.brierImprovementVsRawPatternPct >= Number(group?.thresholds?.minimumBrierImprovementPct || 3)).length,
    chronologicalNonRegressingGroupCount: evaluable.filter(chronologicalPass).length,
    strictSignalGroupCount: evaluable.filter(strictSignalPass).length,
    sampleWeightedSkillVsBaseRatePct: sampleWeight ? round(weightedSkill / sampleWeight, 4) : null,
    sampleWeightedBrierImprovementVsRawPatternPct: sampleWeight ? round(weightedBrierImprovement / sampleWeight, 4) : null,
    winnerSelectionAllowed: false,
    sameDatasetPromotionAllowed: false,
    automaticModelPromotionEnabled: false,
    decisionImpact: 'NONE',
  };
}

function compactGroupComparison(reference, variantGroups) {
  return {
    historicalPatternPolicyVersion: reference.historicalPatternPolicyVersion || null,
    historicalMarketFactorPolicyVersion: reference.historicalMarketFactorPolicyVersion || null,
    assetClass: reference.assetClass || 'UNKNOWN',
    horizon: reference.horizon || null,
    regimeKey: reference.regimeKey || null,
    sampleSize: Number(reference.sampleSize || 0),
    positiveCount: Number(reference.positiveCount || 0),
    negativeCount: Number(reference.negativeCount || 0),
    rawPatternMetrics: {
      brierScore: reference?.baselinePatternMetrics?.brierScore ?? null,
      logLoss: reference?.baselinePatternMetrics?.logLoss ?? null,
      expectedCalibrationError: reference?.baselinePatternMetrics?.expectedCalibrationError ?? null,
      skillVsBaseRatePct: reference?.baselinePatternMetrics?.skillVsBaseRatePct ?? null,
      baseRate: reference?.baselinePatternMetrics?.baseRate ?? null,
    },
    variants: variantGroups.map(([name, group]) => ({
      modelVariant: name,
      ensembleMetrics: {
        brierScore: group?.ensembleMetrics?.brierScore ?? null,
        logLoss: group?.ensembleMetrics?.logLoss ?? null,
        expectedCalibrationError: group?.ensembleMetrics?.expectedCalibrationError ?? null,
        skillVsBaseRatePct: group?.ensembleMetrics?.skillVsBaseRatePct ?? null,
        baseRate: group?.ensembleMetrics?.baseRate ?? null,
      },
      brierImprovementVsRawPatternPct: group?.brierImprovementVsRawPatternPct ?? null,
      logLossImprovementVsRawPatternPct: group?.logLossImprovementVsRawPatternPct ?? null,
      chronologicalBlockSkillVsBaseRatePct: (group?.chronologicalStability?.blocks || []).map((block) => block?.ensembleSkillVsBaseRatePct ?? null),
      strictSignalPass: strictSignalPass(group),
    })),
  };
}

export function buildHistoricalMarketExistingStackFalsification(stackResearch = {}) {
  const blockers = [];
  const candidateEntries = VARIANTS.map(([name, pick]) => [name, pick(stackResearch)]);
  for (const [name, candidate] of candidateEntries) {
    if (!candidate || !Array.isArray(candidate.groups)) blockers.push(`MODEL_VARIANT_MISSING:${name}`);
    if (candidate?.automaticModelPromotionEnabled !== false || candidate?.decisionImpact !== 'NONE') blockers.push(`MODEL_VARIANT_AUTHORITY_CHANGED:${name}`);
  }

  const maps = candidateEntries.map(([name, candidate]) => [
    name,
    new Map((candidate?.groups || []).map((group) => [groupKey(group), group])),
  ]);
  const referenceGroups = Array.isArray(stackResearch?.groups) ? stackResearch.groups : [];
  const comparisons = [];

  for (const reference of referenceGroups) {
    const key = groupKey(reference);
    const variantGroups = maps.map(([name, map]) => [name, map.get(key)]);
    if (variantGroups.some(([, group]) => !group)) {
      blockers.push(`MODEL_VARIANT_GROUP_LINEAGE_MISSING:${key}`);
      continue;
    }
    for (const [name, group] of variantGroups) {
      if (Number(group.sampleSize || 0) !== Number(reference.sampleSize || 0)
          || Number(group.positiveCount || 0) !== Number(reference.positiveCount || 0)
          || Number(group.negativeCount || 0) !== Number(reference.negativeCount || 0)) {
        blockers.push(`MODEL_VARIANT_SAMPLE_MISMATCH:${name}:${key}`);
      }
      const base = reference.baselinePatternMetrics || {};
      const candidateBase = group.baselinePatternMetrics || {};
      for (const metric of ['brierScore', 'logLoss', 'expectedCalibrationError', 'skillVsBaseRatePct', 'baseRate']) {
        if (!sameMetric(base[metric], candidateBase[metric])) blockers.push(`MODEL_VARIANT_BASELINE_MISMATCH:${name}:${key}:${metric}`);
      }
    }
    comparisons.push(compactGroupComparison(reference, variantGroups));
  }

  const summaries = candidateEntries.map(([name, candidate]) => variantSummary(name, candidate));
  const strictSignalVariantCount = summaries.filter((summary) => summary.strictSignalGroupCount > 0).length;
  const uniqueBlockers = [...new Set(blockers)];
  const lineageVerified = uniqueBlockers.length === 0;

  return {
    format: 'investor-control-historical-market-existing-stack-falsification',
    version: 1,
    policyVersion: HISTORICAL_MARKET_EXISTING_STACK_FALSIFICATION_VERSION,
    contract: HISTORICAL_MARKET_EXISTING_STACK_FALSIFICATION_CONTRACT,
    status: lineageVerified
      ? (strictSignalVariantCount > 0 ? 'EXISTING_STACK_SIGNAL_REQUIRES_NEW_UNSEEN_HOLDOUT' : 'NO_EXISTING_STACK_VARIANT_MEETS_PREDECLARED_PREDICTIVE_STANDARD')
      : 'EXISTING_STACK_FALSIFICATION_INTEGRITY_BLOCKED',
    lineageVerified,
    sourceRecordCount: Number(stackResearch?.sourceRecordCount || 0),
    sourcePredictionCount: Number(stackResearch?.predictionCount || 0),
    groupCount: referenceGroups.length,
    variantCount: summaries.length,
    strictSignalVariantCount,
    variantSummaries: summaries,
    groupComparisons: comparisons,
    blockers: uniqueBlockers,
    interpretationRule: 'FAILURE_TO_MEET_THE_PREDECLARED_STANDARD_IS_RECORDED_AS_MODEL_EVIDENCE_AND_MUST_NOT_BE_REPAIRED_BY_LOWERING_THRESHOLDS',
    postHocSelectionGuard: 'NO_MODEL_VARIANT_MAY_BE_SELECTED_OR_PROMOTED_FROM_THIS_COMPARISON_ON_THE_SAME_HISTORICAL_DATASET',
    nextValidationRule: 'ANY_MODEL_DIRECTION_IDENTIFIED_HERE_REQUIRES_A_NEW_UNSEEN_PROSPECTIVE_OR_PREDECLARED_HOLDOUT_BEFORE_PROMOTION',
    rawPredictionsIncluded: false,
    rawHistoricalRecordsIncluded: false,
    rawHistoricalCandlesIncluded: false,
    diagnosticOnly: true,
    winnerSelectionAllowed: false,
    sameDatasetModelSelectionAllowed: false,
    sameDatasetPromotionAllowed: false,
    taxonomyPromotionEligible: false,
    historicalResearchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}
