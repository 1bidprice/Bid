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
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 factor-learning patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(
    source,
    "import { buildForecastLearningStatus } from './forecast-learning-status.js';",
    "import { buildForecastLearningStatus } from './forecast-learning-status.js';\nimport { buildForecastFactorLearningStatus } from './forecast-factor-learning-status.js';",
    'factor learning import after probabilistic learning status',
  );

  source = replaceRequired(
    source,
    `  const forecastLearningStatus = buildForecastLearningStatus({
    generatedAt,
    records: forecastOutcomeArchive.records,
    options,
  });
  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    `  const forecastLearningStatus = buildForecastLearningStatus({
    generatedAt,
    records: forecastOutcomeArchive.records,
    options,
  });
  const forecastFactorLearningStatus = buildForecastFactorLearningStatus({
    generatedAt,
    records: forecastOutcomeArchive.records,
    options,
  });
  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    'factor learning status after archive maturation',
  );

  source = replaceRequired(
    source,
    '    forecastLearningStatus,\n    shadowForecastCount: shadowForecasts.length,',
    '    forecastLearningStatus,\n    forecastFactorLearningStatus,\n    shadowForecastCount: shadowForecasts.length,',
    'factor learning status report contract',
  );

  write('src/run-autonomous-intelligence.js', source);
}

patchAutonomousRunner();
console.log('Investor Control v1.8.0 factor OOS learning-status contract applied.');
