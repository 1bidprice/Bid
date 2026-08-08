import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstrumentProfile } from '../src/instrument-profile.js';
import { evaluateInstrumentCapabilities } from '../src/instrument-capability-evaluator.js';

const verified = (value, extra = {}) => ({ value, verified: true, sourceRole: 'LICENSED_MARKET_DATA', ...extra });

function complete(profile, overrides = {}) {
  const base = {};
  for (const key of profile.requiredCapabilities) base[key] = { verified: true, sourceRole: 'PRIMARY_REGULATORY', value: 1 };
  return { capabilities: { ...base, ...overrides } };
}

test('ETF evaluator is reusable and produces a category-specific risk passport from normalized capabilities', () => {
  const profile = buildInstrumentProfile({ instrumentType: 'ETF', instrumentId: 'instrument:test:etf' });
  const result = evaluateInstrumentCapabilities(profile, complete(profile, {
    EXPENSE_RATIO: verified(0.18, { valuePct: 0.18 }),
    TRACKING_ERROR: verified(0.35, { valuePct: 0.35 }),
    HOLDINGS: { verified: true, sourceRole: 'PRIMARY_ISSUER', count: 350 },
    LIQUIDITY: { verified: true, sourceRole: 'LICENSED_MARKET_DATA', bidAskSpreadPct: 0.08, avgDollarVolume: 80_000_000 },
    CONCENTRATION: { verified: true, sourceRole: 'PRIMARY_ISSUER', top10WeightPct: 22, largestHoldingWeightPct: 4.2 },
  }));
  assert.equal(result.analysisModel, 'ETF_PORTFOLIO');
  assert.equal(result.status, 'MODEL_READY');
  assert.equal(result.decisionModelReady, true);
  assert.equal(result.actionPolicy, 'LONG_ONLY_FUND');
  assert.ok(result.riskScore < 40);
});

test('missing or unverified capabilities fail closed instead of generating a risk score', () => {
  const profile = buildInstrumentProfile({ instrumentType: 'BOND', instrumentId: 'instrument:test:bond', maturityDate: '2032-01-01' });
  const input = complete(profile);
  delete input.capabilities.CREDIT_QUALITY;
  input.capabilities.SPREAD = { value: 250, verified: false, sourceRole: 'FALLBACK_UNVERIFIED' };
  const result = evaluateInstrumentCapabilities(profile, input);
  assert.equal(result.status, 'BLOCKED_BY_CAPABILITIES');
  assert.equal(result.riskScore, null);
  assert.ok(result.blockers.includes('CAPABILITY_REQUIRED:CREDIT_QUALITY'));
  assert.ok(result.blockers.includes('CAPABILITY_UNVERIFIED:SPREAD'));
});

test('option and future models require explicit strategy context in addition to market capabilities', () => {
  for (const instrument of [
    { instrumentType: 'OPTION', instrumentId: 'instrument:test:option', strike: 100 },
    { instrumentType: 'FUTURE', instrumentId: 'instrument:test:future', contractMonth: '2026-12' },
  ]) {
    const profile = buildInstrumentProfile(instrument);
    const input = complete(profile, instrument.instrumentType === 'OPTION' ? {
      OPTION_PRICE: verified(4.2, { mid: 4.2 }),
      IMPLIED_VOLATILITY: verified(35, { valuePct: 35 }),
      GREEKS: { verified: true, sourceRole: 'LICENSED_MARKET_DATA', delta: 0.45, gamma: 0.04, theta: -0.08, vega: 0.12 },
      LIQUIDITY: { verified: true, sourceRole: 'LICENSED_MARKET_DATA', bidAskSpreadPct: 2, openInterest: 2000 },
      EXPIRY: { verified: true, sourceRole: 'PRIMARY_EXCHANGE', daysToExpiry: 45 },
    } : {
      FUTURES_PRICE: verified(5200, { price: 5200 }),
      CONTRACT_MULTIPLIER: verified(50),
      MARGIN_RISK: { verified: true, sourceRole: 'PRIMARY_EXCHANGE', initialMargin: 18_000 },
      EXPIRY: { verified: true, sourceRole: 'PRIMARY_EXCHANGE', daysToExpiry: 60 },
    });
    const blocked = evaluateInstrumentCapabilities(profile, input);
    assert.equal(blocked.decisionModelReady, false);
    assert.ok(blocked.blockers.includes('STRATEGY_CONTEXT_REQUIRED'));
    input.capabilities.STRATEGY_CONTEXT = { verified: true, sourceRole: 'USER_DECLARED', objective: 'hedge', maxLossDefined: true };
    const ready = evaluateInstrumentCapabilities(profile, input);
    assert.equal(ready.decisionModelReady, true);
  }
});

test('equities are delegated to existing specialized equity engines rather than re-scored by generic capability logic', () => {
  const profile = buildInstrumentProfile({ companyId: 'company:test:bank', displayName: 'Unknown Bank', sector: 'Banking', issuerId: '100', primaryListing: { mic: 'XATH', symbol: 'BANKX' } });
  const result = evaluateInstrumentCapabilities(profile, { capabilities: {} });
  assert.equal(profile.analysisModel, 'EQUITY_BANK');
  assert.equal(result.status, 'DELEGATED_TO_EQUITY_ENGINE');
  assert.equal(result.riskScore, null);
});
