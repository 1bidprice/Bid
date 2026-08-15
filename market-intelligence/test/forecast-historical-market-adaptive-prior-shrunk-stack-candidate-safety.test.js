import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoricalMarketAdaptivePriorShrunkStackResearch } from '../src/forecast-historical-market-stacked-ensemble-research.js';
import { verifyHistoricalMarketAdaptivePriorShrunkStackCandidate } from '../src/forecast-historical-market-adaptive-prior-shrunk-stack-candidate-safety.js';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function candidate() { return buildHistoricalMarketAdaptivePriorShrunkStackResearch([]); }

test('adaptive candidate safety accepts canonical research-only state', () => {
  const value = candidate();
  const proof = verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(value, { sourceRecordCount: 0 });
  assert.equal(proof.status, 'VERIFIED');
  assert.deepEqual(proof.adaptiveSupportFloorGrid, value.adaptiveSupportFloorGrid);
  assert.equal(proof.adaptiveSelectionReadyPredictionCount, 0);
  assert.equal(proof.adaptiveSelectionWarmupPredictionCount, 0);
});

test('adaptive candidate safety rejects authority and raw export tampering', () => {
  const authority = clone(candidate());
  authority.decisionIntegrationEnabled = true;
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(authority), /forbidden authority/);

  const raw = clone(candidate());
  raw.rawPredictionsIncluded = true;
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(raw), /raw predictions forbidden/);
});

test('adaptive candidate safety rejects support-grid and chronology tampering', () => {
  const grid = clone(candidate());
  grid.adaptiveSupportFloorGrid = [60, 120, 240, 360];
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(grid), /support-floor grid invalid/);

  const chronology = clone(candidate());
  chronology.methodology.adaptiveSelectionRule = 'INVALID';
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(chronology), /anti-leak selection rule invalid/);

  const prior = clone(candidate());
  prior.methodology.priorShrinkageRule = 'INVALID';
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(prior), /prior shrinkage anti-leak rule invalid/);
});

test('adaptive candidate safety rejects objective, tie-break and source mismatches', () => {
  const objective = clone(candidate());
  objective.methodology.adaptiveSelectionObjective = 'LOG_LOSS';
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(objective), /selection objective invalid/);

  const tieBreak = clone(candidate());
  tieBreak.methodology.adaptiveTieBreak = 'INVALID';
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(tieBreak), /tie-break invalid/);

  const source = candidate();
  source.sourceRecordCount = 1;
  assert.throws(() => verifyHistoricalMarketAdaptivePriorShrunkStackCandidate(source, { sourceRecordCount: 0 }), /source record count mismatch/);
});
