import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 market-regime lineage patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchMarketRegimeValidator() {
  let source = read('src/forecast-market-regime.js');
  source = replaceRequired(
    source,
    "  if (snapshot.decisionImpact !== 'NONE') errors.push('MARKET_REGIME_DECISION_IMPACT_FORBIDDEN');",
    "  if (snapshot.decisionImpact !== 'NONE') errors.push('MARKET_REGIME_DECISION_IMPACT_FORBIDDEN');\n  if (Object.prototype.hasOwnProperty.call(snapshot, 'series') || Object.prototype.hasOwnProperty.call(snapshot, 'candles')) errors.push('MARKET_REGIME_RAW_SERIES_FORBIDDEN');",
    'market regime raw-series prohibition',
  );
  write('src/forecast-market-regime.js', source);
}

function patchDailyRunner() {
  let source = read('src/run-daily-intelligence.js');
  source = replaceRequired(
    source,
    `      if (historyResult.series?.usable && options.historicalSeriesCollector?.set) {
        options.historicalSeriesCollector.set(company.companyId, historyResult.series);
      }
      diagnostics.push(...(historyResult.diagnostics || []));`,
    `      if (historyResult.series?.usable && options.historicalSeriesCollector?.set) {
        options.historicalSeriesCollector.set(company.companyId, historyResult.series);
      }
      if (historyResult.benchmarkSeries?.usable && options.benchmarkSeriesCollector?.set) {
        options.benchmarkSeriesCollector.set(company.companyId, historyResult.benchmarkSeries);
      }
      diagnostics.push(...(historyResult.diagnostics || []));`,
    'internal benchmark series collector',
  );
  write('src/run-daily-intelligence.js', source);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(
    source,
    `  const historicalSeriesCollector = new Map();
  const baseReport = await runDailyIntelligence({ ...options, now: generatedAt, universe: expandedUniverse, historicalSeriesCollector, classificationSnapshots: discovery.classificationSnapshots || [] });`,
    `  const historicalSeriesCollector = new Map();
  const benchmarkSeriesCollector = new Map();
  const baseReport = await runDailyIntelligence({ ...options, now: generatedAt, universe: expandedUniverse, historicalSeriesCollector, benchmarkSeriesCollector, classificationSnapshots: discovery.classificationSnapshots || [] });`,
    'autonomous benchmark series collector',
  );
  source = replaceRequired(
    source,
    `    historicalSeriesCollector,
    longHistoryResearchCollector: longHistoryResearch.collector,
    options,`,
    `    historicalSeriesCollector,
    benchmarkSeriesCollector,
    longHistoryResearchCollector: longHistoryResearch.collector,
    options,`,
    'benchmark series into shadow forecasts',
  );
  write('src/run-autonomous-intelligence.js', source);
}

function patchShadowForecastEngine() {
  let source = read('src/shadow-forecast-engine.js');
  source = replaceRequired(
    source,
    "import { buildForecastFactorScore } from './forecast-factor-score.js';",
    "import { buildForecastFactorScore } from './forecast-factor-score.js';\nimport { buildForecastMarketRegimeSnapshot } from './forecast-market-regime.js';",
    'market regime builder import',
  );
  source = replaceRequired(
    source,
    `  const seriesCollector = input.historicalSeriesCollector instanceof Map ? input.historicalSeriesCollector : new Map();
  const longHistoryCollector = input.longHistoryResearchCollector instanceof Map ? input.longHistoryResearchCollector : new Map();`,
    `  const seriesCollector = input.historicalSeriesCollector instanceof Map ? input.historicalSeriesCollector : new Map();
  const benchmarkSeriesCollector = input.benchmarkSeriesCollector instanceof Map ? input.benchmarkSeriesCollector : new Map();
  const longHistoryCollector = input.longHistoryResearchCollector instanceof Map ? input.longHistoryResearchCollector : new Map();`,
    'shadow benchmark collector input',
  );
  source = replaceRequired(
    source,
    `    const canonicalSeries = seriesCollector.get(dossier.companyId) || null;
    const selectedHistory = selectPatternSeries(dossier.companyId, canonicalSeries, longHistoryCollector);`,
    `    const canonicalSeries = seriesCollector.get(dossier.companyId) || null;
    const benchmarkSeries = benchmarkSeriesCollector.get(dossier.companyId) || null;
    const marketRegimeSnapshot = benchmarkSeries ? buildForecastMarketRegimeSnapshot({
      series: benchmarkSeries,
      capturedAt: generatedAt,
      benchmarkSymbol: benchmarkSeries.providerSymbol || benchmarkSeries.symbol || null,
      minimumObservations: input.options?.marketRegimeMinimumObservations || 200,
    }) : null;
    const selectedHistory = selectPatternSeries(dossier.companyId, canonicalSeries, longHistoryCollector);`,
    'forecast-time benchmark regime snapshot',
  );
  source = replaceRequired(
    source,
    `      historySource: selectedHistory.source,
      existingFinalActionSnapshot: dossier.finalAction || null,`,
    `      historySource: selectedHistory.source,
      ...(marketRegimeSnapshot ? { marketRegimeSnapshot } : {}),
      existingFinalActionSnapshot: dossier.finalAction || null,`,
    'compact market regime on shadow forecast',
  );
  source = replaceRequired(
    source,
    `      diagnostics: [...selectedHistory.diagnostics, ...(diagnostic ? [diagnostic] : [])],`,
    `      diagnostics: [
        ...selectedHistory.diagnostics,
        ...(diagnostic ? [diagnostic] : []),
        ...(marketRegimeSnapshot && marketRegimeSnapshot.status !== 'REGIME_READY' ? [{
          code: 'MARKET_REGIME_SNAPSHOT_NOT_READY',
          blockers: marketRegimeSnapshot.blockers || [],
          benchmarkSymbol: marketRegimeSnapshot.benchmarkSymbol || null,
          message: 'Benchmark history did not satisfy the forecast-time market-regime research contract; no regime metadata may influence decisions.',
        }] : []),
      ],`,
    'market regime fail-closed diagnostic',
  );
  write('src/shadow-forecast-engine.js', source);
}

function patchForecastOutcomeLedger() {
  let source = read('src/forecast-outcome-ledger.js');
  source = replaceRequired(
    source,
    "import { classificationSnapshotByCompany, validateForecastClassificationSnapshot } from './forecast-classification-lineage.js';",
    "import { classificationSnapshotByCompany, validateForecastClassificationSnapshot } from './forecast-classification-lineage.js';\nimport { validateForecastMarketRegimeSnapshot } from './forecast-market-regime.js';",
    'forecast ledger market regime validator import',
  );
  source = replaceRequired(
    source,
    "export const FORECAST_OUTCOME_LEDGER_VERSION='2026-08-11.6';",
    "export const FORECAST_OUTCOME_LEDGER_VERSION='2026-08-12.1';",
    'forecast ledger market regime version',
  );
  source = replaceRequired(
    source,
    `classificationCandidate=classificationByCompany.get(shadow.companyId)||null,classificationValidation=classificationCandidate?validateForecastClassificationSnapshot(classificationCandidate,{companyId:shadow.companyId,instrumentId:shadow.instrumentId,forecastAt:shadow.generatedAt}):null,classificationSnapshot=classificationValidation?.ok?{...classificationCandidate}:null;records.push({`,
    `classificationCandidate=classificationByCompany.get(shadow.companyId)||null,classificationValidation=classificationCandidate?validateForecastClassificationSnapshot(classificationCandidate,{companyId:shadow.companyId,instrumentId:shadow.instrumentId,forecastAt:shadow.generatedAt}):null,classificationSnapshot=classificationValidation?.ok?{...classificationCandidate}:null,marketRegimeCandidate=shadow?.marketRegimeSnapshot||null,marketRegimeValidation=marketRegimeCandidate?validateForecastMarketRegimeSnapshot(marketRegimeCandidate,{forecastAt:shadow.generatedAt}):null,marketRegimeSnapshot=marketRegimeValidation?.ok?{...marketRegimeCandidate,metrics:{...(marketRegimeCandidate.metrics||{})}}:null;records.push({`,
    'forecast-time market regime validation',
  );
  source = replaceRequired(
    source,
    `listing:immutableListingSnapshot(dossier,shadow),...(classificationSnapshot?{classificationSnapshot}:{}),assetClass:`,
    `listing:immutableListingSnapshot(dossier,shadow),...(classificationSnapshot?{classificationSnapshot}:{}),...(marketRegimeSnapshot?{marketRegimeSnapshot}:{}),assetClass:`,
    'immutable market regime snapshot on new records only',
  );
  source = replaceRequired(
    source,
    `function preserveClassificationLineage(current,next){
  if(!current)return next;
  const copy={...next};
  if(Object.prototype.hasOwnProperty.call(current,'classificationSnapshot'))copy.classificationSnapshot=current.classificationSnapshot;
  else delete copy.classificationSnapshot;
  return copy;
}`,
    `function preserveClassificationLineage(current,next){
  if(!current)return next;
  const copy={...next};
  if(Object.prototype.hasOwnProperty.call(current,'classificationSnapshot'))copy.classificationSnapshot=current.classificationSnapshot;
  else delete copy.classificationSnapshot;
  if(Object.prototype.hasOwnProperty.call(current,'marketRegimeSnapshot'))copy.marketRegimeSnapshot=current.marketRegimeSnapshot;
  else delete copy.marketRegimeSnapshot;
  return copy;
}`,
    'no-backfill immutable market regime merge',
  );
  write('src/forecast-outcome-ledger.js', source);
}

function patchForecastOutcomeArchive() {
  let source = read('src/forecast-outcome-archive.js');
  source = replaceRequired(
    source,
    `    candidateClassificationSnapshotRecordCount: newRecords.filter((record) => Object.prototype.hasOwnProperty.call(record, 'classificationSnapshot')).length,`,
    `    candidateClassificationSnapshotRecordCount: newRecords.filter((record) => Object.prototype.hasOwnProperty.call(record, 'classificationSnapshot')).length,
    candidateMarketRegimeSnapshotRecordCount: newRecords.filter((record) => Object.prototype.hasOwnProperty.call(record, 'marketRegimeSnapshot')).length,`,
    'market regime archive observability',
  );
  write('src/forecast-outcome-archive.js', source);
}

function patchArchiveVerifier() {
  let source = read('scripts/verify-forecast-outcome-archive.js');
  source = replaceRequired(
    source,
    "import { validateForecastClassificationSnapshot } from '../src/forecast-classification-lineage.js';",
    "import { validateForecastClassificationSnapshot } from '../src/forecast-classification-lineage.js';\nimport { validateForecastMarketRegimeSnapshot } from '../src/forecast-market-regime.js';",
    'market regime archive verifier import',
  );
  source = replaceRequired(
    source,
    `    if (Object.prototype.hasOwnProperty.call(record, 'classificationSnapshot')) {
      const classificationValidation = validateForecastClassificationSnapshot(record.classificationSnapshot, record);
      for (const classificationError of classificationValidation.errors) errors.push(\`CLASSIFICATION_SNAPSHOT_INVALID:\${record?.forecastId || 'unknown'}:\${classificationError}\`);
    }
    if (!['OPEN', 'MATURED'].includes(record?.status))`,
    `    if (Object.prototype.hasOwnProperty.call(record, 'classificationSnapshot')) {
      const classificationValidation = validateForecastClassificationSnapshot(record.classificationSnapshot, record);
      for (const classificationError of classificationValidation.errors) errors.push(\`CLASSIFICATION_SNAPSHOT_INVALID:\${record?.forecastId || 'unknown'}:\${classificationError}\`);
    }
    if (Object.prototype.hasOwnProperty.call(record, 'marketRegimeSnapshot')) {
      const regimeValidation = validateForecastMarketRegimeSnapshot(record.marketRegimeSnapshot, record);
      for (const regimeError of regimeValidation.errors) errors.push(\`MARKET_REGIME_SNAPSHOT_INVALID:\${record?.forecastId || 'unknown'}:\${regimeError}\`);
    }
    if (!['OPEN', 'MATURED'].includes(record?.status))`,
    'optional strict market regime verification',
  );
  write('scripts/verify-forecast-outcome-archive.js', source);
}

function patchManifestAssertions() {
  let source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.ok(manifest.testPatches.includes('apply-v1813-athens-icb-classification-lineage.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1813-athens-icb-classification-lineage.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1814-oos-taxonomy-concentration.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1814-oos-taxonomy-concentration.js');
  assert.equal(new Set(manifest.testPatches).size, 63);
  assert.equal(new Set(manifest.buildPatches).size, 62);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1814-oos-taxonomy-concentration.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1814-oos-taxonomy-concentration.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1815-forecast-market-regime-lineage.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1815-forecast-market-regime-lineage.js');
  assert.equal(new Set(manifest.testPatches).size, 64);
  assert.equal(new Set(manifest.buildPatches).size, 63);`,
    'v1815 manifest assertions',
  );
  write('test/v180-factor-production-observability-runtime.test.js', source);
}

patchMarketRegimeValidator();
patchDailyRunner();
patchAutonomousRunner();
patchShadowForecastEngine();
patchForecastOutcomeLedger();
patchForecastOutcomeArchive();
patchArchiveVerifier();
patchManifestAssertions();
console.log('Investor Control v1.8.0 forecast-time market regime lineage applied.');
