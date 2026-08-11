import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 factor-production-observability patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(
    source,
    "import { buildForecastFactorWeightGovernanceStatus } from './forecast-factor-weight-governance.js';",
    "import { buildForecastFactorWeightGovernanceStatus } from './forecast-factor-weight-governance.js';\nimport { buildForecastFactorOperationalTelemetry } from './forecast-factor-production-safety.js';",
    'factor production telemetry import',
  );

  source = replaceRequired(
    source,
    `  const forecastFactorWeightGovernanceStatus = buildForecastFactorWeightGovernanceStatus({\n    generatedAt,\n    records: forecastOutcomeArchive.records,\n    attributionStatus: forecastFactorAttributionStatus,\n    options,\n  });\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    `  const forecastFactorWeightGovernanceStatus = buildForecastFactorWeightGovernanceStatus({\n    generatedAt,\n    records: forecastOutcomeArchive.records,\n    attributionStatus: forecastFactorAttributionStatus,\n    options,\n  });\n  const forecastFactorOperationalTelemetry = buildForecastFactorOperationalTelemetry({\n    forecastFactorLearningStatus,\n    forecastFactorAttributionStatus,\n    forecastFactorWeightGovernanceStatus,\n  });\n  if (typeof options.forecastOutcomeLedgerSink === 'function') {`,
    'factor production telemetry after governance',
  );

  source = replaceRequired(
    source,
    `      finalActionCount,\n      staleOutput: false,\n    },\n    autonomousPublicationCount:`,
    `      finalActionCount,\n      staleOutput: false,\n      ...forecastFactorOperationalTelemetry,\n    },\n    autonomousPublicationCount:`,
    'canonical production operational-health telemetry spread',
  );

  write('src/run-autonomous-intelligence.js', source);
}

function patchProductionVerifier() {
  let source = read('scripts/verify-production-output.js');
  source = replaceRequired(
    source,
    "import path from 'node:path';",
    "import path from 'node:path';\nimport { verifyForecastFactorProductionSafety } from '../src/forecast-factor-production-safety.js';",
    'production factor safety import',
  );
  source = replaceRequired(
    source,
    "if (!Number.isFinite(generated) || Math.abs(Date.now() - generated) > 3_600_000) fail('stale production output');",
    `if (!Number.isFinite(generated) || Math.abs(Date.now() - generated) > 3_600_000) fail('stale production output');\n\ntry {\n  verifyForecastFactorProductionSafety(report);\n} catch (error) {\n  fail(error instanceof Error ? error.message : String(error));\n}`,
    'production factor safety gate',
  );
  source = replaceRequired(
    source,
    "  athensCandidateAudit: 'REQUIRED'",
    "  athensCandidateAudit: 'REQUIRED',\n  factorResearchGovernanceSafety: 'REQUIRED'",
    'production verifier output marker',
  );
  write('scripts/verify-production-output.js', source);
}

patchAutonomousRunner();
patchProductionVerifier();
console.log('Investor Control v1.8.0 factor production observability and safety contract applied.');
