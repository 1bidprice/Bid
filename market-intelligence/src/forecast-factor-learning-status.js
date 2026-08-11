export const FORECAST_FACTOR_LEARNING_STATUS_VERSION = '2026-08-11.1';

const SCORE_BINS = Object.freeze([
  { lower: -1, upper: -0.6, includeUpper: false },
  { lower: -0.6, upper: -0.2, includeUpper: false },
  { lower: -0.2, upper: 0.2, includeUpper: false },
  { lower: 0.2, upper: 0.6, includeUpper: false },
  { lower: 0.6, upper: 1, includeUpper: true },
]);

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function mean(values = []) {
  const valid = values.map(finite).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function liveFactorLineage(records = []) {
  return (Array.isArray(records) ? records : []).filter((record) =>
    record?.validationMode === 'LIVE_SHADOW_OOS' &&
    typeof record?.factorScorePolicyVersion === 'string' &&
    record.factorScorePolicyVersion.trim().length > 0,
  );
}

function scoredRecord(record) {
  const score = finite(record?.latentFactorScore);
  return record?.factorScoreStatus === 'LATENT_SCORE_READY' && score !== null && score >= -1 && score <= 1;
}

function maturedScoredRecord(record) {
  return scoredRecord(record) &&
    record?.status === 'MATURED' &&
    [0, 1].includes(Number(record?.positiveOutcome));
}

function chronological(records = []) {
  return records.slice().sort((a, b) =>
    String(a.forecastAt || a.forecastSampleDate || '').localeCompare(String(b.forecastAt || b.forecastSampleDate || '')) ||
    String(a.forecastId || '').localeCompare(String(b.forecastId || '')),
  );
}

function groupKey(record = {}) {
  return `${record.factorScorePolicyVersion}|${record.assetClass || 'UNKNOWN'}|${record.horizon || 'UNKNOWN'}`;
}

function auc(records = []) {
  const valid = records
    .filter(maturedScoredRecord)
    .map((record) => ({ score: Number(record.latentFactorScore), outcome: Number(record.positiveOutcome) }))
    .sort((a, b) => a.score - b.score);
  const positiveCount = valid.filter((item) => item.outcome === 1).length;
  const negativeCount = valid.length - positiveCount;
  if (!positiveCount || !negativeCount) return null;

  let positiveRankSum = 0;
  let index = 0;
  while (index < valid.length) {
    let end = index + 1;
    while (end < valid.length && valid[end].score === valid[index].score) end += 1;
    const averageRank = ((index + 1) + end) / 2;
    for (let cursor = index; cursor < end; cursor += 1) {
      if (valid[cursor].outcome === 1) positiveRankSum += averageRank;
    }
    index = end;
  }
  return (positiveRankSum - positiveCount * (positiveCount + 1) / 2) / (positiveCount * negativeCount);
}

function tailSpread(records = [], options = {}) {
  const sorted = records.filter(maturedScoredRecord).slice().sort((a, b) => Number(a.latentFactorScore) - Number(b.latentFactorScore));
  if (!sorted.length) {
    return {
      tailSampleSize: 0,
      topPositiveRate: null,
      bottomPositiveRate: null,
      positiveRateSpread: null,
      topMeanRealisedReturnPct: null,
      bottomMeanRealisedReturnPct: null,
      realisedReturnSpreadPct: null,
    };
  }
  const fraction = Math.max(0.1, Math.min(0.4, Number(options.tailFraction || 0.25)));
  const tailSampleSize = Math.max(1, Math.floor(sorted.length * fraction));
  const bottom = sorted.slice(0, tailSampleSize);
  const top = sorted.slice(-tailSampleSize);
  const topPositiveRate = mean(top.map((record) => Number(record.positiveOutcome)));
  const bottomPositiveRate = mean(bottom.map((record) => Number(record.positiveOutcome)));
  const topReturn = mean(top.map((record) => record?.realisedOutcome?.realisedReturnPct));
  const bottomReturn = mean(bottom.map((record) => record?.realisedOutcome?.realisedReturnPct));
  return {
    tailSampleSize,
    topPositiveRate: round(topPositiveRate, 4),
    bottomPositiveRate: round(bottomPositiveRate, 4),
    positiveRateSpread: round(topPositiveRate !== null && bottomPositiveRate !== null ? topPositiveRate - bottomPositiveRate : null, 4),
    topMeanRealisedReturnPct: round(topReturn, 4),
    bottomMeanRealisedReturnPct: round(bottomReturn, 4),
    realisedReturnSpreadPct: round(topReturn !== null && bottomReturn !== null ? topReturn - bottomReturn : null, 4),
  };
}

function scoreBinIndex(score) {
  for (let index = 0; index < SCORE_BINS.length; index += 1) {
    const bin = SCORE_BINS[index];
    if (score >= bin.lower && (score < bin.upper || (bin.includeUpper && score <= bin.upper))) return index;
  }
  return null;
}

function scoreBins(records = [], options = {}) {
  const minimumBinSample = Math.max(5, Number(options.minimumBinSample || 20));
  const bins = SCORE_BINS.map((definition, index) => ({
    index,
    lower: definition.lower,
    upper: definition.upper,
    count: 0,
    outcomeSum: 0,
    returnSum: 0,
    returnCount: 0,
  }));
  for (const record of records.filter(maturedScoredRecord)) {
    const score = Number(record.latentFactorScore);
    const index = scoreBinIndex(score);
    if (index === null) continue;
    const bin = bins[index];
    bin.count += 1;
    bin.outcomeSum += Number(record.positiveOutcome);
    const realisedReturn = finite(record?.realisedOutcome?.realisedReturnPct);
    if (realisedReturn !== null) {
      bin.returnSum += realisedReturn;
      bin.returnCount += 1;
    }
  }
  const normalized = bins.map((bin) => ({
    index: bin.index,
    lower: bin.lower,
    upper: bin.upper,
    count: bin.count,
    sufficientSample: bin.count >= minimumBinSample,
    empiricalPositiveRate: bin.count ? round(bin.outcomeSum / bin.count, 4) : null,
    meanRealisedReturnPct: bin.returnCount ? round(bin.returnSum / bin.returnCount, 4) : null,
  }));
  const populated = normalized.filter((bin) => bin.sufficientSample);
  let monotonicInversionCount = 0;
  for (let index = 1; index < populated.length; index += 1) {
    if (Number(populated[index].empiricalPositiveRate) < Number(populated[index - 1].empiricalPositiveRate)) monotonicInversionCount += 1;
  }
  return {
    minimumBinSample,
    populatedBinCount: populated.length,
    monotonicInversionCount,
    bins: normalized,
  };
}

function splitContiguous(records, blockCount) {
  const sorted = chronological(records);
  return Array.from({ length: blockCount }, (_, index) => {
    const start = Math.floor(index * sorted.length / blockCount);
    const end = Math.floor((index + 1) * sorted.length / blockCount);
    return sorted.slice(start, end);
  });
}

export function evaluateFactorScoreTemporalStability(records = [], options = {}) {
  const matured = records.filter(maturedScoredRecord);
  const blockCount = Math.max(2, Number(options.factorStabilityBlockCount || 3));
  const minimumSubperiodSample = Math.max(20, Number(options.factorMinimumSubperiodSample || 40));
  const minimumStabilitySample = Math.max(blockCount * minimumSubperiodSample, Number(options.factorMinimumStabilitySample || 150));
  const minimumSubperiodClassCount = Math.max(3, Number(options.factorMinimumSubperiodClassCount || 8));
  const minimumSubperiodAuc = Number(options.factorMinimumSubperiodAuc ?? 0.5);
  const minimumSubperiodSpread = Number(options.factorMinimumSubperiodPositiveRateSpread ?? 0);
  const blockers = [];

  if (matured.length < minimumStabilitySample) {
    return {
      status: 'INSUFFICIENT_OOS_HISTORY',
      stableAcrossSubperiods: false,
      sampleSize: matured.length,
      blockers: ['FACTOR_STABILITY_OOS_SAMPLE_TOO_SMALL'],
      thresholds: { blockCount, minimumStabilitySample, minimumSubperiodSample, minimumSubperiodClassCount, minimumSubperiodAuc, minimumSubperiodSpread },
      subperiods: [],
    };
  }

  const subperiods = splitContiguous(matured, blockCount).map((block, index) => {
    const positiveCount = block.filter((record) => Number(record.positiveOutcome) === 1).length;
    const negativeCount = block.length - positiveCount;
    const rocAuc = auc(block);
    const spread = tailSpread(block, options);
    const localBlockers = [];
    if (block.length < minimumSubperiodSample) localBlockers.push('FACTOR_SUBPERIOD_SAMPLE_TOO_SMALL');
    if (positiveCount < minimumSubperiodClassCount || negativeCount < minimumSubperiodClassCount) localBlockers.push('FACTOR_SUBPERIOD_CLASS_IMBALANCE');
    if (!Number.isFinite(rocAuc) || rocAuc < minimumSubperiodAuc) localBlockers.push('FACTOR_SUBPERIOD_AUC_TOO_LOW');
    if (!Number.isFinite(Number(spread.positiveRateSpread)) || Number(spread.positiveRateSpread) <= minimumSubperiodSpread) localBlockers.push('FACTOR_SUBPERIOD_ORDERING_SPREAD_NOT_POSITIVE');
    return {
      index,
      sampleSize: block.length,
      positiveCount,
      negativeCount,
      firstForecastAt: block[0]?.forecastAt || block[0]?.forecastSampleDate || null,
      lastForecastAt: block.at(-1)?.forecastAt || block.at(-1)?.forecastSampleDate || null,
      rocAuc: round(rocAuc, 4),
      positiveRateSpread: spread.positiveRateSpread,
      realisedReturnSpreadPct: spread.realisedReturnSpreadPct,
      status: localBlockers.length ? 'UNSTABLE' : 'STABLE',
      blockers: localBlockers,
    };
  });
  if (subperiods.some((period) => period.status !== 'STABLE')) blockers.push('FACTOR_DISCRIMINATION_NOT_STABLE_ACROSS_SUBPERIODS');
  return {
    status: blockers.length ? 'UNSTABLE' : 'STABILITY_READY',
    stableAcrossSubperiods: blockers.length === 0,
    sampleSize: matured.length,
    blockers,
    thresholds: { blockCount, minimumStabilitySample, minimumSubperiodSample, minimumSubperiodClassCount, minimumSubperiodAuc, minimumSubperiodSpread },
    subperiods,
  };
}

function evaluateGroup(records, options = {}) {
  const lineage = liveFactorLineage(records);
  const scored = lineage.filter(scoredRecord);
  const maturedScored = lineage.filter(maturedScoredRecord);
  const positiveCount = maturedScored.filter((record) => Number(record.positiveOutcome) === 1).length;
  const negativeCount = maturedScored.length - positiveCount;
  const minimumMaturedSample = Math.max(50, Number(options.factorMinimumMaturedSample || 200));
  const minimumClassCount = Math.max(10, Number(options.factorMinimumClassCount || 30));
  const minimumAuc = Number(options.factorMinimumAuc ?? 0.56);
  const minimumPositiveRateSpread = Number(options.factorMinimumPositiveRateSpread ?? 0.1);
  const minimumRealisedReturnSpreadPct = Number(options.factorMinimumRealisedReturnSpreadPct ?? 0);
  const minimumPopulatedBins = Math.max(2, Number(options.factorMinimumPopulatedBins || 3));
  const maximumMonotonicInversions = Math.max(0, Number(options.factorMaximumMonotonicInversions ?? 1));

  const rocAuc = auc(maturedScored);
  const spread = tailSpread(maturedScored, options);
  const ordering = scoreBins(maturedScored, options);
  const stability = evaluateFactorScoreTemporalStability(maturedScored, options);
  const blockers = [];
  if (maturedScored.length < minimumMaturedSample) blockers.push('FACTOR_MATURED_OOS_SAMPLE_TOO_SMALL');
  if (positiveCount < minimumClassCount) blockers.push('FACTOR_POSITIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (negativeCount < minimumClassCount) blockers.push('FACTOR_NEGATIVE_OUTCOME_SAMPLE_TOO_SMALL');
  if (!Number.isFinite(rocAuc) || rocAuc < minimumAuc) blockers.push('FACTOR_ROC_AUC_TOO_LOW');
  if (!Number.isFinite(Number(spread.positiveRateSpread)) || Number(spread.positiveRateSpread) < minimumPositiveRateSpread) blockers.push('FACTOR_TOP_BOTTOM_OUTCOME_SPREAD_TOO_SMALL');
  if (!Number.isFinite(Number(spread.realisedReturnSpreadPct)) || Number(spread.realisedReturnSpreadPct) <= minimumRealisedReturnSpreadPct) blockers.push('FACTOR_TOP_BOTTOM_RETURN_SPREAD_NOT_POSITIVE');
  if (ordering.populatedBinCount < minimumPopulatedBins) blockers.push('FACTOR_SCORE_BINS_TOO_SPARSE');
  if (ordering.monotonicInversionCount > maximumMonotonicInversions) blockers.push('FACTOR_SCORE_ORDERING_TOO_NON_MONOTONIC');
  blockers.push(...stability.blockers);

  const uniqueBlockers = [...new Set(blockers)];
  const enoughHistory = maturedScored.length >= minimumMaturedSample && positiveCount >= minimumClassCount && negativeCount >= minimumClassCount;
  const promotionCandidate = uniqueBlockers.length === 0;
  return {
    factorScorePolicyVersion: lineage[0]?.factorScorePolicyVersion || null,
    assetClass: lineage[0]?.assetClass || 'UNKNOWN',
    horizon: lineage[0]?.horizon || 'UNKNOWN',
    status: promotionCandidate ? 'PROMOTION_CANDIDATE' : enoughHistory ? 'DISCRIMINATION_NOT_READY' : 'INSUFFICIENT_OOS_HISTORY',
    lineageRecordCount: lineage.length,
    scoreReadyRecordCount: scored.length,
    scoreBlockedOrUnavailableRecordCount: lineage.length - scored.length,
    openScoredCount: scored.filter((record) => record?.status === 'OPEN').length,
    maturedScoredCount: maturedScored.length,
    maturedPositiveCount: positiveCount,
    maturedNegativeCount: negativeCount,
    minimumMaturedSample,
    remainingMaturedSamplesToFloor: Math.max(0, minimumMaturedSample - maturedScored.length),
    sampleProgressPct: round(Math.min(1, maturedScored.length / minimumMaturedSample) * 100, 2),
    discrimination: {
      rocAuc: round(rocAuc, 4),
      topBottom: spread,
      scoreOrdering: ordering,
    },
    stability,
    thresholds: {
      minimumMaturedSample,
      minimumClassCount,
      minimumAuc,
      minimumPositiveRateSpread,
      minimumRealisedReturnSpreadPct,
      minimumPopulatedBins,
      maximumMonotonicInversions,
    },
    blockers: uniqueBlockers,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
  };
}

export function buildForecastFactorLearningStatus(input = {}) {
  const lineage = liveFactorLineage(input.records || input.archive?.records || []);
  const grouped = new Map();
  for (const record of lineage) {
    const key = groupKey(record);
    const group = grouped.get(key) || [];
    group.push(record);
    grouped.set(key, group);
  }
  const groups = [...grouped.values()]
    .map((records) => evaluateGroup(records, input.options || {}))
    .sort((a, b) =>
      String(a.factorScorePolicyVersion).localeCompare(String(b.factorScorePolicyVersion)) ||
      String(a.assetClass).localeCompare(String(b.assetClass)) ||
      String(a.horizon).localeCompare(String(b.horizon)),
    );
  const candidateCount = groups.filter((group) => group.status === 'PROMOTION_CANDIDATE').length;
  const maturedScoredCount = groups.reduce((sum, group) => sum + group.maturedScoredCount, 0);
  return {
    format: 'investor-control-forecast-factor-learning-status',
    version: 1,
    policyVersion: FORECAST_FACTOR_LEARNING_STATUS_VERSION,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    source: 'LIVE_SHADOW_OOS_FACTOR_LINEAGE_ONLY',
    status: !lineage.length ? 'NO_FACTOR_OOS_LINEAGE' : candidateCount ? 'PROMOTION_CANDIDATES_EXIST' : 'RESEARCH_ONLY',
    lineageRecordCount: lineage.length,
    maturedScoredCount,
    groupCount: groups.length,
    promotionCandidateGroupCount: candidateCount,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    globalBlockers: candidateCount ? ['FACTOR_PROBABILITY_MAPPING_NOT_CALIBRATED', 'DECISION_ENGINE_INTEGRATION_NOT_ENABLED'] : ['NO_FACTOR_GROUP_PASSED_OOS_DISCRIMINATION_AND_STABILITY_GATES'],
    groups,
  };
}
