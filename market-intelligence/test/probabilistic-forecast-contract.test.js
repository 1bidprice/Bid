import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProbabilisticForecastContract } from '../src/probabilistic-forecast-contract.js';

function pattern() {
  return {
    instrumentId: 'ABC',
    assetClass: 'EQUITY',
    asOf: '2026-08-10T20:00:00.000Z',
    policyVersion: 'pattern-v1',
    horizons: {
      month3: {
        tradingDays: 63,
        status: 'RESEARCH_READY_UNCALIBRATED',
        rawProbabilityPositive: 0.71,
        probabilityPositive: null,
        expectedReturnPct: 9.4,
        patternConfidenceScore: 61,
        sample: { selectedAnalogCount: 28 },
        analogs: [{ anchorIndex: 100, outcomeReturnPct: 7 }],
        blockers: ['PROBABILITY_REQUIRES_WALK_FORWARD_CALIBRATION'],
      },
    },
  };
}

test('raw historical frequency is never mislabeled as a calibrated probability', () => {
  const contract = buildProbabilisticForecastContract({
    historicalPatternForecast: pattern(),
    evidenceQualityScore: 90,
  });
  assert.equal(contract.horizons.month3.rawPatternProbabilityPositive, 0.71);
  assert.equal(contract.horizons.month3.probabilityPositive, null);
  assert.equal(contract.forecastMayInfluenceFinalAction, false);
  assert.equal(contract.finalActionEligible, false);
});

test('forecast exposes verified supporting and opposing evidence separately', () => {
  const contract = buildProbabilisticForecastContract({
    historicalPatternForecast: pattern(),
    evidenceQualityScore: 90,
    drivers: [
      { name: 'VALUATION', family: 'VALUATION', direction: 'POSITIVE', strengthScore: 80, verified: true, explanation: 'Discount to peers', evidenceIds: ['e1'] },
      { name: 'VOLATILITY', family: 'RISK', direction: 'NEGATIVE', strengthScore: 72, verified: true, explanation: 'Elevated realized volatility', evidenceIds: ['e2'] },
      { name: 'RUMOR', family: 'EVENT', direction: 'POSITIVE', strengthScore: 90, verified: false, explanation: 'Unverified rumor', evidenceIds: ['e3'] },
    ],
  });
  assert.equal(contract.explainability.supportingDrivers.length, 1);
  assert.equal(contract.explainability.opposingDrivers.length, 1);
  assert.equal(contract.explainability.unverifiedDriversExcludedFromDecision.length, 1);
});

test('even a promoted forecast remains separate from the final action engine', () => {
  const contract = buildProbabilisticForecastContract({
    historicalPatternForecast: pattern(),
    evidenceQualityScore: 90,
    calibrationByHorizon: {
      month3: { status: 'CALIBRATED', calibratedProbability: 0.66, blockers: [] },
    },
    calibrationSummaryByHorizon: {
      month3: { status: 'OOS_METRICS_READY', sampleSize: 300, skillVsBaseRatePct: 11, expectedCalibrationError: 0.04 },
    },
  });
  assert.equal(contract.horizons.month3.probabilityPositive, 0.66);
  assert.equal(contract.forecastMayInfluenceFinalAction, true);
  assert.equal(contract.finalActionEligible, false);
  assert.equal(contract.finalActionPolicy, 'SEPARATE_FINAL_ACTION_ENGINE_REQUIRED');
});
