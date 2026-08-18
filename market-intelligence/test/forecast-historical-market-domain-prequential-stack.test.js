import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoricalMarketDomainPrequentialStackPredictions, buildHistoricalMarketFactorPrequentialStackPredictions } from '../src/forecast-historical-market-prequential-stack.js';

const DAY = 86400000;
const START = Date.UTC(2022, 0, 3);
function row(i) {
  const y = i % 2;
  const t = START + i * DAY;
  return {
    forecastId: `domain:${i}`,
    validationMode: 'WALK_FORWARD_OOS',
    evidenceClass: 'HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH',
    status: 'MATURED',
    historicalPatternPolicyVersion: 'pattern-v1',
    historicalMarketFactorPolicyVersion: 'market-factor-v1',
    historicalMarketFactorStatus: 'HISTORICAL_MARKET_FACTOR_READY',
    historicalMarketFactorScore: 0,
    historicalMarketFactorSnapshot: { domainContributions: [
      { domain: 'MOMENTUM', value: y ? 0.5625 : -0.5625 },
      { domain: 'RISK', value: y ? -1 : 1 },
    ] },
    instrumentId: `instrument:${i % 12}`,
    assetClass: 'EQUITY', horizon: 'week1', regimeKey: 'R1', tradingDays: 5,
    forecastAt: new Date(t).toISOString(),
    forecastSampleDate: new Date(t).toISOString().slice(0, 10),
    outcomeKnownAt: new Date(t + 2 * DAY).toISOString(),
    realisedOutcome: { timestamp: new Date(t + 2 * DAY).toISOString() },
    rawProbabilityPositive: 0.5,
    positiveOutcome: y,
  };
}
function means(items) {
  const p = items.filter(x => x.positiveOutcome === 1);
  const n = items.filter(x => x.positiveOutcome === 0);
  return [p.reduce((s,x)=>s+x.ensembleResearchProbabilityPositive,0)/p.length, n.reduce((s,x)=>s+x.ensembleResearchProbabilityPositive,0)/n.length];
}

test('domain stack preserves information lost by identical scalar scores', () => {
  const input = Array.from({length:180},(_,i)=>row(i));
  const options = { ensembleMinimumTrainingSample:30, ensembleMinimumTrainingClassCount:10, ensembleL2Penalty:0.02, ensembleLearningRate:0.1, ensembleMaxIterations:900 };
  const scalar = buildHistoricalMarketFactorPrequentialStackPredictions(input, options);
  const domain = buildHistoricalMarketDomainPrequentialStackPredictions(input, options);
  const [sp,sn] = means(scalar.predictions);
  const [dp,dn] = means(domain.predictions);
  assert.equal(domain.predictionCount, scalar.predictionCount);
  assert.ok(Math.abs(sp-sn) < 0.02);
  assert.ok(dp > 0.7 && dn < 0.3 && dp-dn > 0.4);
  assert.ok(domain.predictions.every(x => Date.parse(x.ensembleTrainingLatestOutcomeAt) < Date.parse(x.forecastAt)));
});

test('domain stack rejects missing domain lineage', () => {
  const input = Array.from({length:90},(_,i)=>row(i));
  input[0] = { ...input[0], historicalMarketFactorSnapshot: null };
  const result = buildHistoricalMarketDomainPrequentialStackPredictions(input, { ensembleMinimumTrainingSample:20, ensembleMinimumTrainingClassCount:5 });
  assert.equal(result.eligibleRecordCount, 89);
  assert.equal(result.rejectedRecordCount, 1);
});
