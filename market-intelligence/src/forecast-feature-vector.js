export const FORECAST_FEATURE_VECTOR_VERSION = '2026-08-11.1';

export const FORECAST_FACTOR_DOMAIN_WEIGHTS = Object.freeze({
  HISTORICAL_PATTERN: 0.22,
  VALUATION: 0.14,
  QUALITY: 0.12,
  GROWTH: 0.10,
  MOMENTUM: 0.16,
  FUNDAMENTAL: 0.12,
  RISK: 0.09,
  CATALYST: 0.05,
});

const DRIVER_FAMILIES_BY_DOMAIN = Object.freeze({
  VALUATION: new Set(['VALUATION']),
  QUALITY: new Set(['QUALITY']),
  GROWTH: new Set(['GROWTH']),
  MOMENTUM: new Set(['MOMENTUM']),
  FUNDAMENTAL: new Set(['FUNDAMENTAL', 'BALANCE_SHEET', 'CAPITAL_STRUCTURE']),
  RISK: new Set(['RISK']),
  CATALYST: new Set(['CATALYST']),
});

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function signedDriverValue(driver) {
  const strength = finite(driver?.strengthScore);
  if (strength === null) return null;
  const magnitude = Math.max(0, Math.min(100, strength)) / 100;
  if (driver.direction === 'POSITIVE') return magnitude;
  if (driver.direction === 'NEGATIVE') return -magnitude;
  if (driver.direction === 'NEUTRAL') return 0;
  return null;
}

function aggregateVerifiedDomain(domain, drivers) {
  const families = DRIVER_FAMILIES_BY_DOMAIN[domain];
  const relevant = (Array.isArray(drivers) ? drivers : []).filter((driver) =>
    driver?.verified === true && families?.has(String(driver.family || '').toUpperCase()),
  );
  const values = relevant.map(signedDriverValue).filter(Number.isFinite);
  if (!values.length) {
    return {
      domain,
      available: false,
      value: null,
      weight: FORECAST_FACTOR_DOMAIN_WEIGHTS[domain],
      verifiedDriverCount: 0,
      evidenceIds: [],
      sourceCount: 0,
      driverNames: [],
      maxNegativeStrength: 0,
    };
  }
  const value = values.reduce((sum, item) => sum + item, 0) / values.length;
  const maxNegativeStrength = relevant
    .filter((driver) => driver.direction === 'NEGATIVE')
    .reduce((max, driver) => Math.max(max, Math.max(0, Math.min(100, finite(driver.strengthScore) ?? 0)) / 100), 0);
  return {
    domain,
    available: true,
    value: round(clamp(value)),
    weight: FORECAST_FACTOR_DOMAIN_WEIGHTS[domain],
    verifiedDriverCount: relevant.length,
    evidenceIds: unique(relevant.flatMap((driver) => Array.isArray(driver.evidenceIds) ? driver.evidenceIds : [])),
    sourceCount: relevant.reduce((sum, driver) => sum + Math.max(0, Number(driver.sourceCount || 0)), 0),
    driverNames: unique(relevant.map((driver) => driver.name)),
    maxNegativeStrength: round(maxNegativeStrength),
  };
}

function historicalPatternFeature(patternHorizon) {
  const rawFrequency = finite(patternHorizon?.rawProbabilityPositive);
  const expectedReturnPct = finite(patternHorizon?.expectedReturnPct);
  if (rawFrequency === null || rawFrequency < 0 || rawFrequency > 1) {
    return {
      domain: 'HISTORICAL_PATTERN',
      available: false,
      value: null,
      weight: FORECAST_FACTOR_DOMAIN_WEIGHTS.HISTORICAL_PATTERN,
      verifiedDriverCount: 0,
      evidenceIds: [],
      sourceCount: 0,
      driverNames: [],
      maxNegativeStrength: 0,
      components: {},
    };
  }
  const centeredFrequency = clamp((rawFrequency - 0.5) * 2);
  const expectedReturnComponent = expectedReturnPct === null ? null : Math.tanh(expectedReturnPct / 10);
  const value = expectedReturnComponent === null
    ? centeredFrequency
    : 0.7 * centeredFrequency + 0.3 * expectedReturnComponent;
  return {
    domain: 'HISTORICAL_PATTERN',
    available: true,
    value: round(clamp(value)),
    weight: FORECAST_FACTOR_DOMAIN_WEIGHTS.HISTORICAL_PATTERN,
    verifiedDriverCount: 1,
    evidenceIds: [],
    sourceCount: 1,
    driverNames: ['HISTORICAL_PATTERN_ANALOGS'],
    maxNegativeStrength: value < 0 ? round(Math.abs(clamp(value))) : 0,
    components: {
      rawPatternFrequencyPositive: round(rawFrequency, 4),
      expectedReturnPct: round(expectedReturnPct, 4),
      effectiveSampleSize: finite(patternHorizon?.sample?.effectiveSampleSize),
      analogCount: Array.isArray(patternHorizon?.analogs) ? patternHorizon.analogs.length : null,
    },
  };
}

export function buildForecastFeatureVector(input = {}) {
  const driverSynthesis = input.driverSynthesis || {};
  const drivers = Array.isArray(driverSynthesis.drivers) ? driverSynthesis.drivers : [];
  const patternHorizon = input.patternHorizon || null;
  const horizon = input.horizon || null;
  const features = [
    historicalPatternFeature(patternHorizon),
    ...Object.keys(DRIVER_FAMILIES_BY_DOMAIN).map((domain) => aggregateVerifiedDomain(domain, drivers)),
  ];
  const available = features.filter((feature) => feature.available);
  const availableWeight = available.reduce((sum, feature) => sum + Number(feature.weight || 0), 0);
  const unverified = drivers.filter((driver) => driver?.verified !== true);
  const nonPredictive = drivers.filter((driver) => ['EXECUTION', 'PORTFOLIO'].includes(String(driver?.family || '').toUpperCase()));

  return {
    format: 'investor-control-forecast-feature-vector',
    version: 1,
    policyVersion: FORECAST_FEATURE_VECTOR_VERSION,
    instrumentId: input.instrumentId || driverSynthesis.instrumentId || null,
    assetClass: input.assetClass || 'UNKNOWN',
    horizon,
    scoreScale: [-1, 1],
    features,
    availableDomainCount: available.length,
    availableWeight: round(availableWeight, 4),
    missingDomains: features.filter((feature) => !feature.available).map((feature) => feature.domain),
    excludedDrivers: [
      ...unverified.map((driver) => ({ name: driver.name || null, family: driver.family || null, reason: 'UNVERIFIED_DRIVER_EXCLUDED' })),
      ...nonPredictive.filter((driver) => driver?.verified === true).map((driver) => ({
        name: driver.name || null,
        family: driver.family || null,
        reason: driver.family === 'EXECUTION' ? 'EXECUTION_QUALITY_NOT_RETURN_FORECAST_FACTOR' : 'PORTFOLIO_CONTEXT_BELONGS_TO_DECISION_LAYER',
      })),
    ],
    evidenceQualityScore: finite(driverSynthesis.evidenceQualityScore),
    contradictionCount: Math.max(0, Number(driverSynthesis.contradictionCount || 0)),
    invariants: {
      missingFeaturesAreExcludedNotZeroFilled: true,
      unverifiedDriversAreExcluded: true,
      executionLiquidityIsNotBullishReturnEvidence: true,
      portfolioFitIsNotInstrumentReturnEvidence: true,
      historicalPatternFrequencyIsResearchInputNotProbabilityOutput: true,
    },
  };
}
