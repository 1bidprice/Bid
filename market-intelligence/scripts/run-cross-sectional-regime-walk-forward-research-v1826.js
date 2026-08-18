import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCrossSectionalRegimeWalkForwardResearchJob } from './run-cross-sectional-regime-walk-forward-research.js';

export const V1826_HISTORY_DEPTH_CONTRACT = 'RESEARCH_ONLY_FIVE_YEAR_HISTORY_DEPTH_V1';
export const V1826_RESEARCH_LOOKBACK_DAYS = 1_825;

export async function runV1826HistoricalResearchJob(input = {}) {
  const runBase = input.runBase || runCrossSectionalRegimeWalkForwardResearchJob;
  const artifact = await runBase({
    ...input,
    autonomousOptions: {
      ...(input.autonomousOptions || {}),
      lookbackDays: V1826_RESEARCH_LOOKBACK_DAYS,
    },
  });

  return {
    ...artifact,
    historyDepth: {
      contract: V1826_HISTORY_DEPTH_CONTRACT,
      lookbackDays: V1826_RESEARCH_LOOKBACK_DAYS,
      expectedYahooRange: '5y',
      normalProductionDefaultChanged: false,
      qualityValidationChanged: false,
      statisticalReadinessThresholdsChanged: false,
      historicalResearchOnly: true,
      automaticPromotionAllowed: false,
      decisionImpact: 'NONE',
    },
  };
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/historical-regime-walk-forward-research.json');
  const result = await runV1826HistoricalResearchJob({
    maximumInstrumentCount: process.env.HISTORICAL_RESEARCH_MAX_INSTRUMENTS,
    sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`Wrote v1826 historical research artifact to ${outputPath}`);
  console.log(`Research-only history lookback: ${result.historyDepth.lookbackDays} days (${result.historyDepth.expectedYahooRange})`);
  console.log(`Historical records: ${result.telemetry?.forecastHistoricalWalkForwardGeneratedRecordCount || 0}`);
  console.log(`Distinct forecast dates max: ${result.readinessSummary?.observedMaxima?.distinctForecastDates || 0}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
