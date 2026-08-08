import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstrumentProfile } from '../src/instrument-profile.js';
import { buildInstrumentRoute } from '../src/instrument-router.js';

const athensBank = {
  companyId: 'company:test:unknown-athens-bank',
  displayName: 'Example Hellenic Bank',
  legalName: 'Example Hellenic Bank S.A.',
  sector: 'Financial Services',
  industry: 'Banking',
  issuerId: '9999',
  country: 'GR',
  currency: 'EUR',
  primaryListing: { exchange: 'Euronext Athens', mic: 'XATH', symbol: 'TESTB' },
};

const usOperating = {
  companyId: 'company:test:unknown-us-industrial',
  displayName: 'Example Industrial Systems',
  sector: 'Industrials',
  industry: 'Machinery',
  cik: '0000009999',
  country: 'US',
  currency: 'USD',
  primaryListing: { exchange: 'NYSE', mic: 'XNYS', symbol: 'TSTI' },
};

test('unknown Athens bank routes to the reusable bank model and Athens adapters without ticker-specific code', () => {
  const profile = buildInstrumentProfile(athensBank);
  const route = buildInstrumentRoute(athensBank, { profile });
  assert.equal(profile.assetClass, 'EQUITY');
  assert.equal(profile.analysisModel, 'EQUITY_BANK');
  assert.equal(route.routes.market.adapter, 'EURONEXT_ATHENS_QUOTE');
  assert.equal(route.routes.officialEvidence.adapter, 'EURONEXT_ATHENS_ANNOUNCEMENTS');
  assert.equal(route.routes.fundamentals.adapter, 'EURONEXT_ATHENS_FINANCIALS');
  assert.equal(route.profile.routingInvariant, 'NO_TICKER_SPECIFIC_MODEL_SELECTION');
});

test('unknown US operating company routes to generic equity + SEC with no companyId special case', () => {
  const profile = buildInstrumentProfile(usOperating);
  const route = buildInstrumentRoute(usOperating, { profile });
  assert.equal(profile.assetClass, 'EQUITY');
  assert.equal(profile.analysisModel, 'EQUITY_OPERATING');
  assert.equal(route.routes.market.adapter, 'PROFESSIONAL_US_MARKET');
  assert.equal(route.routes.officialEvidence.adapter, 'SEC_SUBMISSIONS');
  assert.equal(route.routes.fundamentals.adapter, 'SEC_COMPANY_FACTS');
  assert.equal(route.endToEndReady, true);
});

test('ETF is automatically identified and fails closed only on missing ETF analytics provider', () => {
  const instrument = {
    instrumentId: 'instrument:test:world-etf',
    instrumentType: 'ETF',
    displayName: 'Example World UCITS ETF',
    country: 'US',
    primaryListing: { exchange: 'NYSE Arca', mic: 'ARCX', symbol: 'TETF' },
  };
  const profile = buildInstrumentProfile(instrument);
  const route = buildInstrumentRoute(instrument, { profile });
  assert.equal(profile.assetClass, 'ETF');
  assert.equal(profile.analysisModel, 'ETF_PORTFOLIO');
  assert.equal(route.routes.analytics.status, 'REQUIRES_PROVIDER');
  assert.equal(route.endToEndReady, false);
});

test('bond, option, future, FX, crypto and commodity route by structure rather than ticker', () => {
  const cases = [
    [{ instrumentType: 'BOND', maturityDate: '2032-01-01' }, 'BOND', 'BOND_CREDIT_DURATION'],
    [{ instrumentType: 'OPTION', strike: 100 }, 'OPTION', 'OPTION_VOLATILITY_GREEKS'],
    [{ instrumentType: 'FUTURE', contractMonth: '2026-12' }, 'FUTURE', 'FUTURE_DERIVATIVE'],
    [{ instrumentType: 'FX', baseCurrency: 'EUR', quoteCurrency: 'USD' }, 'FX', 'FX_MACRO_CARRY'],
    [{ instrumentType: 'CRYPTO', baseAsset: 'BTC', quoteAsset: 'USD' }, 'CRYPTO', 'CRYPTO_NETWORK_MARKET'],
    [{ instrumentType: 'COMMODITY', commodity: 'gold' }, 'COMMODITY', 'COMMODITY_CURVE_INVENTORY'],
  ];
  for (const [instrument, assetClass, model] of cases) {
    const profile = buildInstrumentProfile(instrument);
    assert.equal(profile.assetClass, assetClass);
    assert.equal(profile.analysisModel, model);
    assert.ok(profile.requiredCapabilities.length > 0);
  }
});
