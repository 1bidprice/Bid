import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildForecastStackedEnsembleResearchStatus } from '../src/forecast-stacked-ensemble-research.js';
import {
  buildForecastStackedEnsembleOperationalTelemetry,
  verifyForecastStackedEnsembleProductionSafety,
} from '../src/forecast-stacked-ensemble-production-safety.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const SCORES = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];

function plusDays(iso, days) {
  return new Date(new Date(iso).getTime() + days * 86400000).toISOString();
}

function rec(index) {
  const score = SCORES[index % SCORES.length];
  const forecastAt = new Date(Date.UTC(2024, 0, 1 + index)).toISOString();
  const companyIndex = index % 20;
  const cik = String(companyIndex + 1).padStart(10, '0');
  const major = String(10 + (index % 10)).padStart(2, '0');
  const positive = score > 0 ? 1 : 0;
  return {
    forecastId: `prod-stack:${index}`,
    validationMode: 'LIVE_SHADOW_OOS',
    historicalPatternPolicyVersion: 'pattern-v1',
    factorScorePolicyVersion: 'factor-v1',
    companyId: `company:${companyIndex}`,
    instrumentId: `instrument:${companyIndex}`,
    symbol: `SYM${companyIndex}`,
    listing: { symbol: `SYM${companyIndex}`, mic: 'XNAS', currency: 'USD' },
    assetClass: 'EQUITY',
    horizon: 'month1',
    tradingDays: 21,
    forecastAt,
    forecastSampleDate: forecastAt.slice(0, 10),
    referencePrice: { value: 100, timestamp: forecastAt, currency: 'USD', source: 'synthetic' },
    rawProbabilityPositive: 0.5,
    latentFactorScore: score,
    factorScoreStatus: 'LATENT_SCORE_READY',
    status: 'MATURED',
    positiveOutcome: positive,
    realisedOutcome: {
      timestamp: plusDays(forecastAt, 22),
      close: positive ? 105 : 95,
      realisedReturnPct: positive ? 5 : -5,
    },
    classificationSnapshot: {
      contract: 'FORECAST_TIME_CLASSIFICATION_SNAPSHOT_V1',
      policyVersion: '2026-08-11.1',
      companyId: `company:${companyIndex}`,
      instrumentId: `instrument:${companyIndex}`,
      sourceAuthority: 'SEC_EDGAR_SUBMISSIONS',
      sourceUrl: `https://data.sec.gov/submissions/CIK${cik}.json`,
      sourceDocumentId: `CIK${cik}`,
      capturedAt: forecastAt,
      taxonomy: 'SEC_SIC',
      code: `${major}00`,
      description: `Synthetic SIC ${major}`,
      inferenceUsed: false,
      decisionImpact: 'NONE',
    },
  };
}

function report() {
  const status = buildForecastStackedEnsembleResearchStatus({ records: Array.from({ length: 420 }, (_, index) => rec(index)) });
  const value = { forecastStackedEnsembleResearchStatus: status };
  value.operationalHealth = buildForecastStackedEnsembleOperationalTelemetry(status);
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('production firewall accepts statistically ready stacked research only while every authority flag remains false', () => {
  const value = report();
  assert.equal(value.forecastStackedEnsembleResearchStatus.readyGroupCount, 1);
  const verified = verifyForecastStackedEnsembleProductionSafety(value);
  assert.equal(verified.status, 'VERIFIED');
  assert.equal(verified.telemetry.forecastStackedEnsembleReadyGroupCount, 1);
  assert.equal(verified.telemetry.forecastStackedEnsembleDecisionIntegrationEnabled, false);
  assert.equal(verified.telemetry.forecastStackedEnsembleMayInfluenceFinalAction, false);
});

test('production firewall rejects stacked research authority, weakened evidence and telemetry mismatch', () => {
  const authority = clone(report());
  authority.forecastStackedEnsembleResearchStatus.decisionIntegrationEnabled = true;
  assert.throws(() => verifyForecastStackedEnsembleProductionSafety(authority), /forbidden authority/);

  const weakened = clone(report());
  weakened.forecastStackedEnsembleResearchStatus.groups[0].sampleIndependence.thresholds.minimumDistinctForecastDates = 1;
  assert.throws(() => verifyForecastStackedEnsembleProductionSafety(weakened), /date threshold too weak/);

  const mismatch = clone(report());
  mismatch.operationalHealth.forecastStackedEnsembleReadyGroupCount = 99;
  assert.throws(() => verifyForecastStackedEnsembleProductionSafety(mismatch), /telemetry mismatch/);
});

test('v1821 runtime publishes stacked research after Yahoo freshness recovery and invokes its independent production firewall', () => {
  const manifest = JSON.parse(read('config/runtime-release-manifest.json'));
  const runner = read('src/run-autonomous-intelligence.js');
  const verifier = read('scripts/verify-production-output.js');

  assert.equal(manifest.releaseVersion, '1.8.0');
  assert.ok(manifest.testPatches.includes('apply-v1820-yahoo-history-freshness-recovery.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1820-yahoo-history-freshness-recovery.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1821-stacked-ensemble-research.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1821-stacked-ensemble-research.js');
  assert.equal(new Set(manifest.testPatches).size, 70);
  assert.equal(new Set(manifest.buildPatches).size, 69);

  assert.match(runner, /buildForecastStackedEnsembleResearchStatus/);
  assert.match(runner, /forecastStackedEnsembleResearchStatus/);
  assert.match(runner, /forecastStackedEnsembleOperationalTelemetry/);
  assert.match(verifier, /verifyForecastStackedEnsembleProductionSafety/);
  assert.match(verifier, /stackedEnsembleResearchSafety: 'REQUIRED'/);
  assert.doesNotMatch(runner, /forecastStackedEnsembleDecisionIntegrationEnabled:\s*true/);
  assert.doesNotMatch(runner, /forecastStackedEnsembleMayInfluenceFinalAction:\s*true/);
});
