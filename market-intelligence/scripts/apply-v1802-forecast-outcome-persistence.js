import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 forecast archive patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(
    source,
    "import { collectLongHistoryResearch } from './long-history-collector.js';",
    "import { collectLongHistoryResearch } from './long-history-collector.js';\nimport { runForecastOutcomeArchiveCycle } from './forecast-outcome-archive.js';",
    'forecast archive import after long-history collector',
  );

  source = replaceRequired(
    source,
    `  const shadowForecasts = buildShadowForecasts({
    generatedAt,
    universe: expandedUniverse,
    researchDossiers,
    opportunityUniverse,
    historicalSeriesCollector,
    longHistoryResearchCollector: longHistoryResearch.collector,
    options,
  });`,
    `  const shadowForecasts = buildShadowForecasts({
    generatedAt,
    universe: expandedUniverse,
    researchDossiers,
    opportunityUniverse,
    historicalSeriesCollector,
    longHistoryResearchCollector: longHistoryResearch.collector,
    options,
  });
  const forecastOutcomeArchive = runForecastOutcomeArchiveCycle({
    generatedAt,
    existingRecords: options.forecastOutcomeLedgerRecords || [],
    shadowForecasts,
    researchDossiers,
    historicalSeriesCollector,
    options,
  });
  if (typeof options.forecastOutcomeLedgerSink === 'function') {
    await options.forecastOutcomeLedgerSink(forecastOutcomeArchive);
  }`,
    'persistent forecast outcome archive cycle',
  );

  source = replaceRequired(
    source,
    '    longHistoryResearchSummary: longHistoryResearch.summary,\n    shadowForecastCount: shadowForecasts.length,',
    '    longHistoryResearchSummary: longHistoryResearch.summary,\n    forecastOutcomeLedgerSummary: forecastOutcomeArchive.summary,\n    shadowForecastCount: shadowForecasts.length,',
    'forecast outcome summary without raw archive serialization',
  );

  source = replaceRequired(
    source,
    `async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/autonomous-intelligence.json');
  const report = await runAutonomousIntelligence();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, \`${'${JSON.stringify(report, null, 2)}'}\\n\`, 'utf8');`,
    `async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/autonomous-intelligence.json');
  const ledgerInputPath = process.env.FORECAST_OUTCOME_LEDGER_PATH
    ? path.resolve(process.cwd(), process.env.FORECAST_OUTCOME_LEDGER_PATH)
    : null;
  const ledgerOutputPath = path.resolve(process.cwd(), process.env.FORECAST_OUTCOME_LEDGER_OUTPUT || 'out/forecast-outcome-ledger.json');
  let forecastOutcomeLedgerRecords = [];
  if (ledgerInputPath) {
    try {
      const existingArchive = JSON.parse(await readFile(ledgerInputPath, 'utf8'));
      forecastOutcomeLedgerRecords = Array.isArray(existingArchive?.records) ? existingArchive.records : [];
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  let persistedForecastOutcomeArchive = null;
  const report = await runAutonomousIntelligence({
    forecastOutcomeLedgerRecords,
    forecastOutcomeLedgerSink: (archive) => { persistedForecastOutcomeArchive = archive; },
  });
  if (!persistedForecastOutcomeArchive) throw new Error('Forecast outcome archive cycle did not produce a persistence payload');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, \`${'${JSON.stringify(report, null, 2)}'}\\n\`, 'utf8');
  await mkdir(path.dirname(ledgerOutputPath), { recursive: true });
  await writeFile(ledgerOutputPath, \`${'${JSON.stringify(persistedForecastOutcomeArchive, null, 2)}'}\\n\`, 'utf8');`,
    'CLI forecast archive persistence',
  );

  write('src/run-autonomous-intelligence.js', source);
}

patchAutonomousRunner();
console.log('Investor Control v1.8.0 persistent forecast outcome archive applied.');
