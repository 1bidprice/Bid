import test from 'node:test';
import assert from 'node:assert/strict';
import { scanOpportunityUniverse } from '../src/opportunity-universe-scanner.js';

const vf = (score) => ({ score, verified: true, sourceCount: 2, ageHours: 4 });

const universeProvider = {
  id: 'TEST_CROSS_ASSET_UNIVERSE',
  async discover() {
    return {
      instruments: [
        {
          instrumentId: 'equity:alpha',
          displayName: 'Alpha Equity',
          assetClass: 'EQUITY',
          country: 'US',
          primaryListing: { symbol: 'ALFA', mic: 'XNYS', exchange: 'NYSE', currency: 'USD' },
          opportunityRiskScore: 26,
          executionQualityScore: 91,
          evidenceQualityScore: 92,
        },
        {
          instrumentId: 'bond:alpha',
          displayName: 'Alpha Bond 2032',
          assetClass: 'BOND',
          maturityDate: '2032-06-30',
          currency: 'EUR',
          opportunityRiskScore: 22,
          executionQualityScore: 76,
          evidenceQualityScore: 88,
        },
      ],
    };
  },
};

const capabilityProvider = {
  id: 'TEST_OPPORTUNITY_FACTORS',
  async supports() { return true; },
  async collect({ instrument, profile }) {
    if (profile.assetClass === 'EQUITY') {
      return { capabilities: {
        OPPORTUNITY_FACTORS: { verified: true, sourceRole: 'TEST_VERIFIED', factors: {
          valuation: vf(94), quality: vf(92), growth: vf(86), momentum: vf(90), catalyst: vf(84), balanceSheet: vf(95), liquidity: vf(92), diversificationBenefit: vf(78),
        } },
        EVIDENCE_QUALITY: { verified: true, sourceRole: 'TEST_VERIFIED', score: 92 },
        LIQUIDITY: { verified: true, sourceRole: 'TEST_VERIFIED', score: 91, avgDollarVolume: 90_000_000, bidAskSpreadPct: 0.08 },
      } };
    }
    if (profile.assetClass === 'BOND') {
      return { capabilities: {
        OPPORTUNITY_FACTORS: { verified: true, sourceRole: 'TEST_VERIFIED', factors: {
          carry: vf(88), relativeValue: vf(90), creditQuality: vf(94), creditMomentum: vf(82), durationFit: vf(80), catalyst: vf(76), liquidity: vf(79), diversificationBenefit: vf(91),
        } },
        EVIDENCE_QUALITY: { verified: true, sourceRole: 'TEST_VERIFIED', score: 88 },
        LIQUIDITY: { verified: true, sourceRole: 'TEST_VERIFIED', score: 76, avgDollarVolume: 8_000_000, bidAskSpreadPct: 0.25 },
        MARKET_PRICE: { verified: true, sourceRole: 'TEST_VERIFIED', value: 101.2 },
        YIELD: { verified: true, sourceRole: 'TEST_VERIFIED', yieldToMaturityPct: 5.2 },
        COUPON: { verified: true, sourceRole: 'TEST_VERIFIED', value: 4.5 },
        MATURITY: { verified: true, sourceRole: 'TEST_VERIFIED', value: instrument.maturityDate },
        DURATION: { verified: true, sourceRole: 'TEST_VERIFIED', modifiedDuration: 4.8 },
        CREDIT_QUALITY: { verified: true, sourceRole: 'TEST_VERIFIED', rating: 'A' },
        SPREAD: { verified: true, sourceRole: 'TEST_VERIFIED', spreadBps: 145 },
      } };
    }
    return { capabilities: {} };
  },
};

test('universe scanner merges provider instruments and produces cross-asset opportunity ranking without final BUY leakage', async () => {
  const result = await scanOpportunityUniverse({
    now: '2026-08-09T11:00:00.000Z',
    instruments: [{
      instrumentId: 'equity:alpha',
      displayName: 'Alpha Equity seed duplicate',
      assetClass: 'EQUITY',
      country: 'US',
      primaryListing: { symbol: 'ALFA', mic: 'XNYS', exchange: 'NYSE', currency: 'USD' },
    }],
    universeProviders: [universeProvider],
    capabilityProviders: [capabilityProvider],
    assetClasses: ['EQUITY', 'BOND'],
  });

  assert.equal(result.providerCount, 1);
  assert.equal(result.discoveredInstrumentCount, 2);
  assert.equal(result.uniqueInstrumentCount, 2, 'duplicate seed/provider identity must be merged');
  assert.equal(result.scorableInstrumentCount, 2);
  assert.equal(result.ranking.items.length, 2);
  assert.ok(result.ranking.superOpportunityCount >= 1);
  assert.equal(result.byAssetClass.EQUITY, 1);
  assert.equal(result.byAssetClass.BOND, 1);
  assert.ok(result.ranking.items.every((item) => item.finalActionEligible === false));
  assert.ok(result.ranking.items.every((item) => ['DEEP_VERIFY_NOW', 'DEEP_VERIFY', 'WATCH'].includes(item.discoveryAction)));
});

test('instrument without verified opportunity factors is fail-closed instead of receiving an invented score', async () => {
  const result = await scanOpportunityUniverse({
    now: '2026-08-09T11:00:00.000Z',
    instruments: [{ instrumentId: 'crypto:no-factors', displayName: 'Unknown Token', assetClass: 'CRYPTO', baseAsset: 'UNK', quoteAsset: 'USD' }],
    universeProviders: [],
    capabilityProviders: [],
    assetClasses: ['CRYPTO'],
  });

  assert.equal(result.scorableInstrumentCount, 0);
  assert.equal(result.unsupportedInstrumentCount, 1);
  assert.equal(result.unsupported[0].reason, 'OPPORTUNITY_FACTORS_REQUIRED');
  assert.equal(result.ranking.superOpportunityCount, 0);
});
