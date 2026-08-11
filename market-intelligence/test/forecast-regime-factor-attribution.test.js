import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecastRegimeFactorAttributionStatus } from '../src/forecast-regime-factor-attribution.js';

const DAY_MS = 86_400_000;
const START = Date.UTC(2000, 0, 1);
const LEVELS = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];
const SIC_GROUPS = ['10', '20', '30', '40', '50', '60'];

function marketRegime(forecastAt, kind = 'RISK_ON', options = {}) {
  const riskOn = kind === 'RISK_ON';
  return {
    contract: 'FORECAST_TIME_MARKET_REGIME_SNAPSHOT_V1',
    policyVersion: '2026-08-12.1',
    capturedAt: options.capturedAt || forecastAt,
    benchmarkAsOf: options.benchmarkAsOf || forecastAt,
    benchmarkSymbol: 'SPY',
    benchmarkSource: 'synthetic benchmark',
    benchmarkSourceQuality: 'TEST',
    observationCount: 300,
    status: 'REGIME_READY',
    regimeKey: riskOn
      ? 'RISK_ON|BULL_TREND|LOW_VOLATILITY|POSITIVE_MOMENTUM'
      : 'RISK_OFF|BEAR_TREND|HIGH_VOLATILITY|NEGATIVE_MOMENTUM',
    riskTone: kind,
    trendRegime: riskOn ? 'BULL_TREND' : 'BEAR_TREND',
    momentumRegime: riskOn ? 'POSITIVE_MOMENTUM' : 'NEGATIVE_MOMENTUM',
    volatilityRegime: riskOn ? 'LOW_VOLATILITY' : 'HIGH_VOLATILITY',
    metrics: {},
    blockers: [],
    researchOnly: true,
    modelDerived: true,
    finalActionEligible: false,
    decisionImpact: 'NONE',
  };
}

function classification(index, companyId, instrumentId, forecastAt, options = {}) {
  const group = options.singleTaxonomyCluster ? '60' : SIC_GROUPS[index % SIC_GROUPS.length];
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

function record(index, options = {}) {
  const spacingDays = options.spacingDays ?? 30;
  const tradingDays = options.tradingDays ?? 21;
  const forecastAt = new Date(START + index * spacingDays * DAY_MS).toISOString();
  const outcomeAt = new Date(new Date(forecastAt).getTime() + tradingDays * DAY_MS).toISOString();
  const value = options.value ?? LEVELS[index % LEVELS.length];
  const regime = options.regime || 'RISK_ON';
  const inverted = options.inverted ?? regime === 'RISK_OFF';
  const positive = options.positive ?? (inverted ? value < 0 : value > 0);
  const instrumentIndex = options.instrumentIndex ?? index % 20;
  const companyId = `company:${instrumentIndex}`;
  const instrumentId = `instrument:${instrumentIndex}`;
  const domainValue = options.stringDomainValue ? String(value) : value;
  const latentValue = options.stringLatentValue ? String(value) : value;
  const domainSnapshot = options.noMomentum
    ? [{ domain: 'QUALITY', value: value * 0.8, weight: 0.12, verifiedDriverCount: 1 }]
    : [
      { domain: 'MOMENTUM', value: domainValue, weight: 0.16, verifiedDriverCount: 1 },
      { domain: 'QUALITY', value: value * 0.8, weight: 0.12, verifiedDriverCount: 1 },
    ];
  return {
    forecastId: `regime-factor:${options.vectorVersion || 'fv-v1'}:${options.scoreVersion || 'score-v1'}:${options.horizon || 'month1'}:${index}:${options.suffix || ''}`,
    validationMode: 'LIVE_SHADOW_OOS',
    factorFeatureVectorPolicyVersion: options.vectorVersion || 'fv-v1',
    factorScorePolicyVersion: options.scoreVersion || 'score-v1',
    factorScoreStatus: 'LATENT_SCORE_READY',
    latentFactorScore: latentValue,
    rawLatentFactorScore: latentValue,
    factorDomainSnapshot: domainSnapshot,
    assetClass: options.assetClass || 'EQUITY',
    horizon: options.horizon || 'month1',
    tradingDays,
    companyId,
    instrumentId,
    symbol: `SYM${instrumentIndex}`,
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    referencePrice: { timestamp: forecastAt, value: 100 },
    status: 'MATURED',
    positiveOutcome: positive ? 1 : 0,
    realisedOutcome: {
      timestamp: outcomeAt,
      realisedReturnPct: inverted ? -value * 10 : value * 10,
    },
    ...(options.noRegime ? {} : { marketRegimeSnapshot: marketRegime(forecastAt, regime, options.regimeOptions || {}) }),
    ...(options.noClassification ? {} : { classificationSnapshot: classification(index, companyId, instrumentId, forecastAt, options) }),
  };
}

function dualRegimeRecords() {
  return [
    ...Array.from({ length: 80 }, (_, index) => record(index, { regime: 'RISK_ON', suffix: 'on' })),
    ...Array.from({ length: 80 }, (_, offset) => record(100 + offset, { regime: 'RISK_OFF', suffix: 'off' })),
  ];
}

test('the same factor can be supported in risk-on and inverted in risk-off without merging the regimes', () => {
  const status = buildForecastRegimeFactorAttributionStatus({ records: dualRegimeRecords() });
  assert.equal(status.groupCount, 1);
  const group = status.groups[0];
  assert.equal(group.coverage.regimeCoveragePct, 100);
  assert.equal(group.regimeCount, 2);
  const riskOn = group.regimes.find((item) => item.riskTone === 'RISK_ON');
  const riskOff = group.regimes.find((item) => item.riskTone === 'RISK_OFF');
  const onMomentum = riskOn.domains.find((item) => item.domain === 'MOMENTUM');
  const offMomentum = riskOff.domains.find((item) => item.domain === 'MOMENTUM');
  assert.equal(onMomentum.status, 'REGIME_FACTOR_RESEARCH_READY');
  assert.equal(onMomentum.signal, 'SUPPORTED_IN_REGIME');
  assert.ok(onMomentum.rocAuc > 0.9);
  assert.equal(offMomentum.status, 'REGIME_FACTOR_RESEARCH_READY');
  assert.equal(offMomentum.signal, 'INVERTED_IN_REGIME');
  assert.ok(offMomentum.rocAuc < 0.1);
  assert.equal(group.supportedSignalCount > 0, true);
  assert.equal(group.invertedSignalCount > 0, true);
});

test('latent factor score is evaluated separately from factor domains inside each regime', () => {
  const group = buildForecastRegimeFactorAttributionStatus({ records: dualRegimeRecords() }).groups[0];
  const riskOn = group.regimes.find((item) => item.riskTone === 'RISK_ON');
  const riskOff = group.regimes.find((item) => item.riskTone === 'RISK_OFF');
  assert.equal(riskOn.latentFactorScore.signal, 'SUPPORTED_IN_REGIME');
  assert.equal(riskOff.latentFactorScore.signal, 'INVERTED_IN_REGIME');
  assert.equal(riskOn.domainCount, 2);
  assert.ok(riskOn.domains.some((item) => item.domain === 'QUALITY'));
});

test('low immutable regime coverage blocks factor conclusions even when the classified regime subset is strong', () => {
  const records = [
    ...Array.from({ length: 80 }, (_, index) => record(index, { regime: 'RISK_ON' })),
    ...Array.from({ length: 40 }, (_, offset) => record(100 + offset, { noRegime: true, suffix: 'legacy' })),
  ];
  const group = buildForecastRegimeFactorAttributionStatus({ records }).groups[0];
  assert.equal(group.coverage.regimeCoveragePct, 66.67);
  assert.equal(group.coverage.status, 'REGIME_FACTOR_COVERAGE_NOT_READY');
  const momentum = group.regimes[0].domains.find((item) => item.domain === 'MOMENTUM');
  assert.equal(momentum.status, 'REGIME_FACTOR_RESEARCH_NOT_READY');
  assert.ok(momentum.blockers.includes('REGIME_FACTOR_LINEAGE_COVERAGE_NOT_READY'));
});

test('domain-specific feature coverage is required inside the regime', () => {
  const records = Array.from({ length: 80 }, (_, index) => record(index, {
    regime: 'RISK_ON',
    noMomentum: index < 32,
  }));
  const regime = buildForecastRegimeFactorAttributionStatus({ records }).groups[0].regimes[0];
  const momentum = regime.domains.find((item) => item.domain === 'MOMENTUM');
  assert.equal(momentum.lineageCoveragePct, 60);
  assert.equal(momentum.status, 'REGIME_FACTOR_RESEARCH_NOT_READY');
  assert.ok(momentum.blockers.includes('REGIME_FACTOR_FEATURE_COVERAGE_TOO_LOW'));
});

test('overlapping outcome windows block an otherwise strong regime-factor signal', () => {
  const records = Array.from({ length: 80 }, (_, index) => record(index, {
    regime: 'RISK_ON',
    spacingDays: 1,
  }));
  const momentum = buildForecastRegimeFactorAttributionStatus({ records }).groups[0].regimes[0].domains.find((item) => item.domain === 'MOMENTUM');
  assert.equal(momentum.status, 'REGIME_FACTOR_RESEARCH_NOT_READY');
  assert.ok(momentum.outcomeWindowIndependence.effectiveNonOverlappingWindowCount < 8);
  assert.ok(momentum.blockers.includes('OOS_NON_OVERLAPPING_OUTCOME_WINDOWS_TOO_SMALL'));
});

test('taxonomy concentration blocks regime-factor support even with diversified dates and instruments', () => {
  const records = Array.from({ length: 80 }, (_, index) => record(index, {
    regime: 'RISK_ON',
    singleTaxonomyCluster: true,
  }));
  const momentum = buildForecastRegimeFactorAttributionStatus({ records }).groups[0].regimes[0].domains.find((item) => item.domain === 'MOMENTUM');
  assert.equal(momentum.status, 'REGIME_FACTOR_RESEARCH_NOT_READY');
  assert.equal(momentum.taxonomyConcentration.status, 'TAXONOMY_DIVERSIFICATION_NOT_READY');
  assert.ok(momentum.blockers.includes('OOS_NATIVE_CLUSTER_CONCENTRATION_TOO_HIGH'));
});

test('string factor values are excluded instead of being numerically coerced', () => {
  const records = Array.from({ length: 80 }, (_, index) => record(index, {
    regime: 'RISK_ON',
    stringDomainValue: true,
    stringLatentValue: true,
  }));
  const regime = buildForecastRegimeFactorAttributionStatus({ records }).groups[0].regimes[0];
  const momentum = regime.domains.find((item) => item.domain === 'MOMENTUM');
  assert.equal(regime.latentFactorScore.maturedSampleSize, 0);
  assert.equal(momentum.maturedSampleSize, 0);
  assert.ok(momentum.blockers.includes('REGIME_FACTOR_MATURED_OOS_SAMPLE_TOO_SMALL'));
  assert.ok(momentum.blockers.includes('REGIME_FACTOR_FEATURE_COVERAGE_TOO_LOW'));
});

test('factor versions and horizons stay separate and all regime-factor outputs remain research-only', () => {
  const records = [
    ...Array.from({ length: 70 }, (_, index) => record(index, { vectorVersion: 'fv-v1', scoreVersion: 'score-v1', horizon: 'month1', suffix: 'a' })),
    ...Array.from({ length: 70 }, (_, index) => record(100 + index, { vectorVersion: 'fv-v2', scoreVersion: 'score-v2', horizon: 'month1', suffix: 'b' })),
    ...Array.from({ length: 70 }, (_, index) => record(200 + index, { vectorVersion: 'fv-v1', scoreVersion: 'score-v1', horizon: 'month3', tradingDays: 63, spacingDays: 70, suffix: 'c' })),
  ];
  const status = buildForecastRegimeFactorAttributionStatus({ records });
  assert.equal(status.groupCount, 3);
  assert.equal(status.researchOnly, true);
  assert.equal(status.automaticRegimeWeightingEnabled, false);
  assert.equal(status.automaticFactorReweightingEnabled, false);
  assert.equal(status.probabilityCalibrationEnabled, false);
  assert.equal(status.decisionIntegrationEnabled, false);
  assert.equal(status.forecastMayInfluenceFinalAction, false);
  for (const group of status.groups) {
    assert.equal(group.automaticFactorReweightingEnabled, false);
    for (const regime of group.regimes) {
      assert.equal(regime.automaticFactorReweightingEnabled, false);
      assert.equal(regime.forecastMayInfluenceFinalAction, false);
      assert.equal(regime.latentFactorScore.decisionIntegrationEnabled, false);
      for (const domain of regime.domains) assert.equal(domain.decisionIntegrationEnabled, false);
    }
  }
});
