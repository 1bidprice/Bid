import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildForecastRegimeFactorAttributionStatus } from '../src/forecast-regime-factor-attribution.js';
import {
  buildForecastRegimeFactorOperationalTelemetry,
  verifyForecastRegimeFactorProductionSafety,
} from '../src/forecast-regime-factor-production-safety.js';

const DAY_MS = 86_400_000;
const START = Date.UTC(2000, 0, 1);
const LEVELS = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];
const SIC_GROUPS = ['10', '20', '30', '40', '50', '60'];

function regime(forecastAt) {
  return {
    contract: 'FORECAST_TIME_MARKET_REGIME_SNAPSHOT_V1',
    policyVersion: '2026-08-12.1',
    capturedAt: forecastAt,
    benchmarkAsOf: forecastAt,
    benchmarkSymbol: 'SPY',
    benchmarkSource: 'synthetic benchmark',
    benchmarkSourceQuality: 'TEST',
    observationCount: 300,
    status: 'REGIME_READY',
    regimeKey: 'RISK_ON|BULL_TREND|LOW_VOLATILITY|POSITIVE_MOMENTUM',
    riskTone: 'RISK_ON',
    trendRegime: 'BULL_TREND',
    momentumRegime: 'POSITIVE_MOMENTUM',
    volatilityRegime: 'LOW_VOLATILITY',
    metrics: {},
    blockers: [],
    researchOnly: true,
    modelDerived: true,
    finalActionEligible: false,
    decisionImpact: 'NONE',
  };
}

function classification(index, companyId, instrumentId, forecastAt) {
  const group = SIC_GROUPS[index % SIC_GROUPS.length];
  const code = `${group}${String(index % 100).padStart(2, '0')}`;
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

function records(count = 80) {
  return Array.from({ length: count }, (_, index) => {
    const forecastAt = new Date(START + index * 30 * DAY_MS).toISOString();
    const outcomeAt = new Date(new Date(forecastAt).getTime() + 21 * DAY_MS).toISOString();
    const value = LEVELS[index % LEVELS.length];
    const positive = value > 0;
    const instrumentIndex = index % 20;
    const companyId = `company:${instrumentIndex}`;
    const instrumentId = `instrument:${instrumentIndex}`;
    return {
      forecastId: `regime-factor-production:${index}`,
      validationMode: 'LIVE_SHADOW_OOS',
      factorFeatureVectorPolicyVersion: 'fv-v1',
      factorScorePolicyVersion: 'score-v1',
      factorScoreStatus: 'LATENT_SCORE_READY',
      latentFactorScore: value,
      rawLatentFactorScore: value,
      factorDomainSnapshot: [
        { domain: 'MOMENTUM', value, weight: 0.16, verifiedDriverCount: 1 },
        { domain: 'QUALITY', value: value * 0.8, weight: 0.12, verifiedDriverCount: 1 },
      ],
      assetClass: 'EQUITY',
      horizon: 'month1',
      tradingDays: 21,
      companyId,
      instrumentId,
      forecastAt,
      forecastSampleDate: forecastAt.slice(0, 10),
      referencePrice: { timestamp: forecastAt, value: 100 },
      status: 'MATURED',
      positiveOutcome: positive ? 1 : 0,
      realisedOutcome: { timestamp: outcomeAt, realisedReturnPct: value * 10 },
      marketRegimeSnapshot: regime(forecastAt),
      classificationSnapshot: classification(index, companyId, instrumentId, forecastAt),
    };
  });
}

function report(status) {
  return {
    forecastRegimeFactorAttributionStatus: status,
    operationalHealth: {
      ...buildForecastRegimeFactorOperationalTelemetry(status),
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('empty regime-factor lineage is a valid authority-free production state', () => {
  const status = buildForecastRegimeFactorAttributionStatus({ records: [] });
  const value = report(status);
  const verified = verifyForecastRegimeFactorProductionSafety(value);
  assert.equal(verified.status, 'VERIFIED');
  assert.equal(value.operationalHealth.forecastRegimeFactorLineageRecordCount, 0);
  assert.equal(value.operationalHealth.forecastRegimeFactorSupportedSignalCount, 0);
  assert.equal(value.operationalHealth.forecastRegimeFactorDecisionIntegrationEnabled, false);
});

test('statistically ready regime-factor evidence remains research-only and passes the firewall', () => {
  const status = buildForecastRegimeFactorAttributionStatus({ records: records() });
  assert.ok(status.supportedSignalCount > 0);
  const value = report(status);
  const verified = verifyForecastRegimeFactorProductionSafety(value);
  assert.equal(verified.status, 'VERIFIED');
  assert.equal(verified.supportedSignalCount, status.supportedSignalCount);
  assert.equal(status.automaticFactorReweightingEnabled, false);
  assert.equal(status.probabilityCalibrationEnabled, false);
  assert.equal(status.decisionIntegrationEnabled, false);
  assert.equal(status.forecastMayInfluenceFinalAction, false);
});

test('production firewall rejects any attempt to give conditional factor research decision authority', () => {
  const value = report(buildForecastRegimeFactorAttributionStatus({ records: records() }));
  value.forecastRegimeFactorAttributionStatus.decisionIntegrationEnabled = true;
  assert.throws(() => verifyForecastRegimeFactorProductionSafety(value), /decisionIntegrationEnabled must remain false/);
});

test('production firewall rejects a serialized READY signal whose independence or taxonomy gate was weakened', () => {
  const original = report(buildForecastRegimeFactorAttributionStatus({ records: records() }));
  const badIndependence = clone(original);
  badIndependence.forecastRegimeFactorAttributionStatus.groups[0].regimes[0].domains[0].sampleIndependence.status = 'INDEPENDENCE_NOT_READY';
  assert.throws(() => verifyForecastRegimeFactorProductionSafety(badIndependence), /sample independence not ready/);

  const badTaxonomy = clone(original);
  badTaxonomy.forecastRegimeFactorAttributionStatus.groups[0].regimes[0].domains[0].taxonomyConcentration.status = 'TAXONOMY_DIVERSIFICATION_NOT_READY';
  assert.throws(() => verifyForecastRegimeFactorProductionSafety(badTaxonomy), /taxonomy diversification not ready/);
});

test('production firewall rejects count or telemetry mismatches', () => {
  const original = report(buildForecastRegimeFactorAttributionStatus({ records: records() }));
  const badCount = clone(original);
  badCount.forecastRegimeFactorAttributionStatus.supportedSignalCount += 1;
  assert.throws(() => verifyForecastRegimeFactorProductionSafety(badCount), /supported signal count mismatch/);

  const badTelemetry = clone(original);
  badTelemetry.operationalHealth.forecastRegimeFactorSupportedSignalCount += 1;
  assert.throws(() => verifyForecastRegimeFactorProductionSafety(badTelemetry), /operational telemetry mismatch/);
});

test('v1817 transformed runtime publishes regime-factor research and invokes its production firewall', () => {
  const autonomous = fs.readFileSync(new URL('../src/run-autonomous-intelligence.js', import.meta.url), 'utf8');
  const verifier = fs.readFileSync(new URL('../scripts/verify-production-output.js', import.meta.url), 'utf8');
  assert.match(autonomous, /buildForecastRegimeFactorAttributionStatus/);
  assert.match(autonomous, /buildForecastRegimeFactorOperationalTelemetry/);
  assert.match(autonomous, /forecastRegimeFactorAttributionStatus,/);
  assert.match(autonomous, /\.\.\.forecastRegimeFactorOperationalTelemetry/);
  assert.match(verifier, /verifyForecastRegimeFactorProductionSafety\(report\)/);
  assert.match(verifier, /regimeConditionalFactorResearchSafety: 'REQUIRED'/);
});
