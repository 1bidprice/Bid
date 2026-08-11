import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 factor-weight-governance patch failed: missing ${label}`);
  return source.replace(from, to);
}

let source = read('src/run-autonomous-intelligence.js');
source = replaceRequired(
  source,
  "import { buildForecastFactorAttributionStatus } from './forecast-factor-attribution.js';",
  "import { buildForecastFactorAttributionStatus } from './forecast-factor-attribution.js';\nimport { buildForecastFactorWeightGovernanceStatus } from './forecast-factor-weight-governance.js';",
  'factor weight governance import',
);

source = replaceRequired(
  source,
  `  const forecastFactorAttributionStatus = buildForecastFactorAttributionStatus({\n    generatedAt,\n    records: forecastOutcomeArchive.records,\n    options,\n  });\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
  `  const forecastFactorAttributionStatus = buildForecastFactorAttributionStatus({\n    generatedAt,\n    records: forecastOutcomeArchive.records,\n    options,\n  });\n  const forecastFactorWeightGovernanceStatus = buildForecastFactorWeightGovernanceStatus({\n    generatedAt,\n    records: forecastOutcomeArchive.records,\n    attributionStatus: forecastFactorAttributionStatus,\n    options,\n  });\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
  'factor weight governance after attribution',
);

source = replaceRequired(
  source,
  '    forecastFactorAttributionStatus,\n    shadowForecastCount: shadowForecasts.length,',
  '    forecastFactorAttributionStatus,\n    forecastFactorWeightGovernanceStatus,\n    shadowForecastCount: shadowForecasts.length,',
  'factor weight governance report contract',
);

write('src/run-autonomous-intelligence.js', source);
console.log('Investor Control v1.8.0 manual factor weight governance contract applied.');
