import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 history-freshness-recovery patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchProfessionalMarketData() {
  let source = read('src/professional-market-data.js');

  source = replaceRequired(
    source,
    "import { fetchYahooChartSeries } from './adapters/yahoo-chart.js';",
    "import { fetchYahooChartSeries } from './adapters/yahoo-chart.js';\nimport { validateAndMergeRecentHistory } from './history-freshness-recovery.js';",
    'history freshness recovery import',
  );

  source = replaceRequired(
    source,
    `async function fetchBenchmarkSeries(company, options, diagnostics) {`,
    `async function fetchRecentHistoryRecoverySeries(company, options, diagnostics) {
  const yahooSymbols = companyYahooSymbols(company);
  if (!yahooSymbols.length) return null;
  const recent = await fetchYahooChartSeries(yahooSymbols[0], {
    ...options,
    symbol: company.primaryListing?.symbol,
    alternateSymbols: yahooSymbols.slice(1),
    currency: company.currency || company.listings?.[0]?.currency || null,
    range: options.historyFreshnessRecoveryRange || '1mo',
    interval: '1d',
    excludeIncompleteSession: true,
  });
  diagnostics.push(...(recent.diagnostics || []).map((item) => ({ ...item, freshnessRecovery: true })));
  return recent.series || null;
}

async function fetchBenchmarkSeries(company, options, diagnostics) {`,
    'recent history recovery fetch helper',
  );

  source = replaceRequired(
    source,
    `  const series = await fetchCompanyHistorySeries(company, options, diagnostics);`,
    `  let series = await fetchCompanyHistorySeries(company, options, diagnostics);`,
    'mutable history series for validated recovery',
  );

  source = replaceRequired(
    source,
    `  const benchmarkSeries = await fetchBenchmarkSeries(company, options, diagnostics);
  const validation = validateHistoryAgainstSnapshot(series, options.marketSnapshot, company, benchmarkSeries, options);`,
    `  const benchmarkSeries = await fetchBenchmarkSeries(company, options, diagnostics);
  let validation = validateHistoryAgainstSnapshot(series, options.marketSnapshot, company, benchmarkSeries, options);

  if (
    options.historyFreshnessRecoveryEnabled !== false &&
    validation.ready !== true &&
    validation.reason === 'HISTORY_LAGS_BENCHMARK_SESSION' &&
    series?.source === 'Yahoo Finance Chart' &&
    series?.sourceQuality === 'SECONDARY_VALIDATED' &&
    validation.benchmarkLatestDate
  ) {
    const staleLatestDate = validation.latestDate || null;
    const recentSeries = await fetchRecentHistoryRecoverySeries(company, options, diagnostics);
    const recovery = validateAndMergeRecentHistory(series, recentSeries, {
      requiredLatestDate: validation.benchmarkLatestDate,
      minimumOverlapCandles: options.historyFreshnessRecoveryMinimumOverlapCandles ?? 5,
      maximumOverlapRawCloseDeviationPct: options.historyFreshnessRecoveryMaximumOverlapDeviationPct ?? 0.5,
    });
    if (recovery.ready && recovery.series) {
      series = recovery.series;
      validation = validateHistoryAgainstSnapshot(series, options.marketSnapshot, company, benchmarkSeries, options);
      validation = {
        ...validation,
        freshnessRecovery: {
          contract: recovery.contract,
          policyVersion: recovery.policyVersion,
          status: recovery.status,
          baseLatestDate: recovery.baseLatestDate,
          recoveredLatestDate: recovery.recentLatestDate,
          requiredLatestDate: recovery.requiredLatestDate,
          overlapCount: recovery.overlapCount,
          maximumOverlapRawCloseDeviationPct: recovery.maximumOverlapRawCloseDeviationPct,
          thresholds: recovery.thresholds,
        },
      };
      diagnostics.push({
        code: validation.ready ? 'MARKET_HISTORY_FRESHNESS_RECOVERED' : 'MARKET_HISTORY_FRESHNESS_RECOVERY_POST_MERGE_VALIDATION_FAILED',
        companyId: company.companyId,
        symbol: company.primaryListing?.symbol || null,
        staleLatestDate,
        recoveredLatestDate: recovery.recentLatestDate,
        benchmarkLatestDate: recovery.requiredLatestDate,
        overlapCount: recovery.overlapCount,
        maximumOverlapRawCloseDeviationPct: recovery.maximumOverlapRawCloseDeviationPct,
        finalValidationReason: validation.reason,
      });
    } else {
      diagnostics.push({
        code: 'MARKET_HISTORY_FRESHNESS_RECOVERY_REJECTED',
        companyId: company.companyId,
        symbol: company.primaryListing?.symbol || null,
        staleLatestDate,
        recentLatestDate: recovery.recentLatestDate,
        benchmarkLatestDate: recovery.requiredLatestDate,
        overlapCount: recovery.overlapCount,
        maximumOverlapRawCloseDeviationPct: recovery.maximumOverlapRawCloseDeviationPct,
        blockers: recovery.blockers,
      });
    }
  }`,
    'bounded history freshness recovery flow',
  );

  write('src/professional-market-data.js', source);
}

function patchManifestAssertions() {
  let source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.ok(manifest.testPatches.includes('apply-v1818-regime-factor-weight-governance.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1818-regime-factor-weight-governance.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1819-history-session-alignment.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1819-history-session-alignment.js');
  assert.equal(new Set(manifest.testPatches).size, 68);
  assert.equal(new Set(manifest.buildPatches).size, 67);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1819-history-session-alignment.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1819-history-session-alignment.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1820-yahoo-history-freshness-recovery.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1820-yahoo-history-freshness-recovery.js');
  assert.equal(new Set(manifest.testPatches).size, 69);
  assert.equal(new Set(manifest.buildPatches).size, 68);`,
    'v1820 manifest assertions',
  );
  write('test/v180-factor-production-observability-runtime.test.js', source);
}

function patchV1818RuntimeInvariant() {
  let source = read('test/forecast-regime-factor-governance-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.equal(manifest.testPatches.at(-1), 'apply-v1819-history-session-alignment.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1819-history-session-alignment.js');
  assert.equal(new Set(manifest.testPatches).size, 68);
  assert.equal(new Set(manifest.buildPatches).size, 67);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1819-history-session-alignment.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1819-history-session-alignment.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1820-yahoo-history-freshness-recovery.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1820-yahoo-history-freshness-recovery.js');
  assert.equal(new Set(manifest.testPatches).size, 69);
  assert.equal(new Set(manifest.buildPatches).size, 68);`,
    'v1818 runtime invariant after v1820',
  );
  write('test/forecast-regime-factor-governance-runtime.test.js', source);
}

patchProfessionalMarketData();
patchManifestAssertions();
patchV1818RuntimeInvariant();
console.log('Investor Control v1.8.0 validated Yahoo history freshness recovery applied.');
