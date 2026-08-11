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
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 learning-status patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(
    source,
    "import { collectDueForecastOutcomeHistory } from './forecast-outcome-maturation.js';",
    "import { collectDueForecastOutcomeHistory } from './forecast-outcome-maturation.js';\nimport { buildForecastLearningStatus } from './forecast-learning-status.js';",
    'forecast learning status import after maturation collector',
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
  });
  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    `  const forecastOutcomeArchive = runForecastOutcomeArchiveCycle({
    generatedAt,
    existingRecords: options.forecastOutcomeLedgerRecords || [],
    shadowForecasts,
    researchDossiers,
    historicalSeriesCollector,
    options,
  });
  const forecastLearningStatus = buildForecastLearningStatus({
    generatedAt,
    records: forecastOutcomeArchive.records,
    options,
  });
  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    'learning status after archive maturation',
  );

  source = replaceRequired(
    source,
    '    forecastOutcomeLedgerSummary: forecastOutcomeArchive.summary,\n    forecastOutcomeMaturationSummary: forecastOutcomeMaturation.summary,\n    shadowForecastCount: shadowForecasts.length,',
    '    forecastOutcomeLedgerSummary: forecastOutcomeArchive.summary,\n    forecastOutcomeMaturationSummary: forecastOutcomeMaturation.summary,\n    forecastLearningStatus,\n    shadowForecastCount: shadowForecasts.length,',
    'forecast learning status report contract',
  );

  write('src/run-autonomous-intelligence.js', source);
}

patchAutonomousRunner();
console.log('Investor Control v1.8.0 forecast learning-status contract applied.');
