import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAutonomousIntelligence } from '../src/run-autonomous-intelligence.js';
import {
  buildCrossSectionalRegimeWalkForwardOperationalTelemetry,
  verifyCrossSectionalRegimeWalkForwardProductionSafety,
} from '../src/forecast-cross-sectional-regime-walk-forward-production-safety.js';

export const HISTORICAL_RESEARCH_JOB_VERSION = '2026-08-13.2';
export const HISTORICAL_RESEARCH_JOB_CONTRACT = 'ARTIFACT_ONLY_CROSS_SECTIONAL_REGIME_WALK_FORWARD_JOB_V1';
export const HISTORICAL_RESEARCH_READINESS_SUMMARY_CONTRACT = 'HISTORICAL_REGIME_WALK_FORWARD_READINESS_SUMMARY_V1';

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(number)));
}

function researchOptions(input = {}) {
  return {
    horizons: input.horizons || { week1: 5, month1: 21 },
    warmupObservations: boundedInteger(input.warmupObservations, 260, 200, 1000),
    evaluationStep: boundedInteger(input.evaluationStep, 5, 1, 63),
    minimumHistory: boundedInteger(input.minimumHistory, 200, 100, 1000),
    minAnalogCount: boundedInteger(input.minAnalogCount, 5, 3, 100),
    maxAnalogs: boundedInteger(input.maxAnalogs, 40, 5, 200),
    minEffectiveSample: Math.max(2, Math.min(100, Number(input.minEffectiveSample || 4))),
    minimumDistinctForecastDates: boundedInteger(input.minimumDistinctForecastDates, 30, 5, 500),
    minimumDistinctInstruments: boundedInteger(input.minimumDistinctInstruments, 8, 2, 100),
    maximumSingleForecastDateSharePct: Math.max(1, Math.min(25, Number(input.maximumSingleForecastDateSharePct || 15))),
    minimumEffectiveNonOverlappingWindows: boundedInteger(input.minimumEffectiveNonOverlappingWindows, 12, 3, 250),
    maximumSingleInstrumentSharePct: Math.max(5, Math.min(40, Number(input.maximumSingleInstrumentSharePct || 25))),
    minimumEffectiveInstrumentCount: Math.max(2, Math.min(100, Number(input.minimumEffectiveInstrumentCount || 5))),
    minimumCalibrationSample: boundedInteger(input.minimumCalibrationSample, 60, 20, 1000),
    includeAuditSamples: false,
  };
}

function finiteMaximum(values = []) {
  const finite = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return finite.length ? Math.max(...finite) : 0;
}

export function summarizeHistoricalResearchReadiness(status = {}, options = {}) {
  const groups = Array.isArray(status?.research?.groups) ? status.research.groups : [];
  const blockerMap = new Map();
  for (const group of groups) {
    for (const code of new Set(Array.isArray(group?.blockers) ? group.blockers : [])) {
      if (typeof code !== 'string' || !code.trim()) continue;
      blockerMap.set(code, (blockerMap.get(code) || 0) + 1);
    }
  }
  const blockerCounts = [...blockerMap.entries()]
    .map(([code, groupCount]) => ({ code, groupCount }))
    .sort((left, right) => right.groupCount - left.groupCount || left.code.localeCompare(right.code));
  const readyGroupCount = groups.filter((group) => group?.status === 'HISTORICAL_REGIME_RESEARCH_READY').length;
  return {
    contract: HISTORICAL_RESEARCH_READINESS_SUMMARY_CONTRACT,
    status: readyGroupCount > 0 ? 'READY_GROUPS_EXIST' : 'NO_READY_GROUPS',
    groupCount: groups.length,
    readyGroupCount,
    notReadyGroupCount: groups.length - readyGroupCount,
    blockerCounts,
    gateReadiness: {
      sampleIndependenceReadyGroupCount: groups.filter((group) => group?.sampleIndependence?.status === 'OOS_SAMPLE_INDEPENDENCE_READY').length,
      outcomeWindowReadyGroupCount: groups.filter((group) => group?.outcomeWindowIndependence?.status === 'WINDOW_INDEPENDENCE_READY').length,
      instrumentDiversificationReadyGroupCount: groups.filter((group) => group?.instrumentConcentration?.status === 'INSTRUMENT_DIVERSIFICATION_READY').length,
      calibrationReadyGroupCount: groups.filter((group) => group?.calibration?.status === 'OOS_METRICS_READY').length,
    },
    observedMaxima: {
      sampleSize: finiteMaximum(groups.map((group) => group?.sampleSize)),
      distinctForecastDates: finiteMaximum(groups.map((group) => group?.sampleIndependence?.distinctForecastDateCount)),
      distinctInstruments: finiteMaximum(groups.map((group) => group?.sampleIndependence?.distinctInstrumentCount)),
      effectiveNonOverlappingWindows: finiteMaximum(groups.map((group) => group?.outcomeWindowIndependence?.effectiveNonOverlappingWindowCount)),
      effectiveInstrumentCount: finiteMaximum(groups.map((group) => group?.instrumentConcentration?.effectiveInstrumentCount)),
    },
    thresholds: {
      minimumDistinctForecastDates: options.minimumDistinctForecastDates ?? 30,
      minimumDistinctInstruments: options.minimumDistinctInstruments ?? 8,
      maximumSingleForecastDateSharePct: options.maximumSingleForecastDateSharePct ?? 15,
      minimumEffectiveNonOverlappingWindows: options.minimumEffectiveNonOverlappingWindows ?? 12,
      maximumSingleInstrumentSharePct: options.maximumSingleInstrumentSharePct ?? 25,
      minimumEffectiveInstrumentCount: options.minimumEffectiveInstrumentCount ?? 5,
      minimumCalibrationSample: options.minimumCalibrationSample ?? 60,
    },
    historicalResearchOnly: true,
    rawHistoricalRecordsIncluded: false,
    automaticModelPromotionEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

export async function runCrossSectionalRegimeWalkForwardResearchJob(input = {}) {
  const startedAt = new Date(input.startedAt || Date.now());
  const maximumInstrumentCount = boundedInteger(input.maximumInstrumentCount, 24, 2, 40);
  const configuredResearchOptions = researchOptions(input.researchOptions || {});
  const runAutonomous = input.runAutonomous || runAutonomousIntelligence;
  const report = await runAutonomous({
    ...(input.autonomousOptions || {}),
    crossSectionalHistoricalRegimeWalkForwardEnabled: true,
    crossSectionalHistoricalRegimeWalkForwardMaxInstruments: maximumInstrumentCount,
    crossSectionalHistoricalRegimeWalkForwardOptions: configuredResearchOptions,
  });
  const status = report?.forecastCrossSectionalRegimeWalkForwardRuntimeStatus;
  if (!status || status.executionState !== 'ENABLED_RESEARCH_ONLY') {
    throw new Error('Historical walk-forward research job did not enter ENABLED_RESEARCH_ONLY state.');
  }
  const telemetry = buildCrossSectionalRegimeWalkForwardOperationalTelemetry(status);
  const verification = verifyCrossSectionalRegimeWalkForwardProductionSafety({
    forecastCrossSectionalRegimeWalkForwardRuntimeStatus: status,
    operationalHealth: telemetry,
  });
  const readinessSummary = summarizeHistoricalResearchReadiness(status, configuredResearchOptions);
  const completedAt = new Date();
  return {
    format: 'investor-control-historical-regime-walk-forward-research-artifact',
    version: 1,
    policyVersion: HISTORICAL_RESEARCH_JOB_VERSION,
    contract: HISTORICAL_RESEARCH_JOB_CONTRACT,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationSeconds: Math.max(0, Number(((completedAt.getTime() - startedAt.getTime()) / 1000).toFixed(3))),
    sourceGeneratedAt: report?.generatedAt || null,
    sourceCommit: input.sourceCommit || process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT || null,
    executionState: status.executionState,
    maximumInstrumentCount,
    verification,
    telemetry,
    readinessSummary,
    researchStatus: status,
    publication: {
      liveFeedWriteAllowed: false,
      forecastOutcomeLedgerWriteAllowed: false,
      decisionHistoryWriteAllowed: false,
      gitPushAllowed: false,
      artifactOnly: true,
    },
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/historical-regime-walk-forward-research.json');
  const result = await runCrossSectionalRegimeWalkForwardResearchJob({
    maximumInstrumentCount: process.env.HISTORICAL_RESEARCH_MAX_INSTRUMENTS,
    sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`Wrote historical regime walk-forward research artifact to ${outputPath}`);
  console.log(`Historical records: ${result.telemetry.forecastHistoricalWalkForwardGeneratedRecordCount}`);
  console.log(`Valid regime records: ${result.telemetry.forecastHistoricalWalkForwardValidRegimeRecordCount}`);
  console.log(`Research groups: ${result.telemetry.forecastHistoricalWalkForwardGroupCount}; ready: ${result.telemetry.forecastHistoricalWalkForwardReadyGroupCount}`);
  if (result.readinessSummary.blockerCounts.length) {
    console.log(`Readiness blockers: ${result.readinessSummary.blockerCounts.map((item) => `${item.code}=${item.groupCount}`).join(', ')}`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
