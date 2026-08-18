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
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 outcome maturation patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(
    source,
    "import { runForecastOutcomeArchiveCycle } from './forecast-outcome-archive.js';",
    "import { runForecastOutcomeArchiveCycle } from './forecast-outcome-archive.js';\nimport { collectDueForecastOutcomeHistory } from './forecast-outcome-maturation.js';",
    'outcome maturation import after persistence archive',
  );

  source = replaceRequired(
    source,
    `  const forecastOutcomeArchive = runForecastOutcomeArchiveCycle({
    generatedAt,
    existingRecords: options.forecastOutcomeLedgerRecords || [],
    shadowForecasts,
    researchDossiers,
    historicalSeriesCollector,
    options,
  });`,
    `  const forecastOutcomeMaturation = await collectDueForecastOutcomeHistory({
    generatedAt,
    existingRecords: options.forecastOutcomeLedgerRecords || [],
    universe: expandedUniverse,
    historicalSeriesCollector,
    options,
  });
  for (const [companyId, series] of forecastOutcomeMaturation.collector) {
    if (!historicalSeriesCollector.get(companyId)?.usable) historicalSeriesCollector.set(companyId, series);
  }
  const forecastOutcomeArchive = runForecastOutcomeArchiveCycle({
    generatedAt,
    existingRecords: options.forecastOutcomeLedgerRecords || [],
    shadowForecasts,
    researchDossiers,
    historicalSeriesCollector,
    options,
  });`,
    'due outcome history before archive maturation',
  );

  source = replaceRequired(
    source,
    '    forecastOutcomeLedgerSummary: forecastOutcomeArchive.summary,\n    shadowForecastCount: shadowForecasts.length,',
    '    forecastOutcomeLedgerSummary: forecastOutcomeArchive.summary,\n    forecastOutcomeMaturationSummary: forecastOutcomeMaturation.summary,\n    shadowForecastCount: shadowForecasts.length,',
    'compact outcome maturation telemetry',
  );

  write('src/run-autonomous-intelligence.js', source);
}

patchAutonomousRunner();
console.log('Investor Control v1.8.0 due forecast outcome maturation backstop applied.');
