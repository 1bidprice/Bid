import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHistoricalResearchValidationUniverse } from '../src/historical-research-validation-universe.js';
import { fetchProfessionalHistoricalMetrics, fetchProfessionalMarketSnapshot } from '../src/professional-market-data.js';
import { buildProspectiveFrozenTrainingCorpus } from '../src/forecast-prospective-training-corpus.js';
import { buildProspectiveFrozenStackPredictions } from '../src/forecast-prospective-frozen-stack-bridge.js';
import {
  buildProspectiveHoldoutCapture,
  buildProspectiveHoldoutProtocol,
  protocolFingerprint,
  verifyProspectiveHoldoutCapture,
} from '../src/forecast-prospective-holdout-protocol.js';
import {
  buildProspectiveFrozenTarget,
  latestCompletedSessionDate,
  latestCompletedSessionIso,
  PROSPECTIVE_TARGET_BUILDER_CONTRACT,
} from '../src/forecast-prospective-target-builder.js';

export const V1832_FIRST_CAPTURE_PROOF_CONTRACT = 'PROSPECTIVE_UNSEEN_HOLDOUT_FIRST_CAPTURE_PROOF_V1';
export const V1832_FIRST_CAPTURE_VERSION = '2026-08-17.1';
export const V1832_MINIMUM_HISTORY_OBSERVATIONS = 1_000;

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

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function latestObservationCount(series = {}) {
  return Array.isArray(series?.candles) ? series.candles.length : 0;
}

function slotFromPrediction(company, horizon, prediction) {
  return {
    companyId: company.companyId,
    symbol: company.primaryListing?.symbol || null,
    horizon: horizon.horizon,
    tradingDays: horizon.tradingDays,
    modelVariant: prediction.modelVariant,
    status: prediction.status,
    probabilityPositive: prediction.status === 'FORECAST_AVAILABLE' ? prediction.probabilityPositive : null,
    withheldReason: prediction.status === 'WITHHELD' ? prediction.withheldReason : null,
    featureAsOf: prediction.featureAsOf,
    modelSourceCommit: prediction.modelSourceCommit,
    trainingSampleSize: count(prediction.trainingSampleSize),
    trainingPositiveCount: count(prediction.trainingPositiveCount),
    trainingNegativeCount: count(prediction.trainingNegativeCount),
  };
}

async function loadFrozenUniverseMarketData(input = {}) {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const universe = buildHistoricalResearchValidationUniverse();
  const benchmarkCache = new Map();
  const loaded = [];
  const diagnostics = [];

  for (const company of universe) {
    const snapshotResult = await fetchProfessionalMarketSnapshot(company, {
      generatedAt,
      token: input.finnhubToken || process.env.FINNHUB_TOKEN || '',
      fetchImpl: input.fetchImpl || globalThis.fetch,
    });
    const historyResult = await fetchProfessionalHistoricalMetrics(company, {
      generatedAt,
      // Force the five-year validated Yahoo path for reproducible daily depth while
      // allowing the current snapshot above to use a licensed primary quote when available.
      token: '',
      fetchImpl: input.fetchImpl || globalThis.fetch,
      marketSnapshot: snapshotResult.snapshot,
      lookbackDays: 1_825,
      benchmarkMinimumObservationCount: V1832_MINIMUM_HISTORY_OBSERVATIONS,
      benchmarkFetchMaxAttempts: 3,
      benchmarkRetryDelayMs: 500,
      benchmarkCache,
    });
    diagnostics.push(...(snapshotResult.diagnostics || []), ...(historyResult.diagnostics || []));
    loaded.push({
      company,
      snapshot: snapshotResult.snapshot || null,
      series: historyResult.series || null,
      benchmarkSeries: historyResult.benchmarkSeries || null,
      historyObservationCount: latestObservationCount(historyResult.series),
      benchmarkObservationCount: latestObservationCount(historyResult.benchmarkSeries),
      historyLatestCompletedSession: latestCompletedSessionIso(historyResult.series),
      benchmarkLatestCompletedSession: latestCompletedSessionIso(historyResult.benchmarkSeries),
      historyLatestCompletedSessionDate: latestCompletedSessionDate(historyResult.series),
      benchmarkLatestCompletedSessionDate: latestCompletedSessionDate(historyResult.benchmarkSeries),
    });
  }
  return { universe, loaded, diagnostics };
}

export function buildV1832OperationalGate(input = {}) {
  const protocol = input.protocol || buildProspectiveHoldoutProtocol();
  const loaded = Array.isArray(input.loaded) ? input.loaded : [];
  const targetResults = Array.isArray(input.targetResults) ? input.targetResults : [];
  const captureVerification = input.captureVerification || null;
  const slots = Array.isArray(input.slots) ? input.slots : [];
  const configured = protocol.universeFreeze?.instrumentCount || 0;
  const historiesReady = loaded.filter((item) => item.series?.usable === true && item.historyObservationCount >= V1832_MINIMUM_HISTORY_OBSERVATIONS);
  const benchmarksReady = loaded.filter((item) => item.benchmarkSeries?.usable === true && item.benchmarkObservationCount >= V1832_MINIMUM_HISTORY_OBSERVATIONS);
  const benchmarkDates = [...new Set(benchmarksReady.map((item) => item.benchmarkLatestCompletedSessionDate).filter(Boolean))];
  const commonBenchmarkDate = benchmarkDates.length === 1 ? benchmarkDates[0] : null;
  const sessionAlignedCount = commonBenchmarkDate
    ? loaded.filter((item) => item.historyLatestCompletedSessionDate === commonBenchmarkDate && item.benchmarkLatestCompletedSessionDate === commonBenchmarkDate).length
    : 0;
  const targetReadyCount = targetResults.filter((item) => item.ready === true).length;
  const availableForecastCount = slots.filter((slot) => slot.status === 'FORECAST_AVAILABLE').length;
  const withheldForecastCount = slots.filter((slot) => slot.status === 'WITHHELD').length;
  const blockers = [];

  if (configured !== 16 || loaded.length !== configured) blockers.push('V1832_FROZEN_UNIVERSE_INCOMPLETE');
  if (historiesReady.length !== configured) blockers.push('V1832_FIVE_YEAR_HISTORY_COHORT_INCOMPLETE');
  if (benchmarksReady.length !== configured) blockers.push('V1832_SPY_BENCHMARK_COHORT_INCOMPLETE');
  if (!commonBenchmarkDate) blockers.push('V1832_COMMON_COMPLETED_BENCHMARK_SESSION_NOT_ESTABLISHED');
  if (sessionAlignedCount !== configured) blockers.push('V1832_COMPANY_HISTORY_NOT_ALIGNED_TO_LATEST_COMPLETED_SPY_SESSION');
  if (targetResults.length !== configured * protocol.horizons.length || targetReadyCount !== targetResults.length) blockers.push('V1832_TARGET_FEATURE_MATRIX_INCOMPLETE');
  if (slots.length !== protocol.captureProtocol.expectedSlotCountPerCapture) blockers.push('V1832_CAPTURE_SLOT_MATRIX_INCOMPLETE');
  if (availableForecastCount <= 0) blockers.push('V1832_ALL_FROZEN_FORECASTS_WITHHELD');
  if (captureVerification?.verified !== true) blockers.push('V1832_CAPTURE_VERIFICATION_FAILED');

  const uniqueBlockers = [...new Set(blockers)];
  return {
    contract: 'PROSPECTIVE_UNSEEN_HOLDOUT_FIRST_CAPTURE_OPERATIONAL_GATE_V1',
    status: uniqueBlockers.length ? 'FIRST_CAPTURE_BLOCKED' : 'FIRST_CAPTURE_READY',
    ready: uniqueBlockers.length === 0,
    configuredInstrumentCount: configured,
    loadedHistoryCount: historiesReady.length,
    loadedBenchmarkCount: benchmarksReady.length,
    minimumHistoryObservations: V1832_MINIMUM_HISTORY_OBSERVATIONS,
    commonBenchmarkCompletedSessionDate: commonBenchmarkDate,
    sessionAlignedInstrumentCount: sessionAlignedCount,
    targetFeatureCount: targetResults.length,
    targetReadyCount,
    expectedSlotCount: protocol.captureProtocol.expectedSlotCountPerCapture,
    actualSlotCount: slots.length,
    availableForecastCount,
    withheldForecastCount,
    captureVerified: captureVerification?.verified === true,
    blockers: uniqueBlockers,
    currentNewsDependentSelection: false,
    outcomeAwareSelectionAllowed: false,
    historicalBackfillAllowed: false,
    performancePeeked: false,
    decisionImpact: 'NONE',
  };
}

export function assertV1832FirstCaptureReady(proof = {}) {
  const blockers = [];
  if (proof?.contract !== V1832_FIRST_CAPTURE_PROOF_CONTRACT) blockers.push('V1832_PROOF_CONTRACT_CHANGED');
  if (proof?.operationalGate?.ready !== true) blockers.push(...(proof?.operationalGate?.blockers || ['V1832_OPERATIONAL_GATE_BLOCKED']));
  if (proof?.captureVerification?.verified !== true) blockers.push('V1832_CAPTURE_NOT_VERIFIED');
  if (proof?.holdoutStarted !== true || proof?.firstLiveCaptureCreated !== true) blockers.push('V1832_HOLDOUT_NOT_STARTED_BY_VALID_CAPTURE');
  if (proof?.performanceMetricsIncluded !== false || proof?.outcomeFieldsIncluded !== false) blockers.push('V1832_PREOUTCOME_BOUNDARY_BROKEN');
  if (proof?.automaticModelPromotionEnabled !== false
      || proof?.decisionIntegrationEnabled !== false
      || proof?.forecastMayInfluenceFinalAction !== false
      || proof?.finalActionEligible !== false
      || proof?.brokerExecutionEligible !== false
      || proof?.decisionImpact !== 'NONE') blockers.push('V1832_AUTHORITY_BOUNDARY_BROKEN');
  const unique = [...new Set(blockers)];
  if (unique.length) throw new Error(`v1832 first prospective capture blocked: ${unique.join(',')}`);
  return true;
}

export async function runV1832FirstProspectiveCapture(input = {}) {
  const capturedAt = new Date(input.capturedAt || Date.now()).toISOString();
  const protocol = buildProspectiveHoldoutProtocol();
  const market = await loadFrozenUniverseMarketData({
    generatedAt: capturedAt,
    finnhubToken: input.finnhubToken,
    fetchImpl: input.fetchImpl,
  });
  const loadedReady = market.loaded.filter((item) => item.series?.usable && item.benchmarkSeries?.usable);
  const instruments = loadedReady.map((item) => ({
    instrumentId: item.company.companyId,
    companyId: item.company.companyId,
    symbol: item.company.primaryListing?.symbol,
    assetClass: 'EQUITY',
    series: item.series,
    benchmarkSeries: item.benchmarkSeries,
  }));
  const corpus = buildProspectiveFrozenTrainingCorpus({
    instruments,
    options: RESEARCH_OPTIONS,
    generatedAt: capturedAt,
  });

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
      const bridge = buildProspectiveFrozenStackPredictions(corpus.records, targetResult.target);
      for (const prediction of bridge.predictions || []) slots.push(slotFromPrediction(company, horizon, prediction));
    }
  }

  const sourceDataAsOf = market.loaded
    .map((item) => item.historyLatestCompletedSession)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const capture = slots.length === protocol.captureProtocol.expectedSlotCountPerCapture
    ? buildProspectiveHoldoutCapture({
      protocol,
      capturedAt,
      sourceDataAsOf,
      previousCaptureHash: null,
      slots,
    })
    : null;
  const captureVerification = capture
    ? verifyProspectiveHoldoutCapture(capture, protocol)
    : { contract: 'PROSPECTIVE_UNSEEN_HOLDOUT_CAPTURE_VERIFICATION_V1', status: 'PROSPECTIVE_CAPTURE_REJECTED', verified: false, blockers: ['PROSPECTIVE_CAPTURE_SLOT_MATRIX_INCOMPLETE'] };
  const operationalGate = buildV1832OperationalGate({ protocol, loaded: market.loaded, targetResults, slots, captureVerification });
  const holdoutStarted = operationalGate.ready && captureVerification.verified === true;

  return {
    format: 'investor-control-prospective-unseen-holdout-first-capture-proof',
    version: 1,
    policyVersion: V1832_FIRST_CAPTURE_VERSION,
    contract: V1832_FIRST_CAPTURE_PROOF_CONTRACT,
    sourceCommit: input.sourceCommit || null,
    protocolContract: protocol.contract,
    protocolFingerprint: protocolFingerprint(protocol),
    targetBuilderContract: PROSPECTIVE_TARGET_BUILDER_CONTRACT,
    frozenModelSourceCommit: protocol.modelFreeze.sourceCommit,
    holdoutId: protocol.holdoutId,
    capturedAt,
    sourceDataAsOf,
    marketDataSummary: {
      configuredInstrumentCount: market.universe.length,
      loadedHistoryCount: market.loaded.filter((item) => item.series?.usable === true).length,
      loadedBenchmarkCount: market.loaded.filter((item) => item.benchmarkSeries?.usable === true).length,
      fiveYearHistoryReadyCount: market.loaded.filter((item) => item.historyObservationCount >= V1832_MINIMUM_HISTORY_OBSERVATIONS).length,
      fiveYearBenchmarkReadyCount: market.loaded.filter((item) => item.benchmarkObservationCount >= V1832_MINIMUM_HISTORY_OBSERVATIONS).length,
      historyObservationMinimum: market.loaded.length ? Math.min(...market.loaded.map((item) => item.historyObservationCount)) : 0,
      benchmarkObservationMinimum: market.loaded.length ? Math.min(...market.loaded.map((item) => item.benchmarkObservationCount)) : 0,
      latestCompletedSessionDates: [...new Set(market.loaded.map((item) => item.historyLatestCompletedSessionDate).filter(Boolean))],
      benchmarkLatestCompletedSessionDates: [...new Set(market.loaded.map((item) => item.benchmarkLatestCompletedSessionDate).filter(Boolean))],
      rawCandlesIncluded: false,
      rawSnapshotsIncluded: false,
    },
    trainingCorpusSummary: {
      contract: corpus.contract,
      referenceSourceCommit: corpus.referenceSourceCommit,
      instrumentCount: corpus.instrumentCount,
      generatedRecordCount: corpus.generatedRecordCount,
      validRegimeRecordCount: corpus.validRegimeRecordCount,
      regimeCoveragePct: corpus.regimeCoveragePct,
      rawRecordsIncluded: false,
      rawHistoricalCandlesIncluded: false,
    },
    targetSummary: {
      targetCount: targetResults.length,
      readyTargetCount: targetResults.filter((item) => item.ready).length,
      blockedTargetCount: targetResults.filter((item) => !item.ready).length,
      blockerCounts: Object.entries(targetResults.flatMap((item) => item.blockers || []).reduce((map, code) => ({ ...map, [code]: (map[code] || 0) + 1 }), {})).map(([code, targetCount]) => ({ code, targetCount })),
      targetOutcomeUsed: false,
      rawTargetsIncluded: false,
    },
    operationalGate,
    captureVerification,
    capture,
    holdoutStarted,
    firstLiveCaptureCreated: holdoutStarted,
    historicalBackfillAllowed: false,
    performanceMetricsIncluded: false,
    outcomeFieldsIncluded: false,
    prospectiveResearchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1832-first-prospective-capture.json');
  const proof = await runV1832FirstProspectiveCapture({
    sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT || null,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  console.log(`Wrote v1832 first prospective capture proof to ${outputPath}`);
  console.log(`Market data: histories=${proof.marketDataSummary.fiveYearHistoryReadyCount}/16, benchmarks=${proof.marketDataSummary.fiveYearBenchmarkReadyCount}/16`);
  console.log(`Completed session dates: company=${proof.marketDataSummary.latestCompletedSessionDates.join(',') || 'none'}, benchmark=${proof.marketDataSummary.benchmarkLatestCompletedSessionDates.join(',') || 'none'}`);
  console.log(`Targets ready: ${proof.targetSummary.readyTargetCount}/${proof.targetSummary.targetCount}`);
  console.log(`Capture slots: available=${proof.operationalGate.availableForecastCount}, withheld=${proof.operationalGate.withheldForecastCount}, total=${proof.operationalGate.actualSlotCount}`);
  console.log(`Capture verification: ${proof.captureVerification.status}`);
  console.log(`Holdout started: ${proof.holdoutStarted}`);
  assertV1832FirstCaptureReady(proof);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
