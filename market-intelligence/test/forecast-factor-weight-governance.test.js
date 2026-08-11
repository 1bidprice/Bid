import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildForecastFactorWeightGovernanceStatus,
  FORECAST_FACTOR_WEIGHT_GOVERNANCE_VERSION,
} from '../src/forecast-factor-weight-governance.js';
import {
  FORECAST_FEATURE_VECTOR_VERSION,
  FORECAST_FACTOR_DOMAIN_WEIGHTS,
} from '../src/forecast-feature-vector.js';
import { FORECAST_FACTOR_SCORE_VERSION } from '../src/forecast-factor-score.js';

const LEVELS = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];

function record(index, options = {}) {
  const domain = options.domain || 'MOMENTUM';
  const value = options.value ?? LEVELS[index % LEVELS.length];
  const invert = options.invert === true;
  const positive = invert ? value < 0 : value > 0;
  const forecastAt = new Date(Date.UTC(2025, 0, 1 + index)).toISOString();
  return {
    forecastId: `gov:${domain}:${index}:${options.vectorVersion || 'current'}`,
    validationMode: 'LIVE_SHADOW_OOS',
    factorFeatureVectorPolicyVersion: options.vectorVersion || FORECAST_FEATURE_VECTOR_VERSION,
    factorScorePolicyVersion: options.scoreVersion || FORECAST_FACTOR_SCORE_VERSION,
    factorDomainSnapshot: [{
      domain,
      value,
      weight: FORECAST_FACTOR_DOMAIN_WEIGHTS[domain],
      verifiedDriverCount: 1,
    }],
    assetClass: options.assetClass || 'EQUITY',
    horizon: options.horizon || 'month1',
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    status: 'MATURED',
    positiveOutcome: options.outcome ?? (positive ? 1 : 0),
    realisedOutcome: {
      realisedReturnPct: options.realisedReturnPct ?? (invert ? -value * 10 : value * 10),
    },
  };
}

function attributionStatus(domain = 'MOMENTUM', manualWeightReviewCandidate = true, options = {}) {
  return {
    groups: [{
      factorFeatureVectorPolicyVersion: options.vectorVersion || FORECAST_FEATURE_VECTOR_VERSION,
      factorScorePolicyVersion: options.scoreVersion || FORECAST_FACTOR_SCORE_VERSION,
      assetClass: options.assetClass || 'EQUITY',
      horizon: options.horizon || 'month1',
      domains: [{
        domain,
        status: options.status || 'PREDICTIVE_DIRECTION_SUPPORTED',
        manualWeightReviewCandidate,
      }],
    }],
  };
}

function domain(status, name) {
  return status.groups[0]?.domains.find((item) => item.domain === name);
}

function weightSum(weights) {
  return Object.values(weights).reduce((sum, value) => sum + value, 0);
}

test('governance stays silent below the 300 matured OOS floor', () => {
  const records = Array.from({ length: 299 }, (_, index) => record(index));
  const status = buildForecastFactorWeightGovernanceStatus({ records, attributionStatus: attributionStatus() });
  const momentum = domain(status, 'MOMENTUM');
  assert.equal(status.proposalCount, 0);
  assert.equal(momentum.maturedSampleSize, 299);
  assert.ok(momentum.blockers.includes('GOVERNANCE_MATURED_OOS_SAMPLE_TOO_SMALL'));
  assert.equal(status.automaticWeightAdjustmentEnabled, false);
});

test('obsolete feature-vector or factor-score lineage cannot propose current weights', () => {
  const records = [
    ...Array.from({ length: 360 }, (_, index) => record(index, { vectorVersion: 'old-vector' })),
    ...Array.from({ length: 360 }, (_, index) => record(index + 400, { scoreVersion: 'old-score' })),
  ];
  const status = buildForecastFactorWeightGovernanceStatus({ records, attributionStatus: attributionStatus() });
  assert.equal(status.lineageRecordCount, 0);
  assert.equal(status.groupCount, 0);
  assert.equal(status.proposalCount, 0);
});

test('strong stable current-version domain creates only a bounded INCREASE_REVIEW proposal', () => {
  const records = Array.from({ length: 360 }, (_, index) => record(index));
  const status = buildForecastFactorWeightGovernanceStatus({ records, attributionStatus: attributionStatus() });
  assert.equal(status.policyVersion, FORECAST_FACTOR_WEIGHT_GOVERNANCE_VERSION);
  assert.equal(status.proposalCount, 1);
  const proposal = status.proposals[0];
  assert.equal(proposal.domain, 'MOMENTUM');
  assert.equal(proposal.direction, 'INCREASE_REVIEW');
  assert.equal(proposal.reviewState, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(proposal.currentWeight, 0.16);
  assert.equal(proposal.proposedWeight, 0.18);
  assert.equal(proposal.directWeightDelta, 0.02);
  assert.equal(proposal.afterWeights.RISK, 0.09);
  assert.equal(Number(weightSum(proposal.beforeWeights).toFixed(6)), 1);
  assert.equal(Number(weightSum(proposal.afterWeights).toFixed(6)), 1);
  assert.equal(proposal.automaticApplicationAllowed, false);
  assert.equal(proposal.requiresNewPolicyVersionOnApproval, true);
  assert.equal(proposal.rollbackPlan.rewriteHistoricalOosRecords, false);
  assert.ok(proposal.evidence.temporalSubperiods.every((period) => period.status === 'STABLE'));
});

test('strong stable inverted non-risk domain creates only a bounded DECREASE_REVIEW proposal', () => {
  const records = Array.from({ length: 360 }, (_, index) => record(index, { invert: true }));
  const status = buildForecastFactorWeightGovernanceStatus({
    records,
    attributionStatus: attributionStatus('MOMENTUM', true, { status: 'INVERTED_OR_NONPREDICTIVE' }),
  });
  assert.equal(status.proposalCount, 1);
  const proposal = status.proposals[0];
  assert.equal(proposal.direction, 'DECREASE_REVIEW');
  assert.equal(proposal.currentWeight, 0.16);
  assert.equal(proposal.proposedWeight, 0.14);
  assert.equal(proposal.directWeightDelta, -0.02);
  assert.ok(proposal.afterWeights.RISK >= proposal.beforeWeights.RISK);
  assert.equal(Number(weightSum(proposal.afterWeights).toFixed(6)), 1);
});

test('RISK weight can never receive a decrease proposal even under strongly inverted OOS evidence', () => {
  const records = Array.from({ length: 360 }, (_, index) => record(index, { domain: 'RISK', invert: true }));
  const status = buildForecastFactorWeightGovernanceStatus({
    records,
    attributionStatus: attributionStatus('RISK', true, { status: 'INVERTED_OR_NONPREDICTIVE' }),
  });
  const risk = domain(status, 'RISK');
  assert.equal(status.proposalCount, 0);
  assert.equal(risk.proposedDirection, null);
  assert.ok(risk.blockers.includes('RISK_WEIGHT_DECREASE_PROHIBITED'));
});

test('aggregate strength cannot bypass chronological domain instability', () => {
  const records = Array.from({ length: 360 }, (_, index) => record(index, { invert: index < 120 }));
  const status = buildForecastFactorWeightGovernanceStatus({ records, attributionStatus: attributionStatus() });
  const momentum = domain(status, 'MOMENTUM');
  assert.ok(momentum.rocAuc >= 0.6);
  assert.equal(momentum.temporalStability.status, 'UNSTABLE');
  assert.equal(momentum.temporalStability.subperiods[0].status, 'UNSTABLE');
  assert.equal(status.proposalCount, 0);
  assert.ok(momentum.blockers.includes('GOVERNANCE_DOMAIN_SIGNAL_NOT_TEMPORALLY_STABLE'));
});

test('governance requires the current upstream attribution manual-review gate', () => {
  const records = Array.from({ length: 360 }, (_, index) => record(index));
  const status = buildForecastFactorWeightGovernanceStatus({
    records,
    attributionStatus: attributionStatus('MOMENTUM', false),
  });
  const momentum = domain(status, 'MOMENTUM');
  assert.equal(status.proposalCount, 0);
  assert.ok(momentum.blockers.includes('UPSTREAM_ATTRIBUTION_MANUAL_REVIEW_GATE_NOT_READY'));
});

test('malformed matured outcomes are excluded and block governance proposals', () => {
  const records = Array.from({ length: 360 }, (_, index) => record(index));
  records.push({ ...record(500), forecastId: 'gov:malformed:string', positiveOutcome: '1' });
  const status = buildForecastFactorWeightGovernanceStatus({ records, attributionStatus: attributionStatus() });
  const momentum = domain(status, 'MOMENTUM');
  assert.equal(momentum.maturedSampleSize, 360);
  assert.equal(momentum.invalidMaturedOutcomeCount, 1);
  assert.equal(status.proposalCount, 0);
  assert.ok(momentum.blockers.includes('INVALID_MATURED_BINARY_OUTCOME_RECORDS_EXCLUDED'));
});

test('governance output cannot auto-apply weights, create probabilities or gain final-action authority', () => {
  const records = Array.from({ length: 360 }, (_, index) => record(index));
  const status = buildForecastFactorWeightGovernanceStatus({ records, attributionStatus: attributionStatus() });
  const text = JSON.stringify(status);
  assert.equal(status.automaticWeightAdjustmentEnabled, false);
  assert.equal(status.automaticProposalApplicationEnabled, false);
  assert.equal(status.probabilityCalibrationEnabled, false);
  assert.equal(status.decisionIntegrationEnabled, false);
  assert.equal(status.forecastMayInfluenceFinalAction, false);
  assert.equal(text.includes('BUY_NOW'), false);
  assert.equal(text.includes('SELL_NOW'), false);
  assert.equal(text.includes('calibratedProbability'), false);
});
