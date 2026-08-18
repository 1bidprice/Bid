import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const V1840_IMMUTABLE_OUTCOME_LEDGER_CONTRACT = 'PROSPECTIVE_HOLDOUT_V2_IMMUTABLE_OUTCOME_LEDGER_V1';
export const V1840_IMMUTABLE_OUTCOME_LEDGER_VERSION = '2026-08-17.1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function sha256(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function keyOf(entry = {}) { return `${entry.captureHash || ''}|${entry.companyId || ''}|${entry.horizon || ''}`; }
function comparableOutcome(entry = {}) {
  return {
    status: entry.status || null,
    outcomeKnownAt: entry.outcomeKnownAt || null,
    positiveOutcome: entry.positiveOutcome ?? null,
    realizedReturnPct: entry.realizedReturnPct ?? null,
    benchmarkReturnPct: entry.benchmarkReturnPct ?? null,
    benchmarkRelativeReturnPct: entry.benchmarkRelativeReturnPct ?? null,
  };
}
function allowedEntry(entry = {}) {
  return {
    captureHash: entry.captureHash || null,
    holdoutId: entry.holdoutId || null,
    companyId: entry.companyId || null,
    symbol: entry.symbol || null,
    horizon: entry.horizon || null,
    tradingDays: Number(entry.tradingDays || 0),
    featureAsOf: entry.featureAsOf || null,
    sourceCaptureVerified: entry.sourceCaptureVerified === true,
    status: entry.status || null,
    completedCompanySessionsAfterFeature: Number(entry.completedCompanySessionsAfterFeature || 0),
    completedBenchmarkSessionsAfterFeature: Number(entry.completedBenchmarkSessionsAfterFeature || 0),
    outcomeKnownAt: entry.outcomeKnownAt ?? null,
    positiveOutcome: entry.positiveOutcome ?? null,
    realizedReturnPct: entry.realizedReturnPct ?? null,
    benchmarkReturnPct: entry.benchmarkReturnPct ?? null,
    benchmarkRelativeReturnPct: entry.benchmarkRelativeReturnPct ?? null,
  };
}
function isMatured(entry = {}) { return entry.status === 'MATURED_OUTCOME_AVAILABLE'; }
function isPending(entry = {}) { return entry.status === 'PENDING_HORIZON_MATURATION'; }

export function verifyV1840Ledger(ledger = {}) {
  const blockers = [];
  if (ledger?.contract !== V1840_IMMUTABLE_OUTCOME_LEDGER_CONTRACT) blockers.push('V1840_LEDGER_CONTRACT_CHANGED');
  if (ledger?.holdoutId !== 'investor-control-us-equity-unseen-holdout-2026q3-v2' || ledger?.protocolContract !== 'PROSPECTIVE_UNSEEN_HOLDOUT_PROTOCOL_V2') blockers.push('V1840_LEDGER_LINEAGE_CHANGED');
  if (!Array.isArray(ledger?.entries) || ledger.entries.length !== Number(ledger?.entryCount || 0)) blockers.push('V1840_LEDGER_ENTRY_COUNT_MISMATCH');
  const keys = new Set();
  for (const entry of ledger?.entries || []) {
    const key = keyOf(entry);
    if (!entry?.captureHash || !entry?.companyId || !entry?.horizon || keys.has(key)) blockers.push('V1840_LEDGER_ENTRY_KEY_INVALID_OR_DUPLICATE');
    keys.add(key);
    if (entry?.sourceCaptureVerified !== true) blockers.push('V1840_LEDGER_UNVERIFIED_CAPTURE_ENTRY');
    if (!isPending(entry) && !isMatured(entry)) blockers.push('V1840_LEDGER_ENTRY_STATUS_INVALID');
    if (isPending(entry) && (entry?.outcomeKnownAt !== null || entry?.positiveOutcome !== null || entry?.realizedReturnPct !== null || entry?.benchmarkReturnPct !== null || entry?.benchmarkRelativeReturnPct !== null)) blockers.push('V1840_LEDGER_PENDING_ENTRY_DISCLOSES_OUTCOME');
    if (isMatured(entry) && (!entry?.outcomeKnownAt || ![0, 1].includes(entry?.positiveOutcome) || !Number.isFinite(Number(entry?.realizedReturnPct)) || !Number.isFinite(Number(entry?.benchmarkReturnPct)) || !Number.isFinite(Number(entry?.benchmarkRelativeReturnPct)))) blockers.push('V1840_LEDGER_MATURED_ENTRY_INCOMPLETE');
    if (Object.hasOwn(entry, 'probabilityPositive') || Object.hasOwn(entry, 'rawPatternProbabilityPositive') || Object.hasOwn(entry, 'regimeKey') || Object.hasOwn(entry, 'modelVariant')) blockers.push('V1840_LEDGER_FORECAST_DATA_LEAKED_INTO_OUTCOME_STORE');
  }
  if (ledger?.maturedEntryCount + ledger?.pendingEntryCount !== ledger?.entryCount) blockers.push('V1840_LEDGER_STATUS_COUNTS_MISMATCH');
  if (ledger?.performanceMetricsIncluded !== false || ledger?.performancePeeked !== false || ledger?.evaluationGateOpened !== false) blockers.push('V1840_LEDGER_PRE_GATE_PERFORMANCE_PEEK');
  if (ledger?.automaticModelPromotionEnabled !== false || ledger?.decisionIntegrationEnabled !== false || ledger?.forecastMayInfluenceFinalAction !== false || ledger?.brokerExecutionEligible !== false || ledger?.decisionImpact !== 'NONE') blockers.push('V1840_LEDGER_AUTHORITY_BOUNDARY_BROKEN');
  if (ledger?.contentHashAlgorithm !== 'SHA256_CANONICAL_JSON' || !ledger?.contentHash) blockers.push('V1840_LEDGER_HASH_MISSING');
  const { contentHash: _hash, contentHashAlgorithm: _algorithm, ...core } = ledger || {};
  if (ledger?.contentHash !== sha256(core)) blockers.push('V1840_LEDGER_HASH_INVALID');
  return { verified: blockers.length === 0, blockers: [...new Set(blockers)] };
}

export function reduceV1840ImmutableOutcomeLedger(input = {}) {
  const current = input.currentMaturationArtifact || {};
  const previous = input.previousLedger || null;
  if (current?.contract !== 'PROSPECTIVE_HOLDOUT_V2_OUTCOME_MATURATION_V1'
      || current?.holdoutId !== 'investor-control-us-equity-unseen-holdout-2026q3-v2'
      || current?.protocolContract !== 'PROSPECTIVE_UNSEEN_HOLDOUT_PROTOCOL_V2'
      || current?.sourceCaptureVerificationFailureCount !== 0
      || current?.performanceMetricsIncluded !== false
      || current?.performancePeeked !== false
      || current?.evaluationGateOpened !== false) {
    throw new Error('v1840 refuses invalid or performance-exposed v1837 input');
  }
  if (previous) {
    const verification = verifyV1840Ledger(previous);
    if (!verification.verified) throw new Error(`v1840 refuses invalid previous ledger: ${verification.blockers.join(',')}`);
  }

  const previousMap = new Map((previous?.entries || []).map((entry) => [keyOf(entry), allowedEntry(entry)]));
  const currentMap = new Map((current?.outcomes || []).map((entry) => [keyOf(entry), allowedEntry(entry)]));
  for (const key of previousMap.keys()) {
    if (!currentMap.has(key)) throw new Error(`v1840 current maturation lost a previously ledgered tuple: ${key}`);
  }

  const entries = [];
  const driftDiagnostics = [];
  let newlyMaturedEntryCount = 0;
  let retainedMaturedEntryCount = 0;
  for (const [key, candidate] of [...currentMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const prior = previousMap.get(key) || null;
    if (!prior) {
      entries.push(candidate);
      if (isMatured(candidate)) newlyMaturedEntryCount += 1;
      continue;
    }
    if (isMatured(prior)) {
      entries.push(prior);
      retainedMaturedEntryCount += 1;
      if (JSON.stringify(comparableOutcome(prior)) !== JSON.stringify(comparableOutcome(candidate))) {
        driftDiagnostics.push({
          code: 'MATURED_OUTCOME_PROVIDER_DRIFT_DETECTED_IMMUTABLE_VALUE_RETAINED',
          tupleKey: key,
          priorOutcomeFingerprint: sha256(comparableOutcome(prior)),
          candidateOutcomeFingerprint: sha256(comparableOutcome(candidate)),
        });
      }
      continue;
    }
    if (isPending(prior) && isMatured(candidate)) {
      entries.push(candidate);
      newlyMaturedEntryCount += 1;
      continue;
    }
    entries.push(candidate);
  }

  const core = {
    format: 'investor-control-prospective-holdout-v2-immutable-outcome-ledger',
    version: 1,
    policyVersion: V1840_IMMUTABLE_OUTCOME_LEDGER_VERSION,
    contract: V1840_IMMUTABLE_OUTCOME_LEDGER_CONTRACT,
    sourceCommit: input.sourceCommit || null,
    holdoutId: current.holdoutId,
    protocolContract: current.protocolContract,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    previousLedgerContentHash: previous?.contentHash || null,
    sourceMaturationArtifactContentHash: current.contentHash || null,
    sourceCaptureCount: Number(current.captureCount || 0),
    entryCount: entries.length,
    maturedEntryCount: entries.filter(isMatured).length,
    pendingEntryCount: entries.filter(isPending).length,
    newlyMaturedEntryCount,
    retainedMaturedEntryCount,
    providerDriftDiagnosticCount: driftDiagnostics.length,
    providerDriftDiagnostics: driftDiagnostics,
    entries,
    mutationPolicy: 'FIRST_VERIFIED_MATURED_OUTCOME_IS_IMMUTABLE_PROVIDER_RESTATEMENTS_ARE_DIAGNOSTIC_ONLY',
    outcomeStorageMode: 'APPEND_ONLY_IMMUTABLE_AFTER_MATURATION',
    benchmarkRelativeOutcomeRequired: true,
    benchmarkFamily: 'SPY',
    modelProbabilitiesIncluded: false,
    rawPatternBaselinesIncluded: false,
    regimeKeysIncluded: false,
    performanceMetricsIncluded: false,
    performancePeeked: false,
    evaluationGateOpened: false,
    prospectiveResearchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
  const ledger = { ...core, contentHashAlgorithm: 'SHA256_CANONICAL_JSON', contentHash: sha256(core) };
  const verification = verifyV1840Ledger(ledger);
  if (!verification.verified) throw new Error(`v1840 produced invalid ledger: ${verification.blockers.join(',')}`);
  return ledger;
}

export function buildV1840MaturationCompatibilityView(ledger = {}) {
  const verification = verifyV1840Ledger(ledger);
  if (!verification.verified) throw new Error(`v1840 cannot build maturation view from invalid ledger: ${verification.blockers.join(',')}`);
  const core = {
    contract: 'PROSPECTIVE_HOLDOUT_V2_OUTCOME_MATURATION_V1',
    holdoutId: ledger.holdoutId,
    protocolContract: ledger.protocolContract,
    captureCount: ledger.sourceCaptureCount,
    sourceCaptureVerificationFailureCount: 0,
    outcomeTupleCount: ledger.entryCount,
    maturedOutcomeCount: ledger.maturedEntryCount,
    pendingOutcomeCount: ledger.pendingEntryCount,
    outcomes: ledger.entries,
    outcomeStorageMode: 'IMMUTABLE_V1840_LEDGER_COMPATIBILITY_VIEW',
    benchmarkRelativeOutcomeRequired: true,
    benchmarkFamily: 'SPY',
    modelProbabilitiesIncluded: false,
    rawPatternBaselinesIncluded: false,
    regimeKeysIncluded: false,
    performanceMetricsIncluded: false,
    performancePeeked: false,
    evaluationGateOpened: false,
    sourceImmutableLedgerContract: ledger.contract,
    sourceImmutableLedgerContentHash: ledger.contentHash,
  };
  return { ...core, contentHashAlgorithm: 'SHA256_CANONICAL_JSON', contentHash: sha256(core) };
}

async function main() {
  const ledgerOutputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1840-immutable-outcome-ledger.json');
  const viewOutputPath = path.resolve(process.cwd(), process.argv[3] || 'out/v1840-maturation-view.json');
  const currentPath = process.env.PROSPECTIVE_V2_MATURATION_ARTIFACT_PATH || process.argv[4];
  const previousPath = process.env.PREVIOUS_V1840_LEDGER_PATH || process.argv[5] || null;
  if (!currentPath) throw new Error('PROSPECTIVE_V2_MATURATION_ARTIFACT_PATH is required');
  const currentMaturationArtifact = JSON.parse(await readFile(path.resolve(process.cwd(), currentPath), 'utf8'));
  const previousLedger = previousPath ? JSON.parse(await readFile(path.resolve(process.cwd(), previousPath), 'utf8')) : null;
  const ledger = reduceV1840ImmutableOutcomeLedger({
    currentMaturationArtifact,
    previousLedger,
    sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT || null,
  });
  const view = buildV1840MaturationCompatibilityView(ledger);
  await mkdir(path.dirname(ledgerOutputPath), { recursive: true });
  await writeFile(ledgerOutputPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  await writeFile(viewOutputPath, `${JSON.stringify(view, null, 2)}\n`, 'utf8');
  console.log(`Wrote v1840 immutable outcome ledger to ${ledgerOutputPath}`);
  console.log(`Wrote v1840 maturation compatibility view to ${viewOutputPath}`);
  console.log(`Entries=${ledger.entryCount}; matured=${ledger.maturedEntryCount}; newly matured=${ledger.newlyMaturedEntryCount}; pending=${ledger.pendingEntryCount}`);
  console.log(`Provider drift diagnostics=${ledger.providerDriftDiagnosticCount}`);
  console.log(`Ledger hash=${ledger.contentHash}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) main().catch((error) => { console.error(error); process.exitCode = 1; });
