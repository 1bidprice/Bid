import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstrumentProfile } from '../src/instrument-profile.js';
import { collectInstrumentCapabilities } from '../src/instrument-capability-collector.js';

const provider = {
  id: 'TEST_ETF_PROVIDER',
  supports: ({ profile }) => profile.assetClass === 'ETF',
  collect: async () => ({
    capabilities: {
      HOLDINGS: { verified: true, sourceRole: 'PRIMARY_ISSUER', count: 500, top10WeightPct: 24 },
      EXPENSE_RATIO: { verified: true, sourceRole: 'PRIMARY_ISSUER', valuePct: 0.12 },
      TRACKING_ERROR: { verified: true, sourceRole: 'LICENSED_MARKET_DATA', valuePct: 0.25 },
      CONCENTRATION: { verified: true, sourceRole: 'PRIMARY_ISSUER', top10WeightPct: 24, largestHoldingWeightPct: 5 },
    },
  }),
};

test('capability collector combines reusable provider data with market capabilities and no ticker mapping', async () => {
  const instrument = { instrumentType: 'ETF', instrumentId: 'instrument:test:any-etf', displayName: 'Any ETF', primaryListing: { symbol: 'ANY', mic: 'ARCX', currency: 'USD' } };
  const profile = buildInstrumentProfile(instrument);
  const result = await collectInstrumentCapabilities(instrument, profile, {
    marketSnapshot: { currentPrice: 100, usable: true, sourceVerified: true, currency: 'USD', sourceRole: 'LICENSED_MARKET_DATA' },
    marketMetrics: { readiness: { marketMetricsReady: true }, observationCount: 250, liquidity: { avgDollarVolume: 50_000_000, bidAskSpreadPct: 0.04 } },
    providers: [provider],
  });
  assert.equal(result.capabilities.MARKET_PRICE.value, 100);
  assert.equal(result.capabilities.HOLDINGS.count, 500);
  assert.equal(result.capabilities.EXPENSE_RATIO.valuePct, 0.12);
  assert.equal(result.capabilities.LIQUIDITY.avgDollarVolume, 50_000_000);
  assert.equal(result.invariant, 'NORMALIZED_CAPABILITIES_NO_TICKER_BRANCHING');
});

test('unverified fallback cannot replace already verified capability', async () => {
  const instrument = {
    instrumentType: 'BOND', instrumentId: 'instrument:test:bond', maturityDate: '2032-01-01',
    capabilities: { CREDIT_QUALITY: { verified: true, sourceRole: 'PRIMARY_REGULATORY', rating: 'A' } },
  };
  const profile = buildInstrumentProfile(instrument);
  const result = await collectInstrumentCapabilities(instrument, profile, {
    providers: [{ id: 'BAD_FALLBACK', collect: async () => ({ capabilities: { CREDIT_QUALITY: { verified: false, sourceRole: 'FALLBACK_UNVERIFIED', rating: 'CCC' } } }) }],
  });
  assert.equal(result.capabilities.CREDIT_QUALITY.rating, 'A');
  assert.ok(result.diagnostics.some((item) => item.code === 'CAPABILITY_PROVIDER_DUPLICATE_IGNORED'));
});
