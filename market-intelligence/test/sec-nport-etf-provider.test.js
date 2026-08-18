import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstrumentProfile } from '../src/instrument-profile.js';
import { collectInstrumentCapabilities } from '../src/instrument-capability-collector.js';
import { evaluateInstrumentCapabilities } from '../src/instrument-capability-evaluator.js';
import { secNportEtfCapabilityProvider } from '../src/adapters/sec-nport-etf-capability-provider.js';

const XML = `<edgarSubmission><formData><genInfo><regCik>0001944285</regCik><seriesId>S000088946</seriesId></genInfo><invstOrSecs><invstOrSec><name>A</name><pctVal>30</pctVal></invstOrSec><invstOrSec><name>B</name><pctVal>25</pctVal></invstOrSec><invstOrSec><name>C</name><pctVal>20</pctVal></invstOrSec><invstOrSec><name>D</name><pctVal>15</pctVal></invstOrSec><invstOrSec><name>E</name><pctVal>10</pctVal></invstOrSec></invstOrSecs></formData></edgarSubmission>`;

function etf(identity = null) {
  return { instrumentType: 'ETF', instrumentId: 'instrument:test:etf', displayName: 'Test ETF', country: 'US', primaryListing: { symbol: 'ANY', mic: 'ARCX', currency: 'USD' }, ...(identity ? { secFundIdentity: identity } : {}) };
}

const identity = { cik: '0001944285', seriesId: 'S000088946', nportPrimaryDocumentUrl: 'https://www.sec.gov/Archives/edgar/data/1944285/000089418926012695/primary_doc.xml' };

test('missing canonical SEC fund identity performs zero network work', async () => {
  let calls = 0;
  const instrument = etf();
  const profile = buildInstrumentProfile(instrument);
  const result = await secNportEtfCapabilityProvider.collect({ instrument, profile, fetchImpl: async () => { calls += 1; throw new Error('must not fetch'); } });
  assert.equal(calls, 0);
  assert.deepEqual(result.capabilities, {});
  assert.ok(result.diagnostics.some((d) => d.code === 'ETF_SEC_FUND_IDENTITY_REQUIRED'));
});

test('official N-PORT provider contributes verified holdings and concentration through generic capability collector', async () => {
  const instrument = etf(identity);
  const profile = buildInstrumentProfile(instrument);
  const result = await collectInstrumentCapabilities(instrument, profile, {
    marketSnapshot: { currentPrice: 100, usable: true, sourceVerified: true, sourceRole: 'LICENSED_MARKET_DATA', currency: 'USD' },
    marketMetrics: { readiness: { marketMetricsReady: true }, observationCount: 250, liquidity: { avgDollarVolume: 20_000_000, bidAskSpreadPct: 0.05 } },
    providers: [secNportEtfCapabilityProvider],
    fetchImpl: async (url) => ({ ok: true, status: 200, text: async () => { assert.equal(url, identity.nportPrimaryDocumentUrl); return XML; } }),
  });
  assert.equal(result.capabilities.HOLDINGS.count, 5);
  assert.equal(result.capabilities.HOLDINGS.sourceAuthority, 'SEC_EDGAR_FORM_NPORT');
  assert.equal(result.capabilities.CONCENTRATION.top10WeightPct, 100);
  assert.equal(result.capabilities.CONCENTRATION.providerId, 'SEC_NPORT_ETF_PRIMARY_REGULATORY');
});

test('N-PORT holdings alone never make ETF decision-grade without expense ratio and tracking error', async () => {
  const instrument = etf(identity);
  const profile = buildInstrumentProfile(instrument);
  const passport = await collectInstrumentCapabilities(instrument, profile, {
    marketSnapshot: { currentPrice: 100, usable: true, sourceVerified: true, sourceRole: 'LICENSED_MARKET_DATA', currency: 'USD' },
    marketMetrics: { readiness: { marketMetricsReady: true }, observationCount: 250, liquidity: { avgDollarVolume: 20_000_000, bidAskSpreadPct: 0.05 } },
    providers: [secNportEtfCapabilityProvider],
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => XML }),
  });
  const evaluation = evaluateInstrumentCapabilities(profile, passport);
  assert.equal(evaluation.coverage.ready, false);
  assert.equal(evaluation.riskScore, null);
  assert.ok(evaluation.coverage.missing.includes('EXPENSE_RATIO'));
  assert.ok(evaluation.coverage.missing.includes('TRACKING_ERROR'));
});
