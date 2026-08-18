import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, v) => fs.writeFileSync(path.join(root, p), v);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.5.2 capability-engine patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchDaily() {
  let source = read('src/run-daily-intelligence.js');
  source = replaceRequired(
    source,
    "import { buildInstrumentRoute } from './instrument-router.js';",
    "import { buildInstrumentRoute } from './instrument-router.js';\nimport { collectInstrumentCapabilities } from './instrument-capability-collector.js';\nimport { evaluateInstrumentCapabilities } from './instrument-capability-evaluator.js';",
    'capability engine imports',
  );
  source = replaceRequired(
    source,
    `  const instrumentProfiles = [];
  const instrumentRoutes = [];
  const documentLimit =`,
    `  const instrumentProfiles = [];
  const instrumentRoutes = [];
  const instrumentCapabilityPassports = [];
  const instrumentCapabilityEvaluations = [];
  const documentLimit =`,
    'capability output arrays',
  );
  source = replaceRequired(
    source,
    `    let fundamentalRisk = null;
    const instrumentProfile = buildInstrumentProfile(company);`,
    `    let fundamentalRisk = null;
    let instrumentCapabilities = null;
    let instrumentCapabilityEvaluation = null;
    const instrumentProfile = buildInstrumentProfile(company);`,
    'per-instrument capability state',
  );
  source = replaceRequired(
    source,
    `    if (fundamentalSnapshot) {
      fundamentalRisk = assessFundamentalRisk(`,
    `    if (fundamentalSnapshot) {
      fundamentalRisk = assessFundamentalRisk(`,
    'fundamental risk anchor',
  );
  const anchor = `      fundamentalRiskAssessments.push(fundamentalRisk);
    }

    try {
      const result = await collectCompanyEvidence`;
  const replacement = `      fundamentalRiskAssessments.push(fundamentalRisk);
    }

    try {
      instrumentCapabilities = await collectInstrumentCapabilities(company, instrumentProfile, {
        route: instrumentRoute,
        marketSnapshot,
        marketMetrics,
        providers: options.capabilityProviders || [],
        fetchImpl,
        now,
      });
      instrumentCapabilityPassports.push(instrumentCapabilities);
      diagnostics.push(...(instrumentCapabilities.diagnostics || []).map((item) => ({ ...item, companyId: item.companyId || company.companyId })));
      instrumentCapabilityEvaluation = evaluateInstrumentCapabilities(instrumentProfile, instrumentCapabilities);
      instrumentCapabilityEvaluations.push(instrumentCapabilityEvaluation);
    } catch (error) {
      diagnostics.push({
        code: 'INSTRUMENT_CAPABILITY_ENGINE_FAILED',
        companyId: company.companyId,
        assetClass: instrumentProfile.assetClass,
        analysisModel: instrumentProfile.analysisModel,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const result = await collectCompanyEvidence`;
  if (!source.includes(anchor)) throw new Error('v1.5.2 capability-engine patch failed: missing collection insertion anchor');
  source = source.replace(anchor, replacement);

  source = replaceRequired(
    source,
    `        instrumentRoute,
        generatedAt: now,`,
    `        instrumentRoute,
        instrumentCapabilities,
        instrumentCapabilityEvaluation,
        generatedAt: now,`,
    'capability passport dossier input',
  );
  source = replaceRequired(
    source,
    `    instrumentRouteCount: instrumentRoutes.length,
    instrumentRoutes,
    fundamentalSnapshotCount:`,
    `    instrumentRouteCount: instrumentRoutes.length,
    instrumentRoutes,
    instrumentCapabilityPassportCount: instrumentCapabilityPassports.length,
    instrumentCapabilityPassports,
    instrumentCapabilityEvaluationCount: instrumentCapabilityEvaluations.length,
    instrumentCapabilityEvaluations,
    fundamentalSnapshotCount:`,
    'capability report outputs',
  );
  write('src/run-daily-intelligence.js', source);
}

function patchDossier() {
  let source = read('src/research-dossier.js');
  source = replaceRequired(
    source,
    `    instrumentRoute: input.instrumentRoute || null,
    generatedAt,`,
    `    instrumentRoute: input.instrumentRoute || null,
    instrumentCapabilities: input.instrumentCapabilities || null,
    instrumentCapabilityEvaluation: input.instrumentCapabilityEvaluation || null,
    generatedAt,`,
    'dossier capability passport',
  );
  write('src/research-dossier.js', source);
}

patchDaily();
patchDossier();

for (const [file, invariants] of Object.entries({
  'src/run-daily-intelligence.js': ['collectInstrumentCapabilities', 'evaluateInstrumentCapabilities', 'instrumentCapabilityPassports', 'instrumentCapabilityEvaluations', 'INSTRUMENT_CAPABILITY_ENGINE_FAILED'],
  'src/research-dossier.js': ['instrumentCapabilities: input.instrumentCapabilities || null', 'instrumentCapabilityEvaluation: input.instrumentCapabilityEvaluation || null'],
})) {
  const source = read(file);
  for (const invariant of invariants) if (!source.includes(invariant)) throw new Error(`v1.5.2 verification failed: ${file} missing ${invariant}`);
}
console.log('Investor Control v1.5.2 Universal Capability Engine integrated.');
