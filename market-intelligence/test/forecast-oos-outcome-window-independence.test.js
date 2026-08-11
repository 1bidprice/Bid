import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOosOutcomeWindowIndependence } from '../src/forecast-oos-outcome-window-independence.js';
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

function timestamp(dayIndex, spacingDays = 1) {
  return new Date(Date.UTC(2024, 0, 1) + dayIndex * spacingDays * DAY_MS).toISOString();
}

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

function windowRecord(index, options = {}) {
  const dateIndex = options.dateIndex ?? index;
  const spacingDays = options.spacingDays ?? 1;
  const tradingDays = options.tradingDays ?? 21;
  const start = timestamp(dateIndex, spacingDays);
  const end = new Date(new Date(start).getTime() + tradingDays * DAY_MS).toISOString();
  const companyId = `company:${index % (options.instrumentCount || 20)}`;
  const instrumentId = `instrument:${index % (options.instrumentCount || 20)}`;
  return {
    forecastId: `window:${index}`,
    companyId,
    instrumentId,
    validationMode: 'LIVE_SHADOW_OOS',
    assetClass: 'EQUITY',
    horizon: options.horizon || 'month1',
    tradingDays,
    forecastAt: start,
    forecastSampleDate: start.slice(0, 10),
    referencePrice: { timestamp: start },
    status: 'MATURED',
    positiveOutcome: index % 2,
    realisedOutcome: {
      timestamp: options.invalidEnd ? null : end,
      realisedReturnPct: index % 2 ? 2 : -2,
    },
  };
}

function researchRecord(index, options = {}) {
  const base = windowRecord(index, options);
  const value = options.value ?? LEVELS[index % LEVELS.length];
  const positive = value > 0;
  return {
    ...base,
    classificationSnapshot: classificationSnapshot(index, base.companyId, base.instrumentId, base.forecastAt),
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
    positiveOutcome: positive ? 1 : 0,
    realisedOutcome: {
      ...base.realisedOutcome,
      realisedReturnPct: value * 10,
    },
  };
}

function attributionStatus(manualWeightReviewCandidate = true) {
  return {
    format: 'investor-control-forecast-factor-attribution-status',
    version: 1,
    lineageRecordCount: 360,
    groupCount: 1,
    manualWeightReviewCandidateCount: manualWeightReviewCandidate ? 1 : 0,
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
        manualWeightReviewCandidate,
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

test('consecutive month1 forecast dates do not masquerade as independent outcome windows', () => {
  const records = Array.from({ length: 60 }, (_, index) => windowRecord(index));
  const result = evaluateOosOutcomeWindowIndependence(records, {
    minimumEffectiveNonOverlappingWindows: 12,
  });
  assert.equal(result.distinctWindowDateCount, 60);
  assert.ok(result.effectiveNonOverlappingWindowCount < 12);
  assert.equal(result.status, 'WINDOW_INDEPENDENCE_NOT_READY');
  assert.ok(result.blockers.includes('OOS_NON_OVERLAPPING_OUTCOME_WINDOWS_TOO_SMALL'));
});

test('twelve genuinely non-overlapping month1 windows satisfy the learning threshold', () => {
  const records = Array.from({ length: 12 }, (_, index) => windowRecord(index, {
    spacingDays: 21,
  }));
  const result = evaluateOosOutcomeWindowIndependence(records, {
    minimumEffectiveNonOverlappingWindows: 12,
  });
  assert.equal(result.distinctWindowDateCount, 12);
  assert.equal(result.effectiveNonOverlappingWindowCount, 12);
  assert.equal(result.status, 'WINDOW_INDEPENDENCE_READY');
});

test('multiple instruments on one forecast date collapse into one conservative time cohort', () => {
  const records = Array.from({ length: 20 }, (_, index) => windowRecord(index, {
    dateIndex: 0,
    instrumentCount: 20,
  }));
  const result = evaluateOosOutcomeWindowIndependence(records, {
    minimumEffectiveNonOverlappingWindows: 2,
  });
  assert.equal(result.sampleSize, 20);
  assert.equal(result.distinctWindowDateCount, 1);
  assert.equal(result.effectiveNonOverlappingWindowCount, 1);
  assert.equal(result.status, 'WINDOW_INDEPENDENCE_NOT_READY');
});

test('malformed outcome windows and inconsistent horizon metadata fail closed', () => {
  const records = [
    windowRecord(0, { tradingDays: 21 }),
    windowRecord(1, { tradingDays: 5, spacingDays: 30 }),
    windowRecord(2, { tradingDays: 21, spacingDays: 60, invalidEnd: true }),
  ];
  const result = evaluateOosOutcomeWindowIndependence(records, {
    minimumEffectiveNonOverlappingWindows: 1,
  });
  assert.equal(result.invalidWindowRecordCount, 1);
  assert.equal(result.tradingDays, null);
  assert.ok(result.blockers.includes('OOS_OUTCOME_WINDOW_FIELDS_MISSING_OR_INVALID'));
  assert.ok(result.blockers.includes('OOS_OUTCOME_WINDOW_TRADING_DAYS_INCONSISTENT'));
  assert.equal(result.status, 'WINDOW_INDEPENDENCE_NOT_READY');
});

test('factor learning cannot promote 240 strong records when only two month1 outcome windows are non-overlapping', () => {
  const records = Array.from({ length: 240 }, (_, index) => researchRecord(index, {
    dateIndex: Math.floor(index / 6),
    currentLineage: false,
  }));
  const group = buildForecastFactorLearningStatus({ records }).groups[0];
  assert.equal(group.maturedScoredCount, 240);
  assert.equal(group.sampleIndependence.status, 'INDEPENDENCE_READY');
  assert.ok(group.outcomeWindowIndependence.effectiveNonOverlappingWindowCount < 12);
  assert.notEqual(group.status, 'PROMOTION_CANDIDATE');
  assert.ok(group.blockers.includes('OOS_NON_OVERLAPPING_OUTCOME_WINDOWS_TOO_SMALL'));
});

test('factor attribution cannot nominate weight review from heavily overlapping month1 outcomes', () => {
  const records = Array.from({ length: 240 }, (_, index) => researchRecord(index, {
    dateIndex: Math.floor(index / 6),
    currentLineage: false,
  }));
  const domain = buildForecastFactorAttributionStatus({ records }).groups[0].domains.find((item) => item.domain === 'MOMENTUM');
  assert.equal(domain.maturedSampleSize, 240);
  assert.equal(domain.sampleIndependence.status, 'INDEPENDENCE_READY');
  assert.ok(domain.outcomeWindowIndependence.effectiveNonOverlappingWindowCount < 12);
  assert.equal(domain.manualWeightReviewCandidate, false);
  assert.ok(domain.blockers.includes('OOS_NON_OVERLAPPING_OUTCOME_WINDOWS_TOO_SMALL'));
});

test('weight governance rejects 360 strong records across 60 dates when their month1 windows overlap', () => {
  const records = Array.from({ length: 360 }, (_, index) => researchRecord(index, {
    dateIndex: Math.floor(index / 6),
  }));
  const status = buildForecastFactorWeightGovernanceStatus({
    records,
    attributionStatus: attributionStatus(true),
  });
  const momentum = status.groups[0].domains.find((item) => item.domain === 'MOMENTUM');
  assert.equal(momentum.maturedSampleSize, 360);
  assert.equal(momentum.sampleIndependence.status, 'INDEPENDENCE_READY');
  assert.ok(momentum.outcomeWindowIndependence.effectiveNonOverlappingWindowCount < 18);
  assert.equal(status.proposalCount, 0);
  assert.ok(momentum.blockers.includes('OOS_NON_OVERLAPPING_OUTCOME_WINDOWS_TOO_SMALL'));
});

test('production verifier independently rejects weakened date or outcome-window evidence on a governance proposal', () => {
  const records = Array.from({ length: 360 }, (_, index) => researchRecord(index, {
    dateIndex: Math.floor(index / 6),
    spacingDays: 21,
  }));
  const attribution = attributionStatus(true);
  const governance = buildForecastFactorWeightGovernanceStatus({
    records,
    attributionStatus: attribution,
  });
  assert.equal(governance.proposalCount, 1);
  const validReport = productionReport(governance, attribution);
  assert.equal(verifyForecastFactorProductionSafety(validReport).status, 'VERIFIED');

  const badWindows = clone(validReport);
  badWindows.forecastFactorWeightGovernanceStatus.proposals[0].evidence.outcomeWindowIndependence.status = 'WINDOW_INDEPENDENCE_NOT_READY';
  assert.throws(
    () => verifyForecastFactorProductionSafety(badWindows),
    /outcome-window independence not ready/,
  );

  const weakDates = clone(validReport);
  weakDates.forecastFactorWeightGovernanceStatus.proposals[0].evidence.sampleIndependence.thresholds.minimumDistinctForecastDates = 20;
  assert.throws(
    () => verifyForecastFactorProductionSafety(weakDates),
    /distinct-date threshold too weak/,
  );
});