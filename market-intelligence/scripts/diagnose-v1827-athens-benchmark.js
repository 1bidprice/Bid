import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchYahooChartSeries } from '../src/adapters/yahoo-chart.js';

export const V1827_ATHENS_BENCHMARK_DIAGNOSTIC_CONTRACT = 'ATHENS_BENCHMARK_COVERAGE_DIAGNOSTIC_V1';

function isoDate(timestampSeconds) {
  const value = Number(timestampSeconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString().slice(0, 10);
}

function summarizeResult(label, result) {
  const series = result?.series || null;
  const candles = Array.isArray(series?.candles) ? series.candles : [];
  const diagnosticCodes = [...new Set((result?.diagnostics || [])
    .map((item) => item?.code)
    .filter((code) => typeof code === 'string' && code))]
    .slice(0, 20);
  return {
    label,
    usable: series?.usable === true,
    selectedProviderSymbol: series?.providerSymbol || null,
    source: series?.source || null,
    sourceQuality: series?.sourceQuality || null,
    candleCount: candles.length,
    firstDate: candles.length ? isoDate(candles[0]?.timestamp) : null,
    observation200Date: candles.length >= 200 ? isoDate(candles[199]?.timestamp) : null,
    lastDate: candles.length ? isoDate(candles.at(-1)?.timestamp) : null,
    regimeMinimumHistorySatisfied: candles.length >= 200,
    diagnosticCodes,
    rawCandlesIncluded: false,
    sourceUrlsIncluded: false,
  };
}

async function fetchCompact(label, symbol, alternateSymbols = []) {
  const result = await fetchYahooChartSeries(symbol, {
    alternateSymbols,
    range: '5y',
    interval: '1d',
    excludeIncompleteSession: true,
    generatedAt: new Date().toISOString(),
  });
  return summarizeResult(label, result);
}

export async function diagnoseV1827AthensBenchmark() {
  const combined = await fetchCompact('ATHENS_COMBINED_ROUTE', 'GD.AT', ['ATG.AT', '^ATG']);
  const explicit = [];
  for (const symbol of ['GD.AT', 'ATG.AT', '^ATG']) {
    explicit.push(await fetchCompact(`ATHENS_EXPLICIT_${symbol}`, symbol));
  }
  const control = await fetchCompact('US_CONTROL_SPY', 'SPY');

  return {
    format: 'investor-control-athens-benchmark-coverage-diagnostic',
    version: 1,
    contract: V1827_ATHENS_BENCHMARK_DIAGNOSTIC_CONTRACT,
    generatedAt: new Date().toISOString(),
    requestedRange: '5y',
    requestedInterval: '1d',
    regimeMinimumHistory: 200,
    combined,
    explicit,
    control,
    rawCandlesIncluded: false,
    sourceUrlsIncluded: false,
    productionDefaultsChanged: false,
    statisticalThresholdsChanged: false,
    decisionIntegrationEnabled: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1827-athens-benchmark-diagnostic.json');
  const diagnostic = await diagnoseV1827AthensBenchmark();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(diagnostic, null, 2));
  console.log(`Wrote Athens benchmark diagnostic to ${outputPath}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
