import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInstrumentIntegrity } from '../src/instrument-integrity-gate.js';

function verifiedQuote(overrides = {}) {
  return {
    value: 101.25,
    nativeCurrency: 'USD',
    appSymbol: 'SYNTH.US',
    companyId: 'company:synthetic-us',
    sourceApproved: true,
    valuationEligible: true,
    timestampVerified: true,
    decisionEligible: true,
    ...overrides,
  };
}

function usEquity(overrides = {}) {
  return {
    instrumentId: 'company:synthetic-us',
    companyId: 'company:synthetic-us',
    assetClass: 'EQUITY',
    primaryListing: {
      symbol: 'SYNTH',
      mic: 'XNYS',
      exchange: 'NYSE',
      currency: 'USD',
      activeTradingVerified: true,
      status: 'ACTIVE',
    },
    ...overrides,
  };
}

test('valid listed equity passes the universal decision gate', () => {
  const result = evaluateInstrumentIntegrity({ instrument: usEquity(), quote: verifiedQuote(), purpose: 'DECISION' });
  assert.equal(result.identityReady, true);
  assert.equal(result.routingReady, true);
  assert.equal(result.valuationReady, true);
  assert.equal(result.decisionReady, true);
  assert.deepEqual(result.blockers, []);
});

test('integrity result is independent of whether a user owns the instrument', () => {
  const unowned = evaluateInstrumentIntegrity({ instrument: { ...usEquity(), portfolioOwned: false }, quote: verifiedQuote(), purpose: 'DECISION' });
  const owned = evaluateInstrumentIntegrity({ instrument: { ...usEquity(), portfolioOwned: true }, quote: verifiedQuote(), purpose: 'DECISION' });
  assert.equal(unowned.decisionReady, true);
  assert.equal(owned.decisionReady, true);
  assert.deepEqual(owned.blockers, unowned.blockers);
  assert.equal(owned.invariant, 'SAME_INSTRUMENT_INTEGRITY_RULES_FOR_ALL_USERS_AND_PORTFOLIOS');
});

test('valid Athens equity uses the same gate and requires explicit EUR identity', () => {
  const instrument = {
    instrumentId: 'company:synthetic-gr',
    assetClass: 'EQUITY',
    primaryListing: {
      symbol: 'SYNGR', mic: 'XATH', exchange: 'Euronext Athens', currency: 'EUR', activeTradingVerified: true, status: 'ACTIVE',
    },
  };
  const quote = verifiedQuote({ appSymbol: 'SYNGR.GR', companyId: 'company:synthetic-gr', nativeCurrency: 'EUR' });
  const result = evaluateInstrumentIntegrity({ instrument, quote, purpose: 'DECISION' });
  assert.equal(result.decisionReady, true);
  assert.deepEqual(result.blockers, []);
});

test('unknown or incomplete products fail closed instead of receiving inferred identity', () => {
  const unknown = evaluateInstrumentIntegrity({ instrument: { symbol: 'MYSTERY' }, quote: verifiedQuote({ appSymbol: 'MYSTERY' }), purpose: 'DECISION' });
  assert.equal(unknown.decisionReady, false);
  assert.ok(unknown.blockers.includes('ASSET_CLASS_UNSUPPORTED'));

  const noVenue = evaluateInstrumentIntegrity({
    instrument: { instrumentId: 'company:no-venue', assetClass: 'EQUITY', primaryListing: { symbol: 'NOVENUE', currency: 'USD', activeTradingVerified: true, status: 'ACTIVE' } },
    quote: verifiedQuote({ appSymbol: 'NOVENUE', companyId: 'company:no-venue' }),
    purpose: 'DECISION',
  });
  assert.equal(noVenue.routingReady, false);
  assert.ok(noVenue.blockers.includes('LISTING_VENUE_REQUIRED'));
});

test('symbol, issuer and currency mismatches block valuation and decisions', () => {
  const symbolMismatch = evaluateInstrumentIntegrity({ instrument: usEquity(), quote: verifiedQuote({ appSymbol: 'OTHER.US' }), purpose: 'DECISION' });
  assert.ok(symbolMismatch.blockers.includes('QUOTE_INSTRUMENT_MISMATCH'));

  const issuerMismatch = evaluateInstrumentIntegrity({ instrument: usEquity(), quote: verifiedQuote({ companyId: 'company:other' }), purpose: 'DECISION' });
  assert.ok(issuerMismatch.blockers.includes('QUOTE_ENTITY_MISMATCH'));

  const currencyMismatch = evaluateInstrumentIntegrity({ instrument: usEquity(), quote: verifiedQuote({ nativeCurrency: 'EUR' }), purpose: 'DECISION' });
  assert.ok(currencyMismatch.blockers.includes('QUOTE_CURRENCY_MISMATCH'));
  assert.ok(currencyMismatch.blockers.includes('QUOTE_VENUE_CURRENCY_MISMATCH'));
});

test('inactive listings and non-decision-grade quotes can be stored but cannot drive an action', () => {
  const inactive = usEquity({
    primaryListing: { ...usEquity().primaryListing, activeTradingVerified: false, status: 'DELISTED' },
  });
  const storage = evaluateInstrumentIntegrity({ instrument: inactive, quote: null, purpose: 'STORAGE' });
  const decision = evaluateInstrumentIntegrity({ instrument: inactive, quote: verifiedQuote(), purpose: 'DECISION' });
  assert.equal(storage.identityReady, true);
  assert.equal(decision.decisionReady, false);
  assert.ok(decision.blockers.includes('ACTIVE_LISTING_NOT_VERIFIED'));
  assert.ok(decision.blockers.includes('LISTING_NOT_ACTIVE'));

  const unverifiedTime = evaluateInstrumentIntegrity({
    instrument: usEquity(),
    quote: verifiedQuote({ timestampVerified: false, decisionEligible: false }),
    purpose: 'DECISION',
  });
  assert.ok(unverifiedTime.blockers.includes('QUOTE_TIMESTAMP_NOT_VERIFIED'));
  assert.ok(unverifiedTime.blockers.includes('QUOTE_NOT_DECISION_ELIGIBLE'));
});

test('ETF, FX and option identities are evaluated by asset-class structure, not ticker exceptions', () => {
  const etf = evaluateInstrumentIntegrity({
    instrument: {
      instrumentId: 'instrument:etf', assetClass: 'ETF',
      primaryListing: { symbol: 'ETFTEST', mic: 'XNAS', exchange: 'Nasdaq', currency: 'USD', activeTradingVerified: true, status: 'ACTIVE' },
    },
    quote: verifiedQuote({ appSymbol: 'ETFTEST.US', companyId: 'instrument:etf' }),
    purpose: 'DECISION',
  });
  assert.equal(etf.decisionReady, true);

  const fx = evaluateInstrumentIntegrity({
    instrument: { instrumentId: 'fx:EURUSD', assetClass: 'FX', baseCurrency: 'EUR', quoteCurrency: 'USD' },
    quote: verifiedQuote({ appSymbol: 'EURUSD', companyId: null, nativeCurrency: 'USD' }),
    purpose: 'DECISION',
  });
  assert.equal(fx.decisionReady, true);

  const incompleteOption = evaluateInstrumentIntegrity({
    instrument: { instrumentId: 'option:test', assetClass: 'OPTION', symbol: 'OPT', underlying: 'SYNTH', strike: 100 },
    quote: verifiedQuote({ appSymbol: 'OPT', companyId: null }),
    purpose: 'DECISION',
  });
  assert.equal(incompleteOption.decisionReady, false);
  assert.ok(incompleteOption.blockers.includes('OPTION_EXPIRY_REQUIRED'));
  assert.ok(incompleteOption.blockers.includes('OPTION_RIGHT_REQUIRED'));
});
