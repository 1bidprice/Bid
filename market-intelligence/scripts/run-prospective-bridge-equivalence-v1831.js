import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildCrossSectionalRegimeWalkForwardResearch } from '../src/forecast-cross-sectional-regime-walk-forward.js';
import { buildHistoricalMarketStackResearch } from '../src/forecast-historical-market-stacked-ensemble-research.js';
import {
  buildProspectiveFrozenStackPredictions,
  PROSPECTIVE_FROZEN_STACK_BRIDGE_CONTRACT,
  PROSPECTIVE_FROZEN_STACK_MODEL_SOURCE_COMMIT,
} from '../src/forecast-prospective-frozen-stack-bridge.js';
import {
  buildProspectiveFrozenTrainingCorpus,
  PROSPECTIVE_TRAINING_CORPUS_CONTRACT,
  PROSPECTIVE_TRAINING_CORPUS_REFERENCE_SOURCE_COMMIT,
} from '../src/forecast-prospective-training-corpus.js';
import {
  buildProspectiveHoldoutProtocol,
  protocolFingerprint,
  PROSPECTIVE_HOLDOUT_PROTOCOL_CONTRACT,
} from '../src/forecast-prospective-holdout-protocol.js';

export const V1831_PROSPECTIVE_EQUIVALENCE_PROOF_CONTRACT = 'PROSPECTIVE_FROZEN_STACK_EQUIVALENCE_PROOF_V1';

function syntheticSeries(symbol, count, phase = 0, benchmark = false) {
  const start = Date.parse('2023-01-03T21:00:00.000Z') / 1000;
  const candles = [];
  let previous = benchmark ? 100 : 100 + phase * 3;
  for (let index = 0; index < count; index += 1) {
    const closeLevel = benchmark
      ? 100 + index * 0.04 + 0.45 * Math.sin((2 * Math.PI * index) / 160)
      : 100
        + phase * 3
        + index * 0.015
        + 8 * Math.sin((2 * Math.PI * index) / 80 + phase * 0.7)
        + 2 * Math.sin((2 * Math.PI * index) / 23 + phase * 0.37);
    const close = Number(Math.max(5, closeLevel).toFixed(6));
    const open = Number(((previous + close) / 2).toFixed(6));
    const high = Number((Math.max(open, close) * 1.008).toFixed(6));
    const low = Number((Math.min(open, close) * 0.992).toFixed(6));
    candles.push({
      timestamp: start + index * 86_400,
      open,
      high,
      low,
      close,
      volume: 1_000_000 + ((index * 7919 + phase * 31_337) % 350_000),
    });
    previous = close;
  }
  return { provider: 'V1831_EQUIVALENCE_FIXTURE', providerSymbol: symbol, symbol, candles };
}

function syntheticInstruments() {
  const benchmarkSeries = syntheticSeries('SPY', 1000, 0, true);
  return [
    ['fixture-alpha', 'AAA', 1],
    ['fixture-beta', 'BBB', 2],
    ['fixture-gamma', 'CCC', 3],
    ['fixture-delta', 'DDD', 4],
  ].map(([id, symbol, phase]) => ({
    instrumentId: `company:${id}`,
    companyId: `company:${id}`,
    symbol,
    assetClass: 'EQUITY',
    series: syntheticSeries(symbol, 1000, phase),
    benchmarkSeries,
  }));
}

function scientificOptions() {
  return {
    horizons: { week1: 5, month1: 21 },
    warmupObservations: 320,
    evaluationStep: 7,
    minimumForecastsForMetrics: 20,
    minAnalogCount: 8,
    maxAnalogs: 30,
    minEffectiveSample: 4,
    sameInstrumentTrendRegimeOnly: true,
    minimumHistory: 200,
    periodsPerYear: 252,
    marketRegimeMinimumObservations: 200,
  };
}

function stripOutcome(record = {}) {
  const {
    positiveOutcome: _positiveOutcome,
    outcomeKnownAt: _outcomeKnownAt,
    realisedOutcome: _realisedOutcome,
    status: _status,
    validationMode: _validationMode,
    evidenceClass: _evidenceClass,
    ...target
  } = record;
  return target;
}

function candidateMap(stack = {}) {
  return new Map([
    ['SCALAR_MARKET_FACTOR', stack],
    ['DOMAIN_SEPARATED_MARKET_FACTOR', stack.domainSeparatedCandidate],
    ['PRIOR_SHRUNK_SCALAR_MARKET_FACTOR', stack.priorShrunkCandidate],
    ['ADAPTIVE_PRIOR_SHRUNK_SCALAR_MARKET_FACTOR', stack.adaptivePriorShrunkCandidate],
  ]);
}

function predictionProbability(prediction = {}) {
  return prediction.ensembleResearchProbabilityPositive ?? null;
}

function findCommonReferenceTarget(stack = {}, records = []) {
  const candidates = candidateMap(stack);
  const scalarPredictions = Array.isArray(stack.predictions) ? stack.predictions : [];
  for (let index = scalarPredictions.length - 1; index >= 0; index -= 1) {
    const scalar = scalarPredictions[index];
    const forecastId = scalar?.forecastId;
    if (!forecastId) continue;
    const allPresent = [...candidates.values()].every((candidate) => (
      Array.isArray(candidate?.predictions)
      && candidate.predictions.some((prediction) => prediction.forecastId === forecastId)
    ));
    if (!allPresent) continue;
    const record = records.find((item) => item.forecastId === forecastId);
    if (record) return { forecastId, record };
  }
  return null;
}

export function assertV1831ProspectiveEquivalenceProofReady(proof = {}) {
  const blockers = [];
  if (proof?.contract !== V1831_PROSPECTIVE_EQUIVALENCE_PROOF_CONTRACT) blockers.push('V1831_PROOF_CONTRACT_CHANGED');
  if (proof?.verified !== true) blockers.push('V1831_PROOF_NOT_VERIFIED');
  if (proof?.frozenModelSourceCommit !== PROSPECTIVE_FROZEN_STACK_MODEL_SOURCE_COMMIT) blockers.push('V1831_MODEL_FREEZE_CHANGED');
  if (proof?.trainingCorpusReferenceCommit !== PROSPECTIVE_TRAINING_CORPUS_REFERENCE_SOURCE_COMMIT) blockers.push('V1831_CORPUS_REFERENCE_CHANGED');
  if (proof?.corpusEquivalence?.deepEqual !== true) blockers.push('V1831_CORPUS_NOT_EXACT');
  if (proof?.bridgeEquivalence?.allFourVariantsExact !== true) blockers.push('V1831_BRIDGE_NOT_EXACT');
  if (proof?.bridgeEquivalence?.targetOutcomeUsed !== false) blockers.push('V1831_TARGET_OUTCOME_USED');
  if (proof?.holdoutStarted !== false) blockers.push('V1831_HOLDOUT_STARTED_DURING_EQUIVALENCE_PROOF');
  if (proof?.automaticModelPromotionEnabled !== false
      || proof?.decisionIntegrationEnabled !== false
      || proof?.forecastMayInfluenceFinalAction !== false
      || proof?.brokerExecutionEligible !== false
      || proof?.decisionImpact !== 'NONE') blockers.push('V1831_AUTHORITY_BOUNDARY_CHANGED');
  if (blockers.length) throw new Error(`v1831 prospective equivalence blocked: ${blockers.join(',')}`);
  return true;
}

export function buildV1831ProspectiveEquivalenceProof(input = {}) {
  const instruments = syntheticInstruments();
  const options = scientificOptions();
  const generatedAt = input.generatedAt || '2026-08-16T17:30:00.000Z';
  const frozenReference = buildCrossSectionalRegimeWalkForwardResearch({ instruments, options, generatedAt });
  const corpus = buildProspectiveFrozenTrainingCorpus({ instruments, options, generatedAt });
  const rebuiltStack = buildHistoricalMarketStackResearch(corpus.records, options);
  const corpusDeepEqual = isDeepStrictEqual(rebuiltStack, frozenReference.historicalMarketStackResearch);
  const targetReference = findCommonReferenceTarget(frozenReference.historicalMarketStackResearch, corpus.records);

  let bridge = null;
  const variantComparisons = [];
  if (targetReference) {
    const target = stripOutcome(targetReference.record);
    bridge = buildProspectiveFrozenStackPredictions(corpus.records, target);
    const candidates = candidateMap(frozenReference.historicalMarketStackResearch);
    for (const bridgePrediction of bridge.predictions || []) {
      const referenceCandidate = candidates.get(bridgePrediction.modelVariant);
      const referencePrediction = referenceCandidate?.predictions?.find((prediction) => prediction.forecastId === targetReference.forecastId) || null;
      const referenceProbability = predictionProbability(referencePrediction);
      variantComparisons.push({
        modelVariant: bridgePrediction.modelVariant,
        bridgeStatus: bridgePrediction.status,
        bridgeProbabilityPositive: bridgePrediction.probabilityPositive,
        referenceProbabilityPositive: referenceProbability,
        exactProbabilityMatch: bridgePrediction.status === 'FORECAST_AVAILABLE'
          && typeof referenceProbability === 'number'
          && bridgePrediction.probabilityPositive === referenceProbability,
      });
    }
  }

  const allFourVariantsExact = variantComparisons.length === 4 && variantComparisons.every((item) => item.exactProbabilityMatch);
  const protocol = buildProspectiveHoldoutProtocol();
  const blockers = [];
  if (!corpusDeepEqual) blockers.push('FROZEN_TRAINING_CORPUS_DEEP_EQUAL_FAILED');
  if (frozenReference.historicalMarketStackResearch?.predictionCount <= 0) blockers.push('EQUIVALENCE_FIXTURE_HAS_NO_STACK_PREDICTIONS');
  if (!targetReference) blockers.push('NO_COMMON_FROZEN_VARIANT_REFERENCE_TARGET');
  if (!allFourVariantsExact) blockers.push('FROZEN_BRIDGE_VARIANT_EQUIVALENCE_FAILED');
  if (bridge?.targetOutcomeUsed !== false) blockers.push('FROZEN_BRIDGE_USED_TARGET_OUTCOME');
  if (protocol.contract !== PROSPECTIVE_HOLDOUT_PROTOCOL_CONTRACT) blockers.push('HOLDOUT_PROTOCOL_CONTRACT_CHANGED');
  if (protocol.modelFreeze?.sourceCommit !== PROSPECTIVE_FROZEN_STACK_MODEL_SOURCE_COMMIT) blockers.push('HOLDOUT_MODEL_FREEZE_CHANGED');

  const uniqueBlockers = [...new Set(blockers)];
  const proof = {
    format: 'investor-control-prospective-frozen-stack-equivalence-proof',
    version: 1,
    contract: V1831_PROSPECTIVE_EQUIVALENCE_PROOF_CONTRACT,
    status: uniqueBlockers.length ? 'PROSPECTIVE_FROZEN_STACK_EQUIVALENCE_BLOCKED' : 'PROSPECTIVE_FROZEN_STACK_EQUIVALENCE_VERIFIED',
    verified: uniqueBlockers.length === 0,
    sourceCommit: input.sourceCommit || null,
    frozenModelSourceCommit: PROSPECTIVE_FROZEN_STACK_MODEL_SOURCE_COMMIT,
    trainingCorpusReferenceCommit: PROSPECTIVE_TRAINING_CORPUS_REFERENCE_SOURCE_COMMIT,
    bridgeContract: PROSPECTIVE_FROZEN_STACK_BRIDGE_CONTRACT,
    trainingCorpusContract: PROSPECTIVE_TRAINING_CORPUS_CONTRACT,
    holdoutProtocolContract: protocol.contract,
    holdoutProtocolFingerprint: protocolFingerprint(protocol),
    corpusEquivalence: {
      deepEqual: corpusDeepEqual,
      fixtureInstrumentCount: instruments.length,
      generatedRecordCount: corpus.generatedRecordCount,
      validRegimeRecordCount: corpus.validRegimeRecordCount,
      regimeCoveragePct: corpus.regimeCoveragePct,
      frozenStackPredictionCount: frozenReference.historicalMarketStackResearch?.predictionCount || 0,
    },
    bridgeEquivalence: {
      targetForecastId: targetReference?.forecastId || null,
      targetForecastAt: targetReference?.record?.forecastAt || null,
      targetHorizon: targetReference?.record?.horizon || null,
      targetRegimeKey: targetReference?.record?.regimeKey || null,
      targetOutcomeUsed: bridge?.targetOutcomeUsed ?? null,
      allFourVariantsExact,
      variants: variantComparisons,
    },
    blockers: uniqueBlockers,
    rawSyntheticTrainingRecordsIncluded: false,
    rawSyntheticCandlesIncluded: false,
    holdoutStarted: false,
    firstLiveCaptureCreated: false,
    historicalBackfillAllowed: false,
    prospectiveResearchOnly: true,
    automaticModelPromotionEnabled: false,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    finalActionEligible: false,
    brokerExecutionEligible: false,
    decisionImpact: 'NONE',
  };
  return proof;
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/v1831-prospective-equivalence-proof.json');
  const proof = buildV1831ProspectiveEquivalenceProof({
    sourceCommit: process.env.INVESTOR_CONTROL_RESEARCH_SOURCE_COMMIT || null,
  });
  assertV1831ProspectiveEquivalenceProofReady(proof);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  console.log(`Wrote v1831 prospective equivalence proof to ${outputPath}`);
  console.log(`Frozen model source: ${proof.frozenModelSourceCommit}`);
  console.log(`Corpus exact: ${proof.corpusEquivalence.deepEqual}; stack predictions: ${proof.corpusEquivalence.frozenStackPredictionCount}`);
  console.log(`Bridge exact across four variants: ${proof.bridgeEquivalence.allFourVariantsExact}`);
  console.log(`Holdout started: ${proof.holdoutStarted}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
