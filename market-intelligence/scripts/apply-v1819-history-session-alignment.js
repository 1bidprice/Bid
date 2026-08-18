import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 history-session-alignment patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchProfessionalMarketData() {
  let source = read('src/professional-market-data.js');

  source = replaceRequired(
    source,
    'function validateHistoryAgainstSnapshot(series, snapshot, company, options = {}) {',
    'function validateHistoryAgainstSnapshot(series, snapshot, company, benchmarkSeries = null, options = {}) {',
    'history validator benchmark argument',
  );

  source = replaceRequired(
    source,
    `  const quoteTimestamp = new Date(snapshot.quoteAt || snapshot.generatedAt || 0).getTime();
  const quoteDate = Number.isFinite(quoteTimestamp) ? new Date(quoteTimestamp).toISOString().slice(0, 10) : null;
  const latestDate = dateKey(latest.timestamp);
  const reference = latestDate && quoteDate && latestDate === quoteDate
    ? currentPrice
    : previousClose ?? currentPrice;
  const deviationPct = reference > 0 ? Math.abs((rawClose / reference) - 1) * 100 : null;
  const tolerancePct = Number(options.historyCrossCheckTolerancePct ?? (isAthensListing(company) ? 8 : 5));`,
    `  const quoteTimestamp = new Date(snapshot.quoteAt || snapshot.generatedAt || 0).getTime();
  const quoteDate = Number.isFinite(quoteTimestamp) ? new Date(quoteTimestamp).toISOString().slice(0, 10) : null;
  const latestDate = dateKey(latest.timestamp);
  const benchmarkLatest = benchmarkSeries?.candles?.at(-1) || null;
  const benchmarkLatestDate = dateKey(benchmarkLatest?.timestamp);
  const tolerancePct = Number(options.historyCrossCheckTolerancePct ?? (isAthensListing(company) ? 8 : 5));

  if (latestDate && benchmarkLatestDate && latestDate !== benchmarkLatestDate) {
    return {
      ready: false,
      reference: null,
      rawClose,
      deviationPct: null,
      tolerancePct,
      latestDate,
      quoteDate,
      benchmarkLatestDate,
      reason: latestDate < benchmarkLatestDate
        ? 'HISTORY_LAGS_BENCHMARK_SESSION'
        : 'HISTORY_AHEAD_OF_BENCHMARK_SESSION',
    };
  }

  const reference = latestDate && quoteDate && latestDate === quoteDate
    ? currentPrice
    : previousClose ?? currentPrice;
  const deviationPct = reference > 0 ? Math.abs((rawClose / reference) - 1) * 100 : null;`,
    'benchmark-aligned history validation',
  );

  source = replaceRequired(
    source,
    `    latestDate,
    quoteDate,
    reason: deviationPct !== null && deviationPct <= tolerancePct ? 'MATCHED' : 'PRICE_DEVIATION_EXCEEDED',`,
    `    latestDate,
    quoteDate,
    benchmarkLatestDate,
    reason: deviationPct !== null && deviationPct <= tolerancePct ? 'MATCHED' : 'PRICE_DEVIATION_EXCEEDED',`,
    'history validation benchmark date output',
  );

  source = replaceRequired(
    source,
    '  const validation = validateHistoryAgainstSnapshot(series, options.marketSnapshot, company, options);',
    '  const validation = validateHistoryAgainstSnapshot(series, options.marketSnapshot, company, benchmarkSeries, options);',
    'history validator benchmark wiring',
  );

  source = replaceRequired(
    source,
    `      deviationPct: validation.deviationPct,
      tolerancePct: validation.tolerancePct,
      reason: validation.reason,`,
    `      deviationPct: validation.deviationPct,
      tolerancePct: validation.tolerancePct,
      latestDate: validation.latestDate || null,
      quoteDate: validation.quoteDate || null,
      benchmarkLatestDate: validation.benchmarkLatestDate || null,
      reason: validation.reason,`,
    'history diagnostic session dates',
  );

  write('src/professional-market-data.js', source);
}

function patchManifestAssertions() {
  let source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.ok(manifest.testPatches.includes('apply-v1817-regime-conditional-factor-attribution.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1817-regime-conditional-factor-attribution.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1818-regime-factor-weight-governance.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1818-regime-factor-weight-governance.js');
  assert.equal(new Set(manifest.testPatches).size, 67);
  assert.equal(new Set(manifest.buildPatches).size, 66);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1818-regime-factor-weight-governance.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1818-regime-factor-weight-governance.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1819-history-session-alignment.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1819-history-session-alignment.js');
  assert.equal(new Set(manifest.testPatches).size, 68);
  assert.equal(new Set(manifest.buildPatches).size, 67);`,
    'v1819 manifest assertions',
  );
  write('test/v180-factor-production-observability-runtime.test.js', source);
}

patchProfessionalMarketData();
patchManifestAssertions();
console.log('Investor Control v1.8.0 benchmark-aligned history session validation applied.');
