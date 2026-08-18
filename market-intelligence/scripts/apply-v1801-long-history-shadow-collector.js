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
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 long-history collector patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(
    source,
    "import { buildShadowForecasts } from './shadow-forecast-engine.js';",
    "import { buildShadowForecasts } from './shadow-forecast-engine.js';\nimport { collectLongHistoryResearch } from './long-history-collector.js';",
    'long-history collector import after v1.8 shadow integration',
  );

  source = replaceRequired(
    source,
    `  const shadowForecasts = buildShadowForecasts({
    generatedAt,
    universe: expandedUniverse,
    researchDossiers,
    opportunityUniverse,
    historicalSeriesCollector,
    options,
  });`,
    `  const longHistoryResearch = await collectLongHistoryResearch({
    universe: expandedUniverse,
    researchDossiers,
    historicalSeriesCollector,
    options: { ...options, generatedAt },
  });
  const shadowForecasts = buildShadowForecasts({
    generatedAt,
    universe: expandedUniverse,
    researchDossiers,
    opportunityUniverse,
    historicalSeriesCollector,
    longHistoryResearchCollector: longHistoryResearch.collector,
    options,
  });`,
    'validated long-history collection before shadow forecasting',
  );

  source = replaceRequired(
    source,
    '    researchDossiers,\n    shadowForecastCount: shadowForecasts.length,\n    shadowForecasts,',
    '    researchDossiers,\n    longHistoryResearchSummary: longHistoryResearch.summary,\n    shadowForecastCount: shadowForecasts.length,\n    shadowForecasts,',
    'compact long-history report summary',
  );

  write('src/run-autonomous-intelligence.js', source);
}

patchAutonomousRunner();
console.log('Investor Control v1.8.0 validated long-history shadow collector applied.');
