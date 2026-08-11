import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  extractAthensIcbClassification,
  fetchAthensIcbClassificationSnapshot,
} from '../src/adapters/euronext-athens-classification.js';
import {
  buildAthensForecastClassificationSnapshot,
  validateForecastClassificationSnapshot,
} from '../src/forecast-classification-lineage.js';
import {
  createLiveShadowForecastRecords,
  mergeForecastOutcomeLedger,
} from '../src/forecast-outcome-ledger.js';

const FORECAST_AT = '2027-02-02T10:00:00.000Z';

function company() {
  return {
    companyId: 'company:xath:issuer-623',
    instrumentId: 'company:xath:issuer-623',
    issuerId: '623',
    legalName: 'Example Athens Issuer',
    displayName: 'Example Athens Issuer',
    country: 'GR',
    primaryListing: { symbol: 'EXAM', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' },
  };
}

function snapshot(capturedAt = FORECAST_AT) {
  return buildAthensForecastClassificationSnapshot(company(), {
    sector: 'Technology',
    subSector: 'Computer Services',
  }, { capturedAt }).snapshot;
}

function shadow() {
  return {
    policyVersion: 'shadow-v1',
    generatedAt: FORECAST_AT,
    companyId: company().companyId,
    instrumentId: company().instrumentId,
    displayName: company().displayName,
    symbol: 'EXAM',
    assetClass: 'EQUITY',
    mode: 'SHADOW_ONLY',
    decisionImpact: 'NONE',
    existingFinalActionSnapshot: { status: 'FINAL', marketAction: 'HOLD' },
    historicalPatternForecast: {
      policyVersion: 'pattern-v1',
      asOf: FORECAST_AT,
      currentPattern: { regime: 'NEUTRAL' },
      horizons: {
        week1: { tradingDays: 5, rawProbabilityPositive: 0.55, expectedReturnPct: 1.2, distribution: {}, patternConfidenceScore: 50 },
      },
    },
    forecast: { horizons: { week1: { probabilityPositive: null, evidenceQualityScore: 75 } } },
  };
}

function dossier() {
  return {
    companyId: company().companyId,
    referencePrice: { value: 10, timestamp: FORECAST_AT, currency: 'EUR', source: 'verified-reference' },
    listing: company().primaryListing,
  };
}

test('Athens issuer-profile parser extracts exact published Sector / Sub-sector labels', () => {
  const html = '<table><tr><th>Sector / Sub-sector</th><td>Basic Resources / Metal Fabricating</td></tr></table>';
  const result = extractAthensIcbClassification(html);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.classification, { sector: 'Basic Resources', subSector: 'Metal Fabricating' });
});

test('Athens issuer-profile parser fails closed on missing or ambiguous classification', () => {
  const missing = extractAthensIcbClassification('<table><tr><th>Issuer</th><td>Example</td></tr></table>');
  assert.equal(missing.classification, null);
  assert.equal(missing.diagnostics[0].code, 'ATHENS_ICB_CLASSIFICATION_NOT_FOUND');

  const ambiguous = extractAthensIcbClassification(`
    <table>
      <tr><th>Sector / Sub-sector</th><td>Technology / Computer Services</td></tr>
      <tr><th>Sector / Sub-sector</th><td>Financials / Banks</td></tr>
    </table>
  `);
  assert.equal(ambiguous.classification, null);
  assert.equal(ambiguous.diagnostics[0].code, 'ATHENS_ICB_CLASSIFICATION_AMBIGUOUS');
});

test('Athens classification performs one canonical issuer-profile request and creates no guessed code', async () => {
  const calls = [];
  const result = await fetchAthensIcbClassificationSnapshot(company(), {
    capturedAt: FORECAST_AT,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        text: async () => '<table><tr><th>Sector / Sub-sector</th><td>Technology / Computer Services</td></tr></table>',
      };
    },
  });
  assert.deepEqual(calls, ['https://athens.euronext.com/en/market-data/issuers/623']);
  assert.equal(result.snapshot.sourceAuthority, 'EURONEXT_ATHENS_ISSUER_PROFILE');
  assert.equal(result.snapshot.taxonomy, 'FTSE_RUSSELL_ICB');
  assert.equal(result.snapshot.sector, 'Technology');
  assert.equal(result.snapshot.subSector, 'Computer Services');
  assert.equal(Object.prototype.hasOwnProperty.call(result.snapshot, 'code'), false);
  assert.equal(result.snapshot.inferenceUsed, false);
  assert.equal(result.snapshot.decisionImpact, 'NONE');
});

test('Athens classification validator rejects invented taxonomy codes', () => {
  const tampered = { ...snapshot(), code: '10102010' };
  const result = validateForecastClassificationSnapshot(tampered, {
    companyId: company().companyId,
    instrumentId: company().instrumentId,
    forecastAt: FORECAST_AT,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('CLASSIFICATION_UNVERIFIED_CODE_FORBIDDEN'));
});

test('Athens profile failure is diagnostic-only and never throws classification into identity logic', async () => {
  const result = await fetchAthensIcbClassificationSnapshot(company(), {
    capturedAt: FORECAST_AT,
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }),
  });
  assert.equal(result.snapshot, null);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, 'ATHENS_ICB_PROFILE_FETCH_FAILED');
  assert.equal(result.diagnostics[0].companyId, company().companyId);
});

test('Athens classification stays outside sector mutation, opportunity scoring and final-action authority', () => {
  const root = new URL('../', import.meta.url);
  const daily = fs.readFileSync(new URL('src/run-daily-intelligence.js', root), 'utf8');
  const autonomous = fs.readFileSync(new URL('src/run-autonomous-intelligence.js', root), 'utf8');
  const discovery = fs.readFileSync(new URL('src/autonomous-discovery.js', root), 'utf8');
  const finalAction = fs.readFileSync(new URL('src/final-action-policy.js', root), 'utf8');
  const opportunityFactors = fs.readFileSync(new URL('src/opportunity-factor-engine.js', root), 'utf8');

  assert.match(daily, /const classificationSnapshots = \[\.\.\.\(options\.classificationSnapshots \|\| \[\]\)\];/);
  assert.match(autonomous, /classificationSnapshots: discovery\.classificationSnapshots \|\| \[\]/);
  assert.match(discovery, /classificationSnapshots: athensResult\.classificationSnapshots \|\| \[\],/);
  assert.doesNotMatch(daily, /company\.sector\s*=\s*/);
  assert.doesNotMatch(daily, /company\.industry\s*=\s*/);
  assert.doesNotMatch(finalAction, /classificationSnapshot/);
  assert.doesNotMatch(opportunityFactors, /classificationSnapshot/);
});

test('new Athens OOS forecasts freeze canonical ICB lineage while legacy forecasts remain non-backfillable', () => {
  const classified = createLiveShadowForecastRecords([shadow()], [dossier()], { classificationSnapshots: [snapshot()] })[0];
  assert.equal(classified.classificationSnapshot.taxonomy, 'FTSE_RUSSELL_ICB');
  assert.equal(classified.classificationSnapshot.sector, 'Technology');

  const legacy = createLiveShadowForecastRecords([shadow()], [dossier()])[0];
  assert.equal(Object.prototype.hasOwnProperty.call(legacy, 'classificationSnapshot'), false);
  const maturedIncoming = {
    ...legacy,
    status: 'MATURED',
    classificationSnapshot: snapshot(),
    positiveOutcome: 1,
    realisedOutcome: { timestamp: '2027-02-09T10:00:00.000Z', close: 10.5, realisedReturnPct: 5 },
    outcomeEvaluatedAt: '2027-02-09T10:00:00.000Z',
  };
  const merged = mergeForecastOutcomeLedger([legacy], [maturedIncoming]);
  assert.equal(merged[0].status, 'MATURED');
  assert.equal(Object.prototype.hasOwnProperty.call(merged[0], 'classificationSnapshot'), false);
});
