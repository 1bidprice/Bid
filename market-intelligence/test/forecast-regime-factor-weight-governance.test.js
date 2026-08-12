import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecastRegimeFactorWeightGovernanceStatus } from '../src/forecast-regime-factor-weight-governance.js';
import {
  buildForecastRegimeFactorGovernanceOperationalTelemetry,
  verifyForecastRegimeFactorGovernanceProductionSafety,
} from '../src/forecast-regime-factor-governance-production-safety.js';
import { FORECAST_FEATURE_VECTOR_VERSION } from '../src/forecast-feature-vector.js';
import { FORECAST_FACTOR_SCORE_VERSION } from '../src/forecast-factor-score.js';
import { FORECAST_MARKET_REGIME_VERSION } from '../src/forecast-market-regime.js';
import { FORECAST_CLASSIFICATION_CONTRACT, FORECAST_CLASSIFICATION_LINEAGE_VERSION } from '../src/forecast-classification-lineage.js';

const LEVELS = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];
const SIC_CODES = ['1000', '2000', '2800', '3500', '4800', '6000'];
const RISK_ON = 'RISK_ON|BULL_TREND|NORMAL_VOLATILITY|POSITIVE_MOMENTUM';
const RISK_OFF = 'RISK_OFF|BEAR_TREND|HIGH_VOLATILITY|NEGATIVE_MOMENTUM';

function regimeSnapshot(forecastAt, regimeKey = RISK_ON) {
  const riskOff = regimeKey === RISK_OFF;
  return {
    contract: 'FORECAST_TIME_MARKET_REGIME_SNAPSHOT_V1',
    policyVersion: FORECAST_MARKET_REGIME_VERSION,
    capturedAt: forecastAt,
    benchmarkAsOf: forecastAt,
    benchmarkSymbol: 'SPY',
    benchmarkSource: 'fixture',
    benchmarkSourceQuality: 'VERIFIED',
    observationCount: 260,
    status: 'REGIME_READY',
    regimeKey,
    riskTone: riskOff ? 'RISK_OFF' : 'RISK_ON',
    trendRegime: riskOff ? 'BEAR_TREND' : 'BULL_TREND',
    momentumRegime: riskOff ? 'NEGATIVE_MOMENTUM' : 'POSITIVE_MOMENTUM',
    volatilityRegime: riskOff ? 'HIGH_VOLATILITY' : 'NORMAL_VOLATILITY',
    metrics: {},
    blockers: [],
    researchOnly: true,
    modelDerived: true,
    finalActionEligible: false,
    decisionImpact: 'NONE',
  };
}

function classificationSnapshot(index, companyId, instrumentId, forecastAt, singleCluster = false) {
  const cik = String((index % 20) + 1).padStart(10, '0');
  return {
    contract: FORECAST_CLASSIFICATION_CONTRACT,
    policyVersion: FORECAST_CLASSIFICATION_LINEAGE_VERSION,
    companyId,
    instrumentId,
    sourceAuthority: 'SEC_EDGAR_SUBMISSIONS',
    sourceUrl: `https://data.sec.gov/submissions/CIK${cik}.json`,
    sourceDocumentId: `CIK${cik}`,
    capturedAt: forecastAt,
    taxonomy: 'SEC_SIC',
    code: singleCluster ? '6000' : SIC_CODES[index % SIC_CODES.length],
    description: 'Synthetic SEC SIC governance fixture',
    inferenceUsed: false,
    decisionImpact: 'NONE',
  };
}

function record(index, options = {}) {
  const domain = options.domain || 'MOMENTUM';
  const value = options.value ?? LEVELS[index % LEVELS.length];
  const invert = options.invert === true;
  const positive = invert ? value < 0 : value > 0;
  const start = new Date(Date.UTC(2020, 0, 1) + index * 30 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 25 * 24 * 60 * 60 * 1000);
  const forecastAt = start.toISOString();
  const companyId = `company:${index % 20}`;
  const instrumentId = `instrument:${index % 20}`;
  const regimeKey = options.regimeKey || RISK_ON;
  return {
    forecastId: `regime-gov:${domain}:${regimeKey}:${index}`,
    companyId,
    instrumentId,
    symbol: `SYM${index % 20}`,
    listing: { symbol: `SYM${index % 20}`, mic: 'XNAS', currency: 'USD' },
    validationMode: 'LIVE_SHADOW_OOS',
    factorFeatureVectorPolicyVersion: FORECAST_FEATURE_VECTOR_VERSION,
    factorScorePolicyVersion: FORECAST_FACTOR_SCORE_VERSION,
    factorDomainSnapshot: [{ domain, value, weight: domain === 'RISK' ? 0.09 : 0.16, verifiedDriverCount: 1 }],
    assetClass: 'EQUITY',
    horizon: 'month1',
    tradingDays: 21,
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    referencePrice: { value: 100, timestamp: forecastAt, currency: 'USD', source: 'fixture' },
    status: 'MATURED',
    positiveOutcome: options.outcome ?? (positive ? 1 : 0),
    realisedOutcome: {
      timestamp: end.toISOString(),
      realisedReturnPct: options.realisedReturnPct ?? (invert ? -value * 10 : value * 10),
    },
    classificationSnapshot: classificationSnapshot(index, companyId, instrumentId, forecastAt, options.singleCluster === true),
    marketRegimeSnapshot: regimeSnapshot(forecastAt, regimeKey),
  };
}

function regimeFactorAttributionStatus({ domain = 'MOMENTUM', signal = 'SUPPORTED_IN_REGIME', regimeKeys = [RISK_ON] } = {}) {
  return {
    groups: [{
      factorFeatureVectorPolicyVersion: FORECAST_FEATURE_VECTOR_VERSION,
      factorScorePolicyVersion: FORECAST_FACTOR_SCORE_VERSION,
      assetClass: 'EQUITY',
      horizon: 'month1',
      regimes: regimeKeys.map((regimeKey) => ({
        regimeKey,
        domains: [{ domain, status: 'REGIME_FACTOR_RESEARCH_READY', signal }],
      })),
    }],
  };
}

function regimeLearningStatus(regimeKeys = [RISK_ON]) {
  return {
    groups: [{
      historicalPatternPolicyVersion: 'pattern-current',
      assetClass: 'EQUITY',
      horizon: 'month1',
      regimes: regimeKeys.map((regimeKey) => ({ regimeKey, status: 'REGIME_RESEARCH_READY' })),
    }],
  };
}

function buildStatus(records, options = {}) {
  return buildForecastRegimeFactorWeightGovernanceStatus({
    generatedAt: '2026-08-12T12:00:00.000Z',
    records,
    regimeFactorAttributionStatus: options.regimeFactorAttributionStatus || regimeFactorAttributionStatus({ domain: options.domain, signal: options.signal, regimeKeys: options.regimeKeys }),
    regimeLearningStatus: options.regimeLearningStatus || regimeLearningStatus(options.regimeKeys),
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('regime governance stays silent below the 200 matured OOS floor even with ready upstream research', () => {
  const status = buildStatus(Array.from({ length: 199 }, (_, index) => record(index)));
  assert.equal(status.proposalCount, 0);
  const momentum = status.groups[0].domains.find((item) => item.domain === 'MOMENTUM');
  assert.ok(momentum.blockers.includes('REGIME_GOVERNANCE_MATURED_OOS_SAMPLE_TOO_SMALL'));
  assert.equal(status.automaticRegimeWeightingEnabled, false);
  assert.equal(status.decisionIntegrationEnabled, false);
});

test('strong stable supported factor creates only a bounded regime-specific INCREASE_REVIEW proposal', () => {
  const status = buildStatus(Array.from({ length: 240 }, (_, index) => record(index)));
  assert.equal(status.proposalCount, 1);
  const proposal = status.proposals[0];
  assert.equal(proposal.scope, 'REGIME_ONLY_MANUAL_REVIEW');
  assert.equal(proposal.domain, 'MOMENTUM');
  assert.equal(proposal.direction, 'INCREASE_REVIEW');
  assert.equal(proposal.directWeightDelta, 0.01);
  assert.equal(proposal.currentGlobalWeight, 0.16);
  assert.equal(proposal.proposedRegimeWeight, 0.17);
  assert.equal(proposal.changesGlobalWeights, false);
  assert.equal(proposal.automaticApplicationAllowed, false);
  assert.equal(proposal.requiresNewRegimePolicyVersionOnApproval, true);
  assert.equal(proposal.evidence.temporalStability.status, 'STABILITY_READY');
  assert.equal(proposal.evidence.sampleIndependence.status, 'INDEPENDENCE_READY');
  assert.equal(proposal.evidence.outcomeWindowIndependence.status, 'WINDOW_INDEPENDENCE_READY');
  assert.equal(proposal.evidence.taxonomyConcentration.status, 'TAXONOMY_DIVERSIFICATION_READY');
  assert.equal(Number(Object.values(proposal.reviewRegimeWeights).reduce((sum, value) => sum + value, 0).toFixed(6)), 1);
});

test('strong stable inverted non-risk factor creates only a bounded regime-specific DECREASE_REVIEW proposal', () => {
  const records = Array.from({ length: 240 }, (_, index) => record(index, { invert: true }));
  const status = buildStatus(records, {
    signal: 'INVERTED_IN_REGIME',
    regimeFactorAttributionStatus: regimeFactorAttributionStatus({ signal: 'INVERTED_IN_REGIME' }),
  });
  assert.equal(status.proposalCount, 1);
  const proposal = status.proposals[0];
  assert.equal(proposal.direction, 'DECREASE_REVIEW');
  assert.equal(proposal.directWeightDelta, -0.01);
  assert.equal(proposal.proposedRegimeWeight, 0.15);
  assert.ok(proposal.reviewRegimeWeights.RISK >= proposal.beforeGlobalWeights.RISK);
});

test('RISK can never receive a regime-specific decrease proposal', () => {
  const records = Array.from({ length: 240 }, (_, index) => record(index, { domain: 'RISK', invert: true }));
  const status = buildStatus(records, {
    domain: 'RISK',
    signal: 'INVERTED_IN_REGIME',
    regimeFactorAttributionStatus: regimeFactorAttributionStatus({ domain: 'RISK', signal: 'INVERTED_IN_REGIME' }),
  });
  assert.equal(status.proposalCount, 0);
  const risk = status.groups[0].domains.find((item) => item.domain === 'RISK');
  assert.ok(risk.blockers.includes('RISK_WEIGHT_DECREASE_PROHIBITED'));
});

test('different market regimes are never pooled to reach the governance sample floor', () => {
  const records = [
    ...Array.from({ length: 120 }, (_, index) => record(index, { regimeKey: RISK_ON })),
    ...Array.from({ length: 120 }, (_, index) => record(index + 200, { regimeKey: RISK_OFF })),
  ];
  const status = buildStatus(records, {
    regimeKeys: [RISK_ON, RISK_OFF],
    regimeFactorAttributionStatus: regimeFactorAttributionStatus({ regimeKeys: [RISK_ON, RISK_OFF] }),
    regimeLearningStatus: regimeLearningStatus([RISK_ON, RISK_OFF]),
  });
  assert.equal(status.groupCount, 2);
  assert.equal(status.proposalCount, 0);
  assert.ok(status.groups.every((group) => group.domains.find((item) => item.domain === 'MOMENTUM').blockers.includes('REGIME_GOVERNANCE_MATURED_OOS_SAMPLE_TOO_SMALL')));
});

test('aggregate strength cannot bypass instability inside the first chronological regime subperiod', () => {
  const records = Array.from({ length: 240 }, (_, index) => record(index, { invert: index < 80 }));
  const status = buildStatus(records);
  assert.equal(status.proposalCount, 0);
  const momentum = status.groups[0].domains.find((item) => item.domain === 'MOMENTUM');
  assert.equal(momentum.temporalStability.status, 'UNSTABLE');
  assert.equal(momentum.temporalStability.subperiods[0].status, 'UNSTABLE');
  assert.ok(momentum.blockers.includes('REGIME_GOVERNANCE_SIGNAL_NOT_TEMPORALLY_STABLE'));
});

test('taxonomy concentration blocks regime governance despite strong dates, windows and instruments', () => {
  const records = Array.from({ length: 240 }, (_, index) => record(index, { singleCluster: true }));
  const status = buildStatus(records);
  assert.equal(status.proposalCount, 0);
  const momentum = status.groups[0].domains.find((item) => item.domain === 'MOMENTUM');
  assert.equal(momentum.taxonomyConcentration.status, 'TAXONOMY_DIVERSIFICATION_NOT_READY');
  assert.ok(momentum.blockers.some((blocker) => blocker.includes('TAXONOMY') || blocker.includes('NATIVE_CLUSTER')));
});

test('regime governance requires both upstream regime research and regime-factor research readiness', () => {
  const records = Array.from({ length: 240 }, (_, index) => record(index));
  const noRegime = buildForecastRegimeFactorWeightGovernanceStatus({
    records,
    regimeLearningStatus: { groups: [] },
    regimeFactorAttributionStatus: regimeFactorAttributionStatus(),
  });
  assert.equal(noRegime.proposalCount, 0);
  assert.ok(noRegime.groups[0].domains.find((item) => item.domain === 'MOMENTUM').blockers.includes('UPSTREAM_REGIME_RESEARCH_READY_REQUIRED'));

  const noFactor = buildForecastRegimeFactorWeightGovernanceStatus({
    records,
    regimeLearningStatus: regimeLearningStatus(),
    regimeFactorAttributionStatus: { groups: [] },
  });
  assert.equal(noFactor.proposalCount, 0);
  assert.ok(noFactor.groups[0].domains.find((item) => item.domain === 'MOMENTUM').blockers.includes('UPSTREAM_REGIME_FACTOR_RESEARCH_READY_REQUIRED'));
});

test('production firewall accepts a valid regime-only manual proposal and rejects authority or weakened evidence', () => {
  const governance = buildStatus(Array.from({ length: 240 }, (_, index) => record(index)));
  const report = { forecastRegimeFactorWeightGovernanceStatus: governance };
  report.operationalHealth = buildForecastRegimeFactorGovernanceOperationalTelemetry(governance);
  assert.equal(verifyForecastRegimeFactorGovernanceProductionSafety(report).status, 'VERIFIED');

  const auto = clone(report);
  auto.forecastRegimeFactorWeightGovernanceStatus.automaticProposalApplicationEnabled = true;
  auto.operationalHealth = buildForecastRegimeFactorGovernanceOperationalTelemetry(auto.forecastRegimeFactorWeightGovernanceStatus);
  assert.throws(() => verifyForecastRegimeFactorGovernanceProductionSafety(auto), /automaticProposalApplicationEnabled must remain false/);

  const global = clone(report);
  global.forecastRegimeFactorWeightGovernanceStatus.proposals[0].scope = 'GLOBAL';
  assert.throws(() => verifyForecastRegimeFactorGovernanceProductionSafety(global), /scope must remain regime-only/);

  const weak = clone(report);
  weak.forecastRegimeFactorWeightGovernanceStatus.proposals[0].evidence.sampleIndependence.thresholds.minimumDistinctForecastDates = 10;
  assert.throws(() => verifyForecastRegimeFactorGovernanceProductionSafety(weak), /distinct-date threshold too weak/);
});
