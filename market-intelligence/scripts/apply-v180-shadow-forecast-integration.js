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
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 shadow forecast patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchDailyRunner() {
  let source = read('src/run-daily-intelligence.js');
  source = replaceRequired(
    source,
    '      marketMetrics = historyResult.metrics || null;\n      diagnostics.push(...(historyResult.diagnostics || []));',
    '      marketMetrics = historyResult.metrics || null;\n      if (historyResult.series?.usable && options.historicalSeriesCollector?.set) {\n        options.historicalSeriesCollector.set(company.companyId, historyResult.series);\n      }\n      diagnostics.push(...(historyResult.diagnostics || []));',
    'internal historical series collector',
  );
  write('src/run-daily-intelligence.js', source);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(
    source,
    "import { buildSecFramesBroadEquityScreen } from './adapters/sec-frames-broad-equity-screen.js';",
    "import { buildSecFramesBroadEquityScreen } from './adapters/sec-frames-broad-equity-screen.js';\nimport { buildShadowForecasts } from './shadow-forecast-engine.js';",
    'shadow forecast import',
  );
  source = replaceRequired(
    source,
    '  const expandedUniverse = mergeUniverse(seedUniverse, discovery.discoveredCompanies, broadCompanies);\n  const baseReport = await runDailyIntelligence({ ...options, now: generatedAt, universe: expandedUniverse });',
    '  const expandedUniverse = mergeUniverse(seedUniverse, discovery.discoveredCompanies, broadCompanies);\n  const historicalSeriesCollector = new Map();\n  const baseReport = await runDailyIntelligence({ ...options, now: generatedAt, universe: expandedUniverse, historicalSeriesCollector });',
    'autonomous historical series collection',
  );
  source = replaceRequired(
    source,
    '  const opportunitiesFeed = buildOpportunitiesFeed(researchDossiers, { generatedAt });',
    '  const shadowForecasts = buildShadowForecasts({\n    generatedAt,\n    universe: expandedUniverse,\n    researchDossiers,\n    opportunityUniverse,\n    historicalSeriesCollector,\n    options,\n  });\n  const opportunitiesFeed = buildOpportunitiesFeed(researchDossiers, { generatedAt });',
    'shadow forecast generation after hunter reconciliation',
  );
  source = replaceRequired(
    source,
    '    researchDossiers,\n    opportunitiesFeed,\n    finalActionCount,',
    '    researchDossiers,\n    shadowForecastCount: shadowForecasts.length,\n    shadowForecasts,\n    opportunitiesFeed,\n    finalActionCount,',
    'shadow forecast report output',
  );
  write('src/run-autonomous-intelligence.js', source);
}

patchDailyRunner();
patchAutonomousRunner();
console.log('Investor Control v1.8.0 shadow historical forecast integration applied.');
