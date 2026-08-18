import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveShadowForecastRecords } from '../src/forecast-outcome-ledger.js';

test('new live forecast records preserve an immutable listing snapshot for future outcome maturation', () => {
  const generatedAt = '2026-08-11T20:00:00.000Z';
  const records = createLiveShadowForecastRecords([
    {
      policyVersion: 'shadow-v2',
      generatedAt,
      companyId: 'company:xath:term-999',
      instrumentId: 'company:xath:term-999',
      displayName: 'Example Athens Co',
      symbol: 'TEST',
      assetClass: 'EQUITY',
      mode: 'SHADOW_ONLY',
      decisionImpact: 'NONE',
      historicalPatternForecast: {
        policyVersion: 'pattern-v2',
        asOf: generatedAt,
        currentPattern: { regime: 'BULL_TREND' },
        horizons: { day1: { tradingDays: 1, rawProbabilityPositive: 0.55, expectedReturnPct: 0.2, distribution: {}, patternConfidenceScore: 50 } },
      },
      forecast: { horizons: { day1: { probabilityPositive: null, evidenceQualityScore: 80 } } },
    },
  ], [
    {
      companyId: 'company:xath:term-999',
      listing: { symbol: 'TEST', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' },
      referencePrice: { value: 10, timestamp: generatedAt, currency: 'EUR', source: 'official' },
    },
  ]);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].listing, { symbol: 'TEST', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR' });
  assert.equal(records[0].decisionImpact, 'NONE');
});
