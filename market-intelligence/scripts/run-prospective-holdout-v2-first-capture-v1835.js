import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHistoricalResearchValidationUniverse } from '../src/historical-research-validation-universe.js';
import { fetchProfessionalHistoricalMetrics } from '../src/professional-market-data.js';
import { buildProspectiveFrozenTrainingCorpus } from '../src/forecast-prospective-training-corpus.js';
import { buildProspectiveFrozenStackPredictions } from '../src/forecast-prospective-frozen-stack-bridge.js';
import {
  buildProspectiveFrozenTarget,
  latestCompletedSessionDate,
  latestCompletedSessionIso,
} from '../src/forecast-prospective-target-builder.js';
import {
  buildProspectiveHoldoutCaptureV2,
  buildProspectiveHoldoutProtocolV2,
  prospectiveTargetFeatureFingerprint,
  protocolV2Fingerprint,
  verifyProspectiveHoldoutCaptureV2,
} from '../src/forecast-prospective-holdout-protocol-v2.js';

export const V1835_V2_FIRST_CAPTURE_PROOF_CONTRACT = 'PROSPECTIVE_UNSEEN_HOLDOUT_V2_FIRST_CAPTURE_PROOF_V1';
export const V1835_V2_FIRST_CAPTURE_VERSION = '2026-08-17.1';
export const V1835_MINIMUM_HISTORY_OBSERVATIONS = 1_000;

const RESEARCH_OPTIONS = Object.freeze({
  horizons: { week1: 5, month1: 21 },
  warmupObservations: 260,
  evaluationStep: 5,
  minimumForecastsForMetrics: 100,
  minAnalogCount: 5,
  maxAnalogs: 40,
  minEffectiveSample: 4,
  sameInstrumentTrendRegimeOnly: true,
  minimumHistory: 200,
  periodsPerYear: 252,
  marketRegimeMinimumObservations: 200,
});

function observationCount(series = {}) {
  return Array.isArray(series?.candles) ? series.candles.length : 0;
}

async function loadCompletedSessionOnlyMarketData(input = {}) {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const universe = buildHistoricalResearchValidationUniverse();
  const benchmarkCache = new Map();
  const loaded = [];
  const diagnostics = [];
  for (const company of universe) {
    const history = await fetchProfessionalHistoricalMetrics(company, {
      generatedAt,
      token: '',
      fetchImpl: input.fetchImpl || globalThis.fetch,
      marketSnapshot: null,
      lookbackDays: 1_825,
      benchmarkMinimumObservationCount: V1835_MINIMUM_HISTORY_OBSERVATIONS,
      benchmarkFetchMaxAttempts: 3,
      benchmarkRetryDelayMs: 500,
      benchmarkCache,
    });
    diagnostics.push(...(history.diagnostics || []));
    loaded.push({
      company,
      series: history.series || null,
      benchmarkSeries: history.benchmarkSeries || null,
      historyObservationCount: observationCount(history.series),
      benchmarkObservationCount: observationCount(history.benchmarkSeries),
      historyLatestSession: latestCompletedSessionIso(history.series),
      benchmarkLatestSession: latestCompletedSessionIso(history.benchmarkSeries),
      historyLatestSessionDate: latestCompletedSessionDate(history.series),
      benchmarkLatestSessionDate: latestCompletedSessionDate(history.benchmarkSeries),
    });
  }
  return { universe, loaded, diagnostics };
}

function slotFromTargetAndPrediction(company, horizon, target, prediction, protocol) {
  const feature = {
    forecastId: target.forecastId,
    companyId: company.companyId,
    symbol: company.primaryListing?.symbol || null,
    horizon: horizon.horizon,
    tradingDays: horizon.tradingDays,
    featureAsOf: target.forecastAt,
    rawPatternProbabilityPositive: target.rawProbabilityPositive,
    regimeKey: target.regimeKey,
    historicalPatternPolicyVersion: target.historicalPatternPolicyVersion,
    historicalMarketFactorPolicyVersion: target.historicalMarketFactorPolicyVersion,
    historicalMarketFactorScore: target.historicalMarketFactorScore,
  };
  return {
    ...feature,
    modelVariant: prediction.modelVariant,
    status: prediction.status,
    probabilityPositive: prediction.status === 'FORECAST_AVAILABLE' ? prediction.probabilityPositive : null,
    withheldReason: prediction.status === 'WITHHELD' ? prediction.withheldReason : null,
    targetFeatureFingerprint: prospectiveTargetFeatureFingerprint(feature),
    modelSourceCommit: protocol.modelFreeze.sourceCommit,
    trainingSampleSize: Number(prediction.trainingSampleSize || 0),
    trainingPositiveCount: Number(prediction.trainingPositiveCount || 0),
    trainingNegativeCount: Number(prediction.trainingNegativeCount || 0),
  };
}

export function assertV1835V2FirstCaptureReady(proof = {}) {
  const blockers = [];
  if (proof?.contract !== V1835_V2_FIRST_CAPTURE_PROOF_CONTRACT) blockers.push('V1835_PROOF_CONTRACT_CHANGED');
  if (proof?.v1Retirement?.maturedOutcomeCountAtRetirement !== 0 || proof?.v1Retirement?.performancePeekedAtRetirement !== false) blockers.push('V1835_V1_RETIRED_AFTER_OUTCOME_EXPOSURE');
  if (proof?.marketDataSummary?.completedSessionOnly !== true || proof?.marketDataSummary?.currentIntradayQuoteUsed !== false) blockers.push('V1835_INFORMATION_BOUNDARY_BROKEN');
  if (proof?.marketDataSummary?.fiveYearHistoryReadyCount !== 16 || proof?.marketDataSummary?.fiveYearBenchmarkReadyCount !== 16) blockers.push('V1835_MARKET_DATA_COHORT_INCOMPLETE');
  if (proof?.marketDataSummary?.sessionAlignedInstrumentCount !== 16) blockers.push('V1835_SESSION_ALIGNMENT_INCOMPLETE');
  if (proof?.trainingCorpusSummary?.instrumentCount !== 16 || proof?.trainingCorpusSummary?.regimeCoveragePct !== 100) blockers.push('V1835_TRAINING_CORPUS_INCOMPLETE');
  if (proof?.targetSummary?.readyTargetCount !== 32 || proof?.targetSummary?.targetCount !== 32) blockers.push('V1835_TARGET_MATRIX_INCOMPLETE');
  if (proof?.captureVerification?.verified !== true || proof?.captureVerification?.actualSlotCount !== 128 || proof?.captureVerification?.targetFeatureFingerprintCount !== 32) blockers.push('V1835_V2_CAPTURE_NOT_VERIFIED');
  if (proof?.availableForecastCount <= 0) blockers.push('V1835_ALL_FORECASTS_WITHHELD');
  if (proof?.holdoutStarted !== true || proof?.firstLiveCaptureCreated !== true) blockers.push('V1835_V2_HOLDOUT_NOT_STARTED');
  if (proof?.performanceMetricsIncluded !== false || proof?.performancePeeked !== false || proof?.outcomeFieldsIncluded !== false) blockers.push('V1835_PREOUTCOME_BOUNDARY_BROKEN');
  if (proof?.automaticModelPromotionEnabled !== false
      || proof?.decisionIntegrationEnabled !== false
      || proof?.forecastMayInfluenceFinalAction !== false
      || proof?.brokerExecutionEligible !== false
      || proof?.decisionImpact !== 'NONE') blockers.push('V1835_AUTHORITY_BOUNDARY_BROKEN');
  const unique = [...new Set(blockers)];
  if (unique.length) throw new Error(`v1835 v2 first capture blocked: ${unique.join(',')}`);
  return true;
}

export async function runV1835V2FirstCapture(input = {}) {
  const capturedAt = new Date(input.capturedAt || Date.now()).toISOString();
  const protocol = buildProspectiveHoldoutProtocolV2();
  const market = await loadCompletedSessionOnlyMarketData({ generatedAt: capturedAt, fetchImpl: input.fetchImpl });
  const readyLoaded = market.loaded.filter((item) => item.series?.usable && item.benchmarkSeries?.usable);
  const instruments = readyLoaded.map((item) => ({
    instrumentId: item.company.companyId,
    companyId: item.company.companyId,
    symbol: item.company.primaryListing?.symbol,
    assetClass: 'EQUITY',
    series: item.series,
    benchmarkSeries: item.benchmarkSeries,
  }));
  const corpus = buildProspectiveFrozenTrainingCorpus({ instruments, options: RESEARCH_OPTIONS, generatedAt: capturedAt });

  const targetResults = [];
  const slots = [];
  for (const company of market.universe) {
    const loaded = market.loaded.find((item) => item.company.companyId === company.companyId) || null;
    if (!loaded?.series || !loaded?.benchmarkSeries) continue;
    for (const horizon of protocol.horizons) {
      const targetResult = buildProspectiveFrozenTarget({
        company,
        series: loaded.series,
        benchmarkSeries: loaded.benchmarkSeries,
        horizon: horizon.horizon,
        tradingDays: horizon.tradingDays,
        periodsPerYear: RESEARCH_OPTIONS.periodsPerYear,
        minimumHistory: RESEARCH_OPTIONS.minimumHistory,
        minAnalogCount: RESEARCH_OPTIONS.minAnalogCount,
        maxAnalogs: RESEARCH_OPTIONS.maxAnalogs,
        minEffectiveSample: RESEARCH_OPTIONS.minEffectiveSample,
        marketRegimeMinimumObservations: RESEARCH_OPTIONS.marketRegimeMinimumObservations,
      });
      targetResults.push(targetResult);
      if (!targetResult.ready) continue;
      const bridge = buildProspectiveFrozenStackPredictions(corpus.records, targetResult.target);
      for (const prediction of bridge.predictions || []) {
        slots.push(slotFromTargetAndPrediction(company, horizon, targetResult.target, prediction, protocol));
      }
    }
  }

  const benchmarkDates = [...new Set(market.loaded.map((item) => item.benchmarkLatestSessionDate).filter(Boolean))];
  const commonSessionDate = benchmarkDates.length === 1 ? benchmarkDates[0] : null;
  const sessionAlignedInstrumentCount = commonSessionDate
    ? market.loaded.filter((item) => item.historyLatestSessionDate === commonSessionDate && item.benchmarkLatestSessionDate === commonSessionDate).length
    : 0;
  const sourceDataAsOf = market.loaded.map((item) => item.historyLatestSession).filter(Boolean).sort().at(-1) || null;
  const capture = slots.length === protocol.captureProtocol.expectedSlotCountPerCapture
    ? buildProspectiveHoldoutCaptureV2({ protocol, capturedAt, sourceDataAsOf, previousCaptureHash: null, slots })
    : null;
  const captureVerification = capture
    ? verifyProspectiveHoldoutCaptureV2(capture, protocol)
    : { status: 'PROSPECTIVE_V2_CAPTURE_REJECTED', verified: false, actualSlotCount: slots.length, targetFeatureFingerprintCount: 0, blockers: ['V2_CAPTURE_SLOT_MATRIX_INCOMPLETE'] };
  const availableForecastCount = slots.filter((slot) => slot.status === 'FORECAST_AVAILABLE').length;
  const withheldForecastCount = slots.filter((slot) => slot.status === 'WITHHELD').length;

  const proof = {
    format: 'investor-control-prospective-unseen-holdout-v2-first-capture-proof',
    version: 1,
    policyVersion: V1835_V2_FIRST_CAPTURE_VERSION,
    contract: V1835_V2_FIRST_CAPTURE_PROOF_CONTRACT,
    sourceCommit: input.sourceCommit || null,
    protocolContract: protocol.contract,
    protocolFingerprint: protocolV2Fingerprint(protocol),
    holdoutId: protocol.holdoutId,
    frozenModelSourceCommit: protocol.modelFreeze.sourceCommit,
    capturedAt,
    sourceDataAsOf,
    completedSessionDate: commonSessionDate,
    v1Retirement: protocol.supersession,
    marketDataSummary: {
      configuredInstrumentCount: market.universe.length,
      fiveYearHistoryReadyCount: market.loaded.filter((item) => item.series?.usable && item.historyObservationCount >= V1835_MINIMUM_HISTORY_OBSERVATIONS).length,
      fiveYearBenchmarkReadyCount: market.loaded.filter((item) => item.benchmarkSeries?.usable && item.benchmarkObservationCount >= V1835_MINIMUM_HISTORY_OBSERVATIONS).length,
      historyObservationMinimum: market.loaded.length ? Math.min(...market.loaded.map((item) => item.historyObservationCount)) : 0,
      benchmarkObservationMinimum: market.loaded.length ? Math.min(...market.loaded.map((item) => item.benchmarkObservationCount)) : 0,
      completedSessionDates: [...new Set(market.loaded.map((item) => item.historyLatestSessionDate).filter(Boolean))],
      benchmarkCompletedSessionDates: benchmarkDates,
      sessionAlignedInstrumentCount,
      completedSessionOnly: true,
      currentIntradayQuoteUsed: false,
      rawCandlesIncluded: false,
    },
    trainingCorpusSummary: {
      contract: corpus.contract,
      referenceSourceCommit: corpus.referenceSourceCommit,
      instrumentCount: corpus.instrumentCount,
      generatedRecordCount: corpus.generatedRecordCount,
      validRegimeRecordCount: corpus.validRegimeRecordCount,
      regimeCoveragePct: corpus.regimeCoveragePct,
      rawRecordsIncluded: false,
    },
    targetSummary: {
      targetCount: targetResults.length,
      readyTargetCount: targetResults.filter((item) => item.ready).length,
      blockedTargetCount: targetResults.filter((item) => !item.ready).length,
      rawPatternBaselineCapturedInEverySlot: slots.length > 0 && slots.every((slot) => typeof slot.rawPatternProbabilityPositive === 'number'),
      regimeKeyCapturedInEverySlot: slots.length > 0 && slots.every((slot) => typeof slot.regimeKey === 'string' && slot.regimeKey.length > 0),
      targetFeatureFingerprintCapturedInEverySlot: slots.length > 0 && slots.every((slot) => typeof slot.targetFeatureFingerprint === 'string' && slot.targetFeatureFingerprint.length === 64),
      targetOutcomeUsed: false,
    },
    availableForecastCount,
    withheldForecastCount,
    captureVerification,
    capture,
    holdoutStarted: captureVerification.verified === true,
    firstLiveCaptureCreated: captureVerification.verified === true,
    historicalBackfillAllowed: false,
    performanceMetricsIncluded: false,
    performancePeeked: false,
    outcomeFieldsIncluded: false,
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
  assertV1835V2FirstCaptureReady(proof);
  return proof;
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1835-v2-first-capture.json');
  const proof = await runV1835V2FirstCapture({
    sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT || null,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  console.log(`Wrote v1835 v2 first capture proof to ${outputPath}`);
  console.log(`V1 retired before outcomes: ${proof.v1Retirement.maturedOutcomeCountAtRetirement === 0}`);
  console.log(`Completed session: ${proof.completedSessionDate}`);
  console.log(`Targets ready: ${proof.targetSummary.readyTargetCount}/${proof.targetSummary.targetCount}`);
  console.log(`Capture slots: available=${proof.availableForecastCount}, withheld=${proof.withheldForecastCount}`);
  console.log(`V2 capture verification: ${proof.captureVerification.status}`);
  console.log(`V2 holdout started: ${proof.holdoutStarted}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
