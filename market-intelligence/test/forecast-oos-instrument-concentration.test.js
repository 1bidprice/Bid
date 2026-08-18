import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOosInstrumentConcentration } from '../src/forecast-oos-instrument-concentration.js';
import { buildForecastFactorLearningStatus } from '../src/forecast-factor-learning-status.js';
import { buildForecastFactorAttributionStatus } from '../src/forecast-factor-attribution.js';
import { buildForecastFactorWeightGovernanceStatus } from '../src/forecast-factor-weight-governance.js';
import {
  buildForecastFactorOperationalTelemetry,
  verifyForecastFactorProductionSafety,
} from '../src/forecast-factor-production-safety.js';
import {
  FORECAST_FEATURE_VECTOR_VERSION,
  FORECAST_FACTOR_DOMAIN_WEIGHTS,
} from '../src/forecast-feature-vector.js';
import { FORECAST_FACTOR_SCORE_VERSION } from '../src/forecast-factor-score.js';

const LEVELS = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];
const SIC_MAJOR_GROUPS = ['10', '20', '30', '40', '50', '60'];
const DAY_MS = 86_400_000;

function classificationSnapshot(index, companyId, instrumentId, forecastAt) {
  const majorGroup = SIC_MAJOR_GROUPS[index % SIC_MAJOR_GROUPS.length];
  const code = `${majorGroup}00`;
  const cik = String((index % 20) + 1).padStart(10, '0');
  return {
    contract: 'FORECAST_TIME_CLASSIFICATION_SNAPSHOT_V1',
    policyVersion: '2026-08-11.1',
    companyId,
    instrumentId,
    sourceAuthority: 'SEC_EDGAR_SUBMISSIONS',
    sourceUrl: `https://data.sec.gov/submissions/CIK${cik}.json`,
    sourceDocumentId: `CIK${cik}`,
    capturedAt: forecastAt,
    taxonomy: 'SEC_SIC',
    code,
    description: `Synthetic SIC ${code}`,
    inferenceUsed: false,
    decisionImpact: 'NONE',
  };
}

function instrumentForLearningCluster(index) {
  if (index < 60) return 0;
  if (index < 120) return 1;
  if (index < 180) return 2;
  return 3 + ((index - 180) % 7);
}

function instrumentForGovernanceCluster(index) {
  if (index < 72) return 0;
  if (index < 144) return 1;
  if (index < 216) return 2;
  if (index < 288) return 3;
  return 4 + ((index - 288) % 6);
}

function syntheticRecord(index, options = {}) {
  const value = options.value ?? LEVELS[index % LEVELS.length];
  const positive = value > 0;
  const spacingDays = options.spacingDays ?? 21;
  const tradingDays = options.tradingDays ?? 21;
  const forecastAt = new Date(Date.UTC(2000, 0, 1) + index * spacingDays * DAY_MS).toISOString();
  const outcomeAt = new Date(new Date(forecastAt).getTime() + tradingDays * DAY_MS).toISOString();
  const instrumentIndex = options.instrumentIndex ?? (index % (options.instrumentCount || 20));
  const companyId = `company:${instrumentIndex}`;
  const instrumentId = `instrument:${instrumentIndex}`;
  return {
    forecastId: `instrument-concentration:${index}`,
    validationMode: 'LIVE_SHADOW_OOS',
    factorFeatureVectorPolicyVersion: options.currentLineage === false ? 'fv-test' : FORECAST_FEATURE_VECTOR_VERSION,
    factorScorePolicyVersion: options.currentLineage === false ? 'score-test' : FORECAST_FACTOR_SCORE_VERSION,
    factorScoreStatus: 'LATENT_SCORE_READY',
    latentFactorScore: value,
    rawLatentFactorScore: value,
    factorDomainSnapshot: [{
      domain: 'MOMENTUM',
      value,
      weight: FORECAST_FACTOR_DOMAIN_WEIGHTS.MOMENTUM,
      verifiedDriverCount: 1,
    }],
    companyId,
    instrumentId,
    classificationSnapshot: classificationSnapshot(index, companyId, instrumentId, forecastAt),
    assetClass: 'EQUITY',
    horizon: 'month1',
    tradingDays,
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    referencePrice: { timestamp: forecastAt },
    status: 'MATURED',
    positiveOutcome: positive ? 1 : 0,
    realisedOutcome: {
      timestamp: outcomeAt,
      realisedReturnPct: value * 10,
    },
  };
}

function currentAttributionStatus() {
  return {
    format: 'investor-control-forecast-factor-attribution-status',
    version: 1,
    lineageRecordCount: 360,
    groupCount: 1,
    manualWeightReviewCandidateCount: 1,
    automaticWeightAdjustmentEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
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

function productionReport(governance, attribution) {
  const learning = {
    format: 'investor-control-forecast-factor-learning-status',
    version: 1,
    lineageRecordCount: 0,
    maturedScoredCount: 0,
    groupCount: 0,
    promotionCandidateGroupCount: 0,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    groups: [],
  };
  const report = {
    forecastFactorLearningStatus: learning,
    forecastFactorAttributionStatus: attribution,
    forecastFactorWeightGovernanceStatus: governance,
  };
  report.operationalHealth = buildForecastFactorOperationalTelemetry(report);
  return report;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('balanced twenty-instrument OOS sample is concentration-ready', () => {
  const records = Array.from({ length: 200 }, (_, index) => syntheticRecord(index));
  const status = evaluateOosInstrumentConcentration(records, {
    maximumSingleInstrumentSharePct: 25,
    minimumEffectiveInstrumentCount: 6,
  });
  assert.equal(status.distinctInstrumentCount, 20);
  assert.equal(status.maximumSingleInstrumentSharePct, 5);
  assert.equal(status.effectiveInstrumentCount, 20);
  assert.equal(status.status, 'INSTRUMENT_DIVERSIFICATION_READY');
});

test('one instrument cannot dominate the OOS sample even when ten distinct instruments exist', () => {
  const records = Array.from({ length: 100 }, (_, index) => syntheticRecord(index, {
    instrumentIndex: index < 30 ? 0 : 1 + ((index - 30) % 9),
  }));
  const status = evaluateOosInstrumentConcentration(records, {
    maximumSingleInstrumentSharePct: 25,
    minimumEffectiveInstrumentCount: 6,
  });
  assert.equal(status.distinctInstrumentCount, 10);
  assert.equal(status.maximumSingleInstrumentSharePct, 30);
  assert.equal(status.status, 'INSTRUMENT_DIVERSIFICATION_NOT_READY');
  assert.ok(status.blockers.includes('OOS_SINGLE_INSTRUMENT_CONCENTRATION_TOO_HIGH'));
});

test('inverse-HHI effective instrument count blocks a small dominant cluster even when single-instrument cap passes', () => {
  const records = Array.from({ length: 100 }, (_, index) => {
    let instrumentIndex;
    if (index < 25) instrumentIndex = 0;
    else if (index < 50) instrumentIndex = 1;
    else if (index < 75) instrumentIndex = 2;
    else instrumentIndex = 3 + ((index - 75) % 7);
    return syntheticRecord(index, { instrumentIndex });
  });
  const status = evaluateOosInstrumentConcentration(records, {
    maximumSingleInstrumentSharePct: 25,
    minimumEffectiveInstrumentCount: 6,
  });
  assert.equal(status.distinctInstrumentCount, 10);
  assert.equal(status.maximumSingleInstrumentSharePct, 25);
  assert.ok(status.effectiveInstrumentCount < 6);
  assert.equal(status.status, 'INSTRUMENT_DIVERSIFICATION_NOT_READY');
  assert.ok(status.blockers.includes('OOS_EFFECTIVE_INSTRUMENT_COUNT_TOO_SMALL'));
});

test('factor learning cannot promote strong diversified-date evidence dominated by three instruments', () => {
  const records = Array.from({ length: 240 }, (_, index) => syntheticRecord(index, {
    currentLineage: false,
    instrumentIndex: instrumentForLearningCluster(index),
  }));
  const group = buildForecastFactorLearningStatus({ records }).groups[0];
  assert.equal(group.maturedScoredCount, 240);
  assert.equal(group.sampleIndependence.status, 'INDEPENDENCE_READY');
  assert.equal(group.outcomeWindowIndependence.status, 'WINDOW_INDEPENDENCE_READY');
  assert.equal(group.instrumentConcentration.maximumSingleInstrumentSharePct, 25);
  assert.ok(group.instrumentConcentration.effectiveInstrumentCount < 6);
  assert.notEqual(group.status, 'PROMOTION_CANDIDATE');
  assert.ok(group.blockers.includes('OOS_EFFECTIVE_INSTRUMENT_COUNT_TOO_SMALL'));
});

test('factor attribution cannot nominate weight review from a small dominant instrument cluster', () => {
  const records = Array.from({ length: 240 }, (_, index) => syntheticRecord(index, {
    currentLineage: false,
    instrumentIndex: instrumentForLearningCluster(index),
  }));
  const domain = buildForecastFactorAttributionStatus({ records }).groups[0].domains.find((item) => item.domain === 'MOMENTUM');
  assert.equal(domain.maturedSampleSize, 240);
  assert.equal(domain.sampleIndependence.status, 'INDEPENDENCE_READY');
  assert.equal(domain.outcomeWindowIndependence.status, 'WINDOW_INDEPENDENCE_READY');
  assert.ok(domain.instrumentConcentration.effectiveInstrumentCount < 6);
  assert.equal(domain.manualWeightReviewCandidate, false);
  assert.ok(domain.blockers.includes('OOS_EFFECTIVE_INSTRUMENT_COUNT_TOO_SMALL'));
});

test('weight governance rejects concentrated evidence even when raw, date and outcome-window gates all pass', () => {
  const records = Array.from({ length: 360 }, (_, index) => syntheticRecord(index, {
    instrumentIndex: instrumentForGovernanceCluster(index),
  }));
  const status = buildForecastFactorWeightGovernanceStatus({
    records,
    attributionStatus: currentAttributionStatus(),
  });
  const momentum = status.groups[0].domains.find((item) => item.domain === 'MOMENTUM');
  assert.equal(momentum.maturedSampleSize, 360);
  assert.equal(momentum.sampleIndependence.status, 'INDEPENDENCE_READY');
  assert.equal(momentum.outcomeWindowIndependence.status, 'WINDOW_INDEPENDENCE_READY');
  assert.equal(momentum.instrumentConcentration.maximumSingleInstrumentSharePct, 20);
  assert.ok(momentum.instrumentConcentration.effectiveInstrumentCount < 8);
  assert.equal(status.proposalCount, 0);
  assert.ok(momentum.blockers.includes('OOS_EFFECTIVE_INSTRUMENT_COUNT_TOO_SMALL'));
});

test('production verifier independently rejects weakened instrument-concentration evidence on a valid proposal', () => {
  const records = Array.from({ length: 360 }, (_, index) => syntheticRecord(index));
  const attribution = currentAttributionStatus();
  const governance = buildForecastFactorWeightGovernanceStatus({ records, attributionStatus: attribution });
  assert.equal(governance.proposalCount, 1);
  const validReport = productionReport(governance, attribution);
  assert.equal(verifyForecastFactorProductionSafety(validReport).status, 'VERIFIED');

  const notReady = clone(validReport);
  notReady.forecastFactorWeightGovernanceStatus.proposals[0].evidence.instrumentConcentration.status = 'INSTRUMENT_DIVERSIFICATION_NOT_READY';
  assert.throws(
    () => verifyForecastFactorProductionSafety(notReady),
    /instrument diversification not ready/,
  );

  const weakThreshold = clone(validReport);
  weakThreshold.forecastFactorWeightGovernanceStatus.proposals[0].evidence.instrumentConcentration.thresholds.maximumSingleInstrumentSharePct = 50;
  assert.throws(
    () => verifyForecastFactorProductionSafety(weakThreshold),
    /single-instrument threshold too weak/,
  );
});
