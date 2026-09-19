import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildForecastFactorOperationalTelemetry,
  verifyForecastFactorProductionSafety,
  FORECAST_FACTOR_PRODUCTION_OBSERVABILITY_CONTRACT,
} from '../src/forecast-factor-production-safety.js';
import { buildForecastFactorWeightGovernanceStatus } from '../src/forecast-factor-weight-governance.js';
import { FORECAST_FEATURE_VECTOR_VERSION, FORECAST_FACTOR_DOMAIN_WEIGHTS } from '../src/forecast-feature-vector.js';
import { FORECAST_FACTOR_SCORE_VERSION } from '../src/forecast-factor-score.js';

const LEVELS = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];

function classificationSnapshot(index, companyId, instrumentId, forecastAt) {
  const majorGroups = ['10', '20', '30', '40', '50', '60'];
  const code = majorGroups[index % majorGroups.length] + '00';
  const cik = String((index % 20) + 1).padStart(10, '0');
  return {
    contract: 'FORECAST_TIME_CLASSIFICATION_SNAPSHOT_V1',
    policyVersion: '2026-08-11.1',
    companyId,
    instrumentId,
    sourceAuthority: 'SEC_EDGAR_SUBMISSIONS',
    sourceUrl: 'https://data.sec.gov/submissions/CIK' + cik + '.json',
    sourceDocumentId: 'CIK' + cik,
    capturedAt: forecastAt,
    taxonomy: 'SEC_SIC',
    code,
    description: 'Synthetic SIC ' + code,
    inferenceUsed: false,
    decisionImpact: 'NONE',
  };
}

function record(index) {
  const value = LEVELS[index % LEVELS.length];
  const positive = value > 0;
  const forecastAt = new Date(Date.UTC(2000, 0, 1) + index * 30 * 86_400_000).toISOString();
  const tradingDays = 21;
  const outcomeAt = new Date(new Date(forecastAt).getTime() + tradingDays * 86_400_000).toISOString();
  const companyId = 'company:' + (index % 20);
  const instrumentId = 'instrument:' + (index % 20);
  return {
    forecastId: 'prod-safe:' + index,
    companyId,
    instrumentId,
    classificationSnapshot: classificationSnapshot(index, companyId, instrumentId, forecastAt),
    validationMode: 'LIVE_SHADOW_OOS',
    factorFeatureVectorPolicyVersion: FORECAST_FEATURE_VECTOR_VERSION,
    factorScorePolicyVersion: FORECAST_FACTOR_SCORE_VERSION,
    factorDomainSnapshot: [{ domain: 'MOMENTUM', value, weight: FORECAST_FACTOR_DOMAIN_WEIGHTS.MOMENTUM, verifiedDriverCount: 1 }],
    assetClass: 'EQUITY',
    horizon: 'month1',
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    tradingDays,
    referencePrice: { timestamp: forecastAt },
    status: 'MATURED',
    positiveOutcome: positive ? 1 : 0,
    realisedOutcome: { timestamp: outcomeAt, realisedReturnPct: value * 10 },
  };
}

function learningStatus() {
  return {
    format: 'investor-control-forecast-factor-learning-status',
    version: 1,
    lineageRecordCount: 360,
    maturedScoredCount: 360,
    groupCount: 1,
    promotionCandidateGroupCount: 0,
    probabilityCalibrationEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    groups: [{ status: 'DISCRIMINATION_NOT_READY' }],
  };
}

function attributionStatus(manual = true) {
  return {
    format: 'investor-control-forecast-factor-attribution-status',
    version: 1,
    lineageRecordCount: 360,
    groupCount: 1,
    manualWeightReviewCandidateCount: manual ? 1 : 0,
    automaticWeightAdjustmentEnabled: false,
    decisionIntegrationEnabled: false,
    forecastMayInfluenceFinalAction: false,
    groups: [{
      factorFeatureVectorPolicyVersion: FORECAST_FEATURE_VECTOR_VERSION,
      factorScorePolicyVersion: FORECAST_FACTOR_SCORE_VERSION,
      assetClass: 'EQUITY',
      horizon: 'month1',
      domains: [{ domain: 'MOMENTUM', status: 'PREDICTIVE_DIRECTION_SUPPORTED', manualWeightReviewCandidate: manual }],
    }],
  };
}

function makeReport({ withProposal = false } = {}) {
  const attribution = attributionStatus(withProposal);
  const governance = buildForecastFactorWeightGovernanceStatus({
    records: withProposal ? Array.from({ length: 360 }, (_, index) => record(index)) : [],
    attributionStatus: attribution,
  });
  const report = {
    forecastFactorLearningStatus: learningStatus(),
    forecastFactorAttributionStatus: attribution,
    forecastFactorWeightGovernanceStatus: governance,
  };
  report.operationalHealth = buildForecastFactorOperationalTelemetry(report);
  return report;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('compact factor production telemetry contains counters and safety flags but no raw proposal payload', () => {
  const report = makeReport({ withProposal: true });
  const telemetry = report.operationalHealth;
  assert.equal(telemetry.forecastFactorObservabilityContract, FORECAST_FACTOR_PRODUCTION_OBSERVABILITY_CONTRACT);
  assert.equal(telemetry.forecastFactorGovernanceProposalCount, 1);
  assert.equal(telemetry.forecastFactorAutomaticWeightAdjustmentEnabled, false);
  assert.equal(telemetry.forecastFactorAutomaticProposalApplicationEnabled, false);
  assert.equal(JSON.stringify(telemetry).includes('beforeWeights'), false);
  assert.equal(JSON.stringify(telemetry).includes('afterWeights'), false);
  assert.equal(JSON.stringify(telemetry).includes('factorDomainSnapshot'), false);
});

test('production factor safety accepts a valid manual-only governance report', () => {
  const report = makeReport({ withProposal: true });
  const result = verifyForecastFactorProductionSafety(report);
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.telemetry.forecastFactorGovernanceProposalCount, 1);
});

test('production factor safety rejects any automatic governance application flag', () => {
  const report = makeReport({ withProposal: false });
  report.forecastFactorWeightGovernanceStatus.automaticProposalApplicationEnabled = true;
  report.operationalHealth = buildForecastFactorOperationalTelemetry(report);
  assert.throws(() => verifyForecastFactorProductionSafety(report), /automatic proposal application must be false/);
});

test('production factor safety rejects a proposal that reduces RISK weight', () => {
  const report = clone(makeReport({ withProposal: true }));
  const proposal = report.forecastFactorWeightGovernanceStatus.proposals[0];
  proposal.afterWeights.RISK = proposal.beforeWeights.RISK - 0.01;
  proposal.afterWeights.QUALITY += 0.01;
  proposal.afterWeightSum = 1;
  const groupProposal = report.forecastFactorWeightGovernanceStatus.groups[0].proposals[0];
  groupProposal.afterWeights = proposal.afterWeights;
  groupProposal.afterWeightSum = 1;
  assert.throws(() => verifyForecastFactorProductionSafety(report), /reduces RISK weight/);
});

test('production factor safety rejects malformed weight sums even when proposal counters match', () => {
  const report = clone(makeReport({ withProposal: true }));
  const proposal = report.forecastFactorWeightGovernanceStatus.proposals[0];
  proposal.afterWeights.QUALITY += 0.03;
  const groupProposal = report.forecastFactorWeightGovernanceStatus.groups[0].proposals[0];
  groupProposal.afterWeights = proposal.afterWeights;
  assert.throws(() => verifyForecastFactorProductionSafety(report), /afterWeights does not sum to 1/);
});

test('production factor safety rejects proposals without immutable rollback and new-version requirements', () => {
  const report = clone(makeReport({ withProposal: true }));
  const proposal = report.forecastFactorWeightGovernanceStatus.proposals[0];
  proposal.requiresNewPolicyVersionOnApproval = false;
  assert.throws(() => verifyForecastFactorProductionSafety(report), /missing new-version requirement/);

  const second = clone(makeReport({ withProposal: true }));
  second.forecastFactorWeightGovernanceStatus.proposals[0].rollbackPlan.rewriteHistoricalOosRecords = true;
  assert.throws(() => verifyForecastFactorProductionSafety(second), /rewrites historical OOS records/);
});

test('production factor safety rejects telemetry mismatch and raw governance leakage into operational health', () => {
  const report = makeReport({ withProposal: false });
  report.operationalHealth.forecastFactorGovernanceProposalCount = 99;
  assert.throws(() => verifyForecastFactorProductionSafety(report), /telemetry mismatch/);

  const leaked = makeReport({ withProposal: false });
  leaked.operationalHealth.beforeWeights = { ...FORECAST_FACTOR_DOMAIN_WEIGHTS };
  assert.throws(() => verifyForecastFactorProductionSafety(leaked), /raw factor governance payload leaked/);
});

test('production factor safety rejects weakened or cross-mapped taxonomy evidence', () => {
  const weak = clone(makeReport({ withProposal: true }));
  weak.forecastFactorWeightGovernanceStatus.proposals[0].evidence.taxonomyConcentration.thresholds.minimumClassificationCoveragePct = 50;
  assert.throws(() => verifyForecastFactorProductionSafety(weak), /classification coverage threshold too weak/);

  const mapped = clone(makeReport({ withProposal: true }));
  mapped.forecastFactorWeightGovernanceStatus.proposals[0].evidence.taxonomyConcentration.crossTaxonomyMappingUsed = true;
  assert.throws(() => verifyForecastFactorProductionSafety(mapped), /cross-taxonomy mapping is forbidden/);
});
