import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildV1840MaturationCompatibilityView,
  reduceV1840ImmutableOutcomeLedger,
  verifyV1840Ledger,
  V1840_IMMUTABLE_OUTCOME_LEDGER_CONTRACT,
} from '../scripts/run-prospective-holdout-v2-immutable-outcome-ledger-v1840.js';

function maturation(entries, contentHash = 'a'.repeat(64), captureCount = 1) {
  return {
    contract: 'PROSPECTIVE_HOLDOUT_V2_OUTCOME_MATURATION_V1',
    holdoutId: 'investor-control-us-equity-unseen-holdout-2026q3-v2',
    protocolContract: 'PROSPECTIVE_UNSEEN_HOLDOUT_PROTOCOL_V2',
    captureCount,
    sourceCaptureVerificationFailureCount: 0,
    outcomes: entries,
    performanceMetricsIncluded: false,
    performancePeeked: false,
    evaluationGateOpened: false,
    contentHash,
  };
}

function pending(captureHash = 'c1', companyId = 'company:a', horizon = 'week1') {
  return {
    captureHash,
    holdoutId: 'investor-control-us-equity-unseen-holdout-2026q3-v2',
    companyId,
    symbol: 'AAA',
    horizon,
    tradingDays: horizon === 'week1' ? 5 : 21,
    featureAsOf: '2026-08-14T13:30:00.000Z',
    sourceCaptureVerified: true,
    status: 'PENDING_HORIZON_MATURATION',
    completedCompanySessionsAfterFeature: 4,
    completedBenchmarkSessionsAfterFeature: 4,
    outcomeKnownAt: null,
    positiveOutcome: null,
    realizedReturnPct: null,
    benchmarkReturnPct: null,
    benchmarkRelativeReturnPct: null,
  };
}

function matured(base = pending(), overrides = {}) {
  return {
    ...base,
    status: 'MATURED_OUTCOME_AVAILABLE',
    completedCompanySessionsAfterFeature: base.tradingDays,
    completedBenchmarkSessionsAfterFeature: base.tradingDays,
    outcomeKnownAt: '2026-08-21T13:30:00.000Z',
    positiveOutcome: 1,
    realizedReturnPct: 5,
    benchmarkReturnPct: 1,
    benchmarkRelativeReturnPct: 4,
    ...overrides,
  };
}

test('v1840 bootstraps a hashed pending ledger without exposing any outcome', () => {
  const ledger = reduceV1840ImmutableOutcomeLedger({
    currentMaturationArtifact: maturation([pending()]),
    generatedAt: '2026-08-17T14:00:00.000Z',
    sourceCommit: 'test',
  });
  assert.equal(ledger.contract, V1840_IMMUTABLE_OUTCOME_LEDGER_CONTRACT);
  assert.equal(ledger.entryCount, 1);
  assert.equal(ledger.maturedEntryCount, 0);
  assert.equal(ledger.pendingEntryCount, 1);
  assert.equal(ledger.entries[0].positiveOutcome, null);
  assert.equal(ledger.performancePeeked, false);
  assert.equal(ledger.evaluationGateOpened, false);
  assert.equal(verifyV1840Ledger(ledger).verified, true);
  assert.match(ledger.contentHash, /^[a-f0-9]{64}$/);
});

test('v1840 freezes the first verified matured outcome and records later provider drift without mutation', () => {
  const first = reduceV1840ImmutableOutcomeLedger({
    currentMaturationArtifact: maturation([matured()]),
    generatedAt: '2026-08-21T14:00:00.000Z',
  });
  const driftedCandidate = matured(pending(), {
    positiveOutcome: 0,
    realizedReturnPct: -7,
    benchmarkReturnPct: 2,
    benchmarkRelativeReturnPct: -9,
    outcomeKnownAt: '2026-08-22T13:30:00.000Z',
  });
  const second = reduceV1840ImmutableOutcomeLedger({
    currentMaturationArtifact: maturation([driftedCandidate], 'b'.repeat(64)),
    previousLedger: first,
    generatedAt: '2026-08-22T14:00:00.000Z',
  });
  assert.equal(second.entries[0].positiveOutcome, 1);
  assert.equal(second.entries[0].realizedReturnPct, 5);
  assert.equal(second.entries[0].benchmarkRelativeReturnPct, 4);
  assert.equal(second.entries[0].outcomeKnownAt, '2026-08-21T13:30:00.000Z');
  assert.equal(second.retainedMaturedEntryCount, 1);
  assert.equal(second.newlyMaturedEntryCount, 0);
  assert.equal(second.providerDriftDiagnosticCount, 1);
  assert.equal(second.providerDriftDiagnostics[0].code, 'MATURED_OUTCOME_PROVIDER_DRIFT_DETECTED_IMMUTABLE_VALUE_RETAINED');
  assert.equal(second.previousLedgerContentHash, first.contentHash);
  assert.equal(verifyV1840Ledger(second).verified, true);
});

test('v1840 promotes pending to matured exactly once and then keeps it immutable', () => {
  const first = reduceV1840ImmutableOutcomeLedger({ currentMaturationArtifact: maturation([pending()]), generatedAt: '2026-08-17T14:00:00.000Z' });
  const second = reduceV1840ImmutableOutcomeLedger({ currentMaturationArtifact: maturation([matured()], 'b'.repeat(64)), previousLedger: first, generatedAt: '2026-08-21T14:00:00.000Z' });
  assert.equal(second.maturedEntryCount, 1);
  assert.equal(second.pendingEntryCount, 0);
  assert.equal(second.newlyMaturedEntryCount, 1);
  const third = reduceV1840ImmutableOutcomeLedger({ currentMaturationArtifact: maturation([matured()], 'c'.repeat(64)), previousLedger: second, generatedAt: '2026-08-22T14:00:00.000Z' });
  assert.equal(third.newlyMaturedEntryCount, 0);
  assert.equal(third.retainedMaturedEntryCount, 1);
  assert.deepEqual(third.entries[0], second.entries[0]);
});

test('v1840 fails closed if current maturation silently loses a previously ledgered tuple', () => {
  const first = reduceV1840ImmutableOutcomeLedger({ currentMaturationArtifact: maturation([pending()]), generatedAt: '2026-08-17T14:00:00.000Z' });
  assert.throws(() => reduceV1840ImmutableOutcomeLedger({
    currentMaturationArtifact: maturation([], 'b'.repeat(64), 0),
    previousLedger: first,
    generatedAt: '2026-08-18T14:00:00.000Z',
  }), /lost a previously ledgered tuple/);
});

test('v1840 compatibility view preserves only immutable ledger outcomes for downstream structural/performance gates', () => {
  const ledger = reduceV1840ImmutableOutcomeLedger({ currentMaturationArtifact: maturation([matured()]), generatedAt: '2026-08-21T14:00:00.000Z' });
  const view = buildV1840MaturationCompatibilityView(ledger);
  assert.equal(view.contract, 'PROSPECTIVE_HOLDOUT_V2_OUTCOME_MATURATION_V1');
  assert.equal(view.sourceImmutableLedgerContract, V1840_IMMUTABLE_OUTCOME_LEDGER_CONTRACT);
  assert.equal(view.sourceImmutableLedgerContentHash, ledger.contentHash);
  assert.equal(view.outcomeTupleCount, 1);
  assert.equal(view.maturedOutcomeCount, 1);
  assert.equal(view.pendingOutcomeCount, 0);
  assert.deepEqual(view.outcomes, ledger.entries);
  assert.equal(view.performanceMetricsIncluded, false);
  assert.equal(view.performancePeeked, false);
  assert.equal(view.evaluationGateOpened, false);
});
