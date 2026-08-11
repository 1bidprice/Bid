import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fetchSecRecentFilings } from '../src/adapters/sec-submissions.js';
import {
  buildSecForecastClassificationSnapshot,
  validateForecastClassificationSnapshot,
} from '../src/forecast-classification-lineage.js';
import {
  createLiveShadowForecastRecords,
  mergeForecastOutcomeLedger,
} from '../src/forecast-outcome-ledger.js';
import { verifyForecastOutcomeArchive } from '../scripts/verify-forecast-outcome-archive.js';

const forecastAt = '2027-01-15T00:00:00.000Z';

function company() {
  return {
    companyId: 'company:ABC',
    instrumentId: 'company:ABC',
    cik: '123456',
    legalName: 'ABC Corp',
    displayName: 'ABC Corp',
  };
}

function secPayload(overrides = {}) {
  return {
    cik: '0000123456',
    sic: '7372',
    sicDescription: 'Services-Prepackaged Software',
    filings: { recent: { accessionNumber: [], form: [], filingDate: [], reportDate: [], primaryDocument: [], items: [] } },
    ...overrides,
  };
}

function classification(capturedAt = forecastAt) {
  return buildSecForecastClassificationSnapshot(company(), secPayload(), { capturedAt }).snapshot;
}

function shadow() {
  return {
    policyVersion: 'shadow-v1',
    generatedAt: forecastAt,
    companyId: 'company:ABC',
    instrumentId: 'company:ABC',
    displayName: 'ABC Corp',
    symbol: 'ABC',
    assetClass: 'EQUITY',
    mode: 'SHADOW_ONLY',
    decisionImpact: 'NONE',
    finalActionEligible: false,
    existingFinalActionSnapshot: { status: 'FINAL', marketAction: 'HOLD' },
    historicalPatternForecast: {
      policyVersion: 'pattern-v1',
      asOf: forecastAt,
      currentPattern: { regime: 'BULL_TREND' },
      horizons: {
        week1: { tradingDays: 5, rawProbabilityPositive: 0.62, expectedReturnPct: 1.8, distribution: {}, patternConfidenceScore: 55 },
      },
    },
    forecast: { horizons: { week1: { probabilityPositive: null, evidenceQualityScore: 82 } } },
  };
}

function dossier() {
  return {
    companyId: 'company:ABC',
    referencePrice: { value: 100, timestamp: forecastAt, currency: 'USD', source: 'verified-reference' },
  };
}

function maturedCopy(record, classificationSnapshot = undefined) {
  const copy = {
    ...record,
    status: 'MATURED',
    positiveOutcome: 1,
    realisedOutcome: { timestamp: '2027-01-22T00:00:00.000Z', close: 105, realisedReturnPct: 5 },
    outcomeEvaluatedAt: '2027-01-22T00:00:00.000Z',
  };
  if (classificationSnapshot !== undefined) copy.classificationSnapshot = classificationSnapshot;
  return copy;
}

test('SEC submissions extracts canonical SIC classification from the existing single official request', async () => {
  let calls = 0;
  const result = await fetchSecRecentFilings(company(), {
    userAgent: 'Investor Control test contact@example.com',
    retrievedAt: forecastAt,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => secPayload() };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.records.length, 0);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.classificationSnapshot.contract, 'FORECAST_TIME_CLASSIFICATION_SNAPSHOT_V1');
  assert.equal(result.classificationSnapshot.taxonomy, 'SEC_SIC');
  assert.equal(result.classificationSnapshot.code, '7372');
  assert.equal(result.classificationSnapshot.description, 'Services-Prepackaged Software');
  assert.equal(result.classificationSnapshot.sourceAuthority, 'SEC_EDGAR_SUBMISSIONS');
  assert.equal(result.classificationSnapshot.sourceUrl, 'https://data.sec.gov/submissions/CIK0000123456.json');
  assert.equal(result.classificationSnapshot.inferenceUsed, false);
  assert.equal(result.classificationSnapshot.decisionImpact, 'NONE');
});

test('missing or malformed SEC SIC never creates inferred classification', async () => {
  const result = await fetchSecRecentFilings(company(), {
    userAgent: 'Investor Control test contact@example.com',
    retrievedAt: forecastAt,
    fetchImpl: async () => ({ ok: true, json: async () => secPayload({ sic: 'software', sicDescription: '' }) }),
  });
  assert.equal(result.classificationSnapshot, null);
  assert.ok(result.diagnostics.some((item) => item.code === 'SEC_SIC_CLASSIFICATION_CODE_UNAVAILABLE'));
  assert.ok(result.diagnostics.some((item) => item.code === 'SEC_SIC_CLASSIFICATION_DESCRIPTION_UNAVAILABLE'));

  const future = classification('2027-01-16T00:00:00.000Z');
  const validation = validateForecastClassificationSnapshot(future, {
    companyId: 'company:ABC', instrumentId: 'company:ABC', forecastAt,
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes('CLASSIFICATION_CAPTURED_AFTER_FORECAST'));
});

test('classification stays in a separate research lineage and is not written into company sector or final-action code', () => {
  const root = new URL('../', import.meta.url);
  const daily = fs.readFileSync(new URL('src/run-daily-intelligence.js', root), 'utf8');
  const autonomous = fs.readFileSync(new URL('src/run-autonomous-intelligence.js', root), 'utf8');
  const finalAction = fs.readFileSync(new URL('src/final-action-policy.js', root), 'utf8');
  const opportunityFactors = fs.readFileSync(new URL('src/opportunity-factor-engine.js', root), 'utf8');

  assert.match(daily, /const classificationSnapshots = \[\.\.\.\(options\.classificationSnapshots \|\| \[\]\)\];/);
  assert.match(daily, /classificationSnapshotCount: classificationSnapshots\.length/);
  assert.match(daily, /if \(result\.classificationSnapshot\) classificationSnapshots\.push\(result\.classificationSnapshot\);/);
  assert.doesNotMatch(daily, /company\.sector\s*=\s*result\.classification/);
  assert.doesNotMatch(daily, /company\.industry\s*=\s*result\.classification/);
  assert.match(autonomous, /classificationSnapshots: baseReport\.classificationSnapshots \|\| \[\],/);
  assert.doesNotMatch(finalAction, /classificationSnapshot/);
  assert.doesNotMatch(opportunityFactors, /classificationSnapshot/);
});

test('new OOS forecast freezes a valid forecast-time SEC classification snapshot', () => {
  const snapshot = classification();
  const records = createLiveShadowForecastRecords([shadow()], [dossier()], { classificationSnapshots: [snapshot] });
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].classificationSnapshot, snapshot);
  assert.notEqual(records[0].classificationSnapshot, snapshot);
  assert.equal(records[0].classificationSnapshot.decisionImpact, 'NONE');
});

test('legacy forecast without classification is never backfilled when the same forecast later matures', () => {
  const open = createLiveShadowForecastRecords([shadow()], [dossier()])[0];
  assert.equal(Object.prototype.hasOwnProperty.call(open, 'classificationSnapshot'), false);
  const incomingMatured = maturedCopy(open, classification());
  const merged = mergeForecastOutcomeLedger([open], [incomingMatured]);
  assert.equal(merged[0].status, 'MATURED');
  assert.equal(Object.prototype.hasOwnProperty.call(merged[0], 'classificationSnapshot'), false);
});

test('classified OPEN forecast keeps its original immutable snapshot through maturation even if incoming copy is tampered', () => {
  const original = classification();
  const open = createLiveShadowForecastRecords([shadow()], [dossier()], { classificationSnapshots: [original] })[0];
  const tampered = { ...original, code: '9999', description: 'Changed later' };
  const merged = mergeForecastOutcomeLedger([open], [maturedCopy(open, tampered)]);
  assert.equal(merged[0].status, 'MATURED');
  assert.deepEqual(merged[0].classificationSnapshot, original);
  assert.equal(merged[0].classificationSnapshot.code, '7372');
});

test('archive verifier accepts legacy absence but rejects malformed or inferred classification snapshots', () => {
  const classified = createLiveShadowForecastRecords([shadow()], [dossier()], { classificationSnapshots: [classification()] })[0];
  const validArchive = {
    format: 'investor-control-forecast-outcome-archive',
    records: [classified],
    summary: { recordCount: 1, openCount: 1, maturedCount: 0 },
  };
  assert.equal(verifyForecastOutcomeArchive(validArchive).ok, true);

  const legacy = { ...classified };
  delete legacy.classificationSnapshot;
  assert.equal(verifyForecastOutcomeArchive({ ...validArchive, records: [legacy] }).ok, true);

  const tampered = { ...classified, classificationSnapshot: { ...classified.classificationSnapshot, inferenceUsed: true } };
  const rejected = verifyForecastOutcomeArchive({ ...validArchive, records: [tampered] });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.some((item) => item.includes('CLASSIFICATION_INFERENCE_FORBIDDEN')));
});
