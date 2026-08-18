import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateOosSampleIndependence,
  splitChronologicalDateBlocks,
} from '../src/forecast-oos-sample-independence.js';
import { buildForecastFactorLearningStatus } from '../src/forecast-factor-learning-status.js';
import { buildForecastFactorAttributionStatus } from '../src/forecast-factor-attribution.js';
import { buildForecastFactorWeightGovernanceStatus } from '../src/forecast-factor-weight-governance.js';
import {
  FORECAST_FEATURE_VECTOR_VERSION,
  FORECAST_FACTOR_DOMAIN_WEIGHTS,
} from '../src/forecast-feature-vector.js';
import { FORECAST_FACTOR_SCORE_VERSION } from '../src/forecast-factor-score.js';

const LEVELS = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];

function dateFor(index) {
  return new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
}

function independenceRecord(index, options = {}) {
  const date = options.date || dateFor(options.dateIndex ?? index);
  const instrumentIndex = options.instrumentIndex ?? (index % (options.instrumentCount || 20));
  return {
    forecastId: `independence:${index}`,
    forecastSampleDate: date,
    forecastAt: `${date}T20:00:00.000Z`,
    companyId: options.missingIdentity ? null : `company:${instrumentIndex}`,
    instrumentId: options.missingIdentity ? null : `instrument:${instrumentIndex}`,
  };
}

function factorRecord(index, options = {}) {
  const value = options.value ?? LEVELS[index % LEVELS.length];
  const positive = value > 0;
  const date = dateFor(options.dateIndex ?? index);
  const instrumentIndex = options.instrumentIndex ?? (index % (options.instrumentCount || 20));
  return {
    forecastId: `factor-independence:${index}`,
    validationMode: 'LIVE_SHADOW_OOS',
    factorScorePolicyVersion: 'factor-v1',
    factorScoreStatus: 'LATENT_SCORE_READY',
    latentFactorScore: value,
    rawLatentFactorScore: value,
    assetClass: 'EQUITY',
    horizon: 'month1',
    forecastSampleDate: date,
    forecastAt: `${date}T20:00:00.000Z`,
    companyId: `company:${instrumentIndex}`,
    instrumentId: `instrument:${instrumentIndex}`,
    status: 'MATURED',
    positiveOutcome: positive ? 1 : 0,
    realisedOutcome: { realisedReturnPct: value * 10 },
  };
}

function attributionRecord(index, options = {}) {
  const value = options.value ?? LEVELS[index % LEVELS.length];
  const positive = value > 0;
  const date = dateFor(options.dateIndex ?? index);
  const instrumentIndex = options.instrumentIndex ?? (index % (options.instrumentCount || 20));
  return {
    forecastId: `attribution-independence:${index}`,
    validationMode: 'LIVE_SHADOW_OOS',
    factorFeatureVectorPolicyVersion: 'fv-v1',
    factorScorePolicyVersion: 'score-v1',
    factorDomainSnapshot: [{ domain: 'MOMENTUM', value, weight: 0.16, verifiedDriverCount: 1 }],
    assetClass: 'EQUITY',
    horizon: 'month1',
    forecastSampleDate: date,
    forecastAt: `${date}T20:00:00.000Z`,
    companyId: `company:${instrumentIndex}`,
    instrumentId: `instrument:${instrumentIndex}`,
    status: 'MATURED',
    positiveOutcome: positive ? 1 : 0,
    realisedOutcome: { realisedReturnPct: value * 10 },
  };
}

function governanceRecord(index, options = {}) {
  const value = options.value ?? LEVELS[index % LEVELS.length];
  const positive = value > 0;
  const date = dateFor(options.dateIndex ?? index);
  const instrumentIndex = options.instrumentIndex ?? (index % (options.instrumentCount || 20));
  return {
    forecastId: `governance-independence:${index}`,
    validationMode: 'LIVE_SHADOW_OOS',
    factorFeatureVectorPolicyVersion: FORECAST_FEATURE_VECTOR_VERSION,
    factorScorePolicyVersion: FORECAST_FACTOR_SCORE_VERSION,
    factorDomainSnapshot: [{
      domain: 'MOMENTUM',
      value,
      weight: FORECAST_FACTOR_DOMAIN_WEIGHTS.MOMENTUM,
      verifiedDriverCount: 1,
    }],
    assetClass: 'EQUITY',
    horizon: 'month1',
    forecastSampleDate: date,
    forecastAt: `${date}T20:00:00.000Z`,
    companyId: `company:${instrumentIndex}`,
    instrumentId: `instrument:${instrumentIndex}`,
    status: 'MATURED',
    positiveOutcome: positive ? 1 : 0,
    realisedOutcome: { realisedReturnPct: value * 10 },
  };
}

function currentAttributionStatus() {
  return {
    groups: [{
      factorFeatureVectorPolicyVersion: FORECAST_FEATURE_VECTOR_VERSION,
      factorScorePolicyVersion: FORECAST_FACTOR_SCORE_VERSION,
      assetClass: 'EQUITY',
      horizon: 'month1',
      domains: [{
        domain: 'MOMENTUM',
        status: 'PREDICTIVE_DIRECTION_SUPPORTED',
        manualWeightReviewCandidate: true,
      }],
    }],
  };
}

test('independence gate rejects one-date concentration even with enough dates and instruments overall', () => {
  const records = [
    ...Array.from({ length: 31 }, (_, index) => independenceRecord(index, { date: '2024-01-01' })),
    ...Array.from({ length: 269 }, (_, index) => independenceRecord(index + 31, { dateIndex: 1 + (index % 59) })),
  ];
  const status = evaluateOosSampleIndependence(records, {
    minimumDistinctForecastDates: 60,
    minimumDistinctInstruments: 10,
    maximumSingleForecastDateSharePct: 10,
  });
  assert.equal(status.distinctForecastDateCount, 60);
  assert.ok(status.distinctInstrumentCount >= 10);
  assert.ok(status.maximumSingleForecastDateSharePct > 10);
  assert.equal(status.status, 'INDEPENDENCE_NOT_READY');
  assert.ok(status.blockers.includes('OOS_SINGLE_DATE_CONCENTRATION_TOO_HIGH'));
});

test('independence gate accepts diversified dates and instruments and fails closed on missing identity', () => {
  const diversified = Array.from({ length: 300 }, (_, index) => independenceRecord(index, {
    dateIndex: index % 60,
    instrumentCount: 20,
  }));
  const ready = evaluateOosSampleIndependence(diversified, {
    minimumDistinctForecastDates: 60,
    minimumDistinctInstruments: 10,
    maximumSingleForecastDateSharePct: 10,
  });
  assert.equal(ready.status, 'INDEPENDENCE_READY');
  assert.equal(ready.distinctForecastDateCount, 60);
  assert.equal(ready.distinctInstrumentCount, 20);

  const missing = diversified.map((record) => ({ ...record, companyId: null, instrumentId: null }));
  const blocked = evaluateOosSampleIndependence(missing, {
    minimumDistinctForecastDates: 60,
    minimumDistinctInstruments: 10,
    maximumSingleForecastDateSharePct: 10,
  });
  assert.ok(blocked.blockers.includes('OOS_INSTRUMENT_IDENTITY_MISSING'));
  assert.ok(blocked.blockers.includes('OOS_DISTINCT_INSTRUMENTS_TOO_SMALL'));
});

test('chronological stability blocks never split the same forecast date', () => {
  const records = Array.from({ length: 18 }, (_, index) => independenceRecord(index, {
    dateIndex: Math.floor(index / 3),
  }));
  const blocks = splitChronologicalDateBlocks(records, 3);
  assert.equal(blocks.length, 3);
  const owners = new Map();
  blocks.forEach((block, blockIndex) => {
    for (const record of block) {
      const date = record.forecastSampleDate;
      if (owners.has(date)) assert.equal(owners.get(date), blockIndex);
      else owners.set(date, blockIndex);
    }
  });
  assert.equal(owners.size, 6);
});

test('factor promotion is blocked when raw OOS volume comes from too few forecast dates', () => {
  const records = Array.from({ length: 240 }, (_, index) => factorRecord(index, {
    dateIndex: index % 20,
    instrumentCount: 20,
  }));
  const group = buildForecastFactorLearningStatus({ records }).groups[0];
  assert.equal(group.maturedScoredCount, 240);
  assert.notEqual(group.status, 'PROMOTION_CANDIDATE');
  assert.equal(group.sampleIndependence.distinctForecastDateCount, 20);
  assert.ok(group.blockers.includes('OOS_DISTINCT_FORECAST_DATES_TOO_SMALL'));
});

test('factor attribution cannot nominate weight review from too few independent instruments', () => {
  const records = Array.from({ length: 220 }, (_, index) => attributionRecord(index, {
    instrumentCount: 5,
  }));
  const domain = buildForecastFactorAttributionStatus({ records }).groups[0].domains[0];
  assert.equal(domain.maturedSampleSize, 220);
  assert.equal(domain.sampleIndependence.distinctInstrumentCount, 5);
  assert.equal(domain.manualWeightReviewCandidate, false);
  assert.ok(domain.blockers.includes('OOS_DISTINCT_INSTRUMENTS_TOO_SMALL'));
});

test('weight governance cannot propose from 360 records concentrated into fewer than 60 forecast dates', () => {
  const records = Array.from({ length: 360 }, (_, index) => governanceRecord(index, {
    dateIndex: index % 45,
    instrumentCount: 20,
  }));
  const status = buildForecastFactorWeightGovernanceStatus({
    records,
    attributionStatus: currentAttributionStatus(),
  });
  const momentum = status.groups[0].domains.find((item) => item.domain === 'MOMENTUM');
  assert.equal(momentum.maturedSampleSize, 360);
  assert.equal(momentum.sampleIndependence.distinctForecastDateCount, 45);
  assert.equal(status.proposalCount, 0);
  assert.ok(momentum.blockers.includes('OOS_DISTINCT_FORECAST_DATES_TOO_SMALL'));
  assert.equal(status.automaticProposalApplicationEnabled, false);
});
