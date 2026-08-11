import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 forecast-classification patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchSecSubmissions() {
  let source = read('src/adapters/sec-submissions.js');
  source = replaceRequired(
    source,
    "import { contentHash } from '../content-hash.js';",
    "import { contentHash } from '../content-hash.js';\nimport { buildSecForecastClassificationSnapshot } from '../forecast-classification-lineage.js';",
    'SEC classification builder import',
  );
  source = replaceRequired(
    source,
    `  const retrievedAt = new Date(options.retrievedAt || Date.now()).toISOString();
  const records = [];`,
    `  const retrievedAt = new Date(options.retrievedAt || Date.now()).toISOString();
  const classificationResult = buildSecForecastClassificationSnapshot(company, payload, { capturedAt: retrievedAt });
  const records = [];`,
    'SEC classification capture from existing submissions response',
  );
  source = replaceRequired(
    source,
    '  return { records, diagnostics: [] };',
    '  return { records, diagnostics: classificationResult.diagnostics, classificationSnapshot: classificationResult.snapshot };',
    'SEC classification return contract',
  );
  write('src/adapters/sec-submissions.js', source);
}

function patchDailyRunner() {
  let source = read('src/run-daily-intelligence.js');
  source = replaceRequired(
    source,
    '  const documentLimit =',
    '  const classificationSnapshots = [];\n  const documentLimit =',
    'daily classification snapshot accumulator',
  );
  source = replaceRequired(
    source,
    `      diagnostics.push(...(result.diagnostics || []));

      const officialRecords = [];`,
    `      diagnostics.push(...(result.diagnostics || []));
      if (result.classificationSnapshot) classificationSnapshots.push(result.classificationSnapshot);

      const officialRecords = [];`,
    'daily separate classification collection',
  );
  source = replaceRequired(
    source,
    `    universe: universe.map((company) => ({
      companyId: company.companyId,
      legalName: company.legalName,
      primaryListing: company.primaryListing,
    })),
    evidenceCount: evidence.length,`,
    `    universe: universe.map((company) => ({
      companyId: company.companyId,
      legalName: company.legalName,
      primaryListing: company.primaryListing,
    })),
    classificationSnapshotCount: classificationSnapshots.length,
    classificationSnapshots,
    evidenceCount: evidence.length,`,
    'daily classification report metadata',
  );
  write('src/run-daily-intelligence.js', source);
}

function patchForecastOutcomeLedger() {
  let source = read('src/forecast-outcome-ledger.js');
  source = replaceRequired(
    source,
    "import { evaluateForecastCalibration } from './forecast-calibration.js';",
    "import { evaluateForecastCalibration } from './forecast-calibration.js';\nimport { classificationSnapshotByCompany, validateForecastClassificationSnapshot } from './forecast-classification-lineage.js';",
    'forecast ledger classification imports',
  );
  source = replaceRequired(
    source,
    "export const FORECAST_OUTCOME_LEDGER_VERSION='2026-08-11.5';",
    "export const FORECAST_OUTCOME_LEDGER_VERSION='2026-08-11.6';",
    'forecast ledger classification version',
  );
  source = replaceRequired(
    source,
    'export function createLiveShadowForecastRecords(shadows=[],dossiers=[],options={}){const dm=dossierMap(dossiers),records=[];',
    'export function createLiveShadowForecastRecords(shadows=[],dossiers=[],options={}){const dm=dossierMap(dossiers),classificationByCompany=classificationSnapshotByCompany(options.classificationSnapshots||[]),records=[];',
    'classification map for new forecasts',
  );
  source = replaceRequired(
    source,
    'factorResearch=shadow?.multiFactorResearch?.horizons?.[horizon]||null,factorScore=factorResearch?.factorScore||null,featureVector=factorResearch?.featureVector||null;records.push({',
    "factorResearch=shadow?.multiFactorResearch?.horizons?.[horizon]||null,factorScore=factorResearch?.factorScore||null,featureVector=factorResearch?.featureVector||null,classificationCandidate=classificationByCompany.get(shadow.companyId)||null,classificationValidation=classificationCandidate?validateForecastClassificationSnapshot(classificationCandidate,{companyId:shadow.companyId,instrumentId:shadow.instrumentId,forecastAt:shadow.generatedAt}):null,classificationSnapshot=classificationValidation?.ok?{...classificationCandidate}:null;records.push({",
    'forecast-time classification validation',
  );
  source = replaceRequired(
    source,
    'listing:immutableListingSnapshot(dossier,shadow),assetClass:',
    'listing:immutableListingSnapshot(dossier,shadow),...(classificationSnapshot?{classificationSnapshot}:{}),assetClass:',
    'immutable classification snapshot on new records only',
  );
  source = replaceRequired(
    source,
    "export function mergeForecastOutcomeLedger(existing=[],incoming=[]){const map=new Map();for(const r of[...(Array.isArray(existing)?existing:[]),...(Array.isArray(incoming)?incoming:[])]){if(!r?.forecastId)continue;const cur=map.get(r.forecastId);if(!cur||(cur.status!=='MATURED'&&r.status==='MATURED'))map.set(r.forecastId,r);}return[...map.values()].sort((a,b)=>String(a.forecastAt).localeCompare(String(b.forecastAt))||String(a.forecastId).localeCompare(String(b.forecastId)));}",
    `function preserveClassificationLineage(current,next){
  if(!current)return next;
  const copy={...next};
  if(Object.prototype.hasOwnProperty.call(current,'classificationSnapshot'))copy.classificationSnapshot=current.classificationSnapshot;
  else delete copy.classificationSnapshot;
  return copy;
}
export function mergeForecastOutcomeLedger(existing=[],incoming=[]){const map=new Map();for(const r of[...(Array.isArray(existing)?existing:[]),...(Array.isArray(incoming)?incoming:[])]){if(!r?.forecastId)continue;const cur=map.get(r.forecastId);if(!cur)map.set(r.forecastId,r);else if(cur.status!=='MATURED'&&r.status==='MATURED')map.set(r.forecastId,preserveClassificationLineage(cur,r));}return[...map.values()].sort((a,b)=>String(a.forecastAt).localeCompare(String(b.forecastAt))||String(a.forecastId).localeCompare(String(b.forecastId)));}`,
    'no-backfill immutable classification merge',
  );
  write('src/forecast-outcome-ledger.js', source);
}

function patchForecastOutcomeArchive() {
  let source = read('src/forecast-outcome-archive.js');
  source = replaceRequired(
    source,
    `  const existing = Array.isArray(input.existingRecords) ? input.existingRecords : [];
  const newRecords = createLiveShadowForecastRecords(input.shadowForecasts, input.researchDossiers, input.options || {});`,
    `  const existing = Array.isArray(input.existingRecords) ? input.existingRecords : [];
  const recordOptions = {
    ...(input.options || {}),
    classificationSnapshots: input.classificationSnapshots || input.options?.classificationSnapshots || [],
  };
  const newRecords = createLiveShadowForecastRecords(input.shadowForecasts, input.researchDossiers, recordOptions);`,
    'archive classification input',
  );
  source = replaceRequired(
    source,
    '      candidateRecordCount: newRecords.length,',
    "      candidateRecordCount: newRecords.length,\n      candidateClassificationSnapshotRecordCount: newRecords.filter((record) => Object.prototype.hasOwnProperty.call(record, 'classificationSnapshot')).length,",
    'classification archive observability',
  );
  write('src/forecast-outcome-archive.js', source);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
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
    `  const forecastOutcomeArchive = runForecastOutcomeArchiveCycle({
    generatedAt,
    existingRecords: options.forecastOutcomeLedgerRecords || [],
    shadowForecasts,
    researchDossiers,
    classificationSnapshots: baseReport.classificationSnapshots || [],
    historicalSeriesCollector,
    options,
  });`,
    'classification lineage into archive only',
  );
  write('src/run-autonomous-intelligence.js', source);
}

function patchArchiveVerifier() {
  let source = read('scripts/verify-forecast-outcome-archive.js');
  source = replaceRequired(
    source,
    "import path from 'node:path';",
    "import path from 'node:path';\nimport { validateForecastClassificationSnapshot } from '../src/forecast-classification-lineage.js';",
    'classification verifier import',
  );
  source = replaceRequired(
    source,
    `    if (record?.decisionImpact !== 'NONE') errors.push(\`DECISION_IMPACT_MUST_BE_NONE:\${record?.forecastId || 'unknown'}\`);
    if (!['OPEN', 'MATURED'].includes(record?.status))`,
    `    if (record?.decisionImpact !== 'NONE') errors.push(\`DECISION_IMPACT_MUST_BE_NONE:\${record?.forecastId || 'unknown'}\`);
    if (Object.prototype.hasOwnProperty.call(record, 'classificationSnapshot')) {
      const classificationValidation = validateForecastClassificationSnapshot(record.classificationSnapshot, record);
      for (const classificationError of classificationValidation.errors) {
        errors.push(\`CLASSIFICATION_SNAPSHOT_INVALID:\${record?.forecastId || 'unknown'}:\${classificationError}\`);
      }
    }
    if (!['OPEN', 'MATURED'].includes(record?.status))`,
    'optional strict classification verification',
  );
  write('scripts/verify-forecast-outcome-archive.js', source);
}

function patchManifestAssertions() {
  let source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(
    source,
    `  assert.ok(manifest.testPatches.includes('apply-v1810-oos-outcome-window-independence.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1810-oos-outcome-window-independence.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1811-oos-instrument-concentration.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1811-oos-instrument-concentration.js');
  assert.equal(new Set(manifest.testPatches).size, 60);
  assert.equal(new Set(manifest.buildPatches).size, 59);`,
    `  assert.ok(manifest.testPatches.includes('apply-v1811-oos-instrument-concentration.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1811-oos-instrument-concentration.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1812-forecast-classification-lineage.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1812-forecast-classification-lineage.js');
  assert.equal(new Set(manifest.testPatches).size, 61);
  assert.equal(new Set(manifest.buildPatches).size, 60);`,
    'v1812 manifest assertions',
  );
  write('test/v180-factor-production-observability-runtime.test.js', source);
}

patchSecSubmissions();
patchDailyRunner();
patchForecastOutcomeLedger();
patchForecastOutcomeArchive();
patchAutonomousRunner();
patchArchiveVerifier();
patchManifestAssertions();
console.log('Investor Control v1.8.0 forecast-time canonical classification lineage applied.');
