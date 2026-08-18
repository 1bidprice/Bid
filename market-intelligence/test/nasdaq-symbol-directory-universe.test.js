import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNasdaqListedUniverse, parseOtherListedUniverse, createNasdaqUsListedUniverseProvider } from '../src/adapters/nasdaq-symbol-directory-universe.js';

const nasdaq = `Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|40|N|N
AADR|AdvisorShares Dorsey Wright ADR ETF|G|N|N|100|Y|N
BADW|Example Corp. - Warrant|S|N|N|100|N|N
TEST|Test Security - Common Stock|Q|Y|N|100|N|N
DIST|Distressed Co. - Common Stock|S|N|Q|100|N|N
File Creation Time: 0809202612:00|||||||`;

const other = `ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
IBM|International Business Machines Corporation Common Stock|N|IBM|N|100|N|IBM
SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY
PREF|Issuer 7% Preferred Stock|N|PREF|N|100|N|PREF
File Creation Time: 0809202612:00|||||||`;

test('Nasdaq-listed parser keeps common equity and ETF, rejects structured/test issues and preserves financial-status risk', () => {
  const items = parseNasdaqListedUniverse(nasdaq);
  assert.deepEqual(items.map((item) => item.primaryListing.symbol), ['AAPL', 'AADR', 'DIST']);
  assert.equal(items.find((item) => item.primaryListing.symbol === 'AADR').assetClass, 'ETF');
  const distressed = items.find((item) => item.primaryListing.symbol === 'DIST');
  assert.ok(distressed.severeRiskFlags.includes('SEVERE_LISTING_BANKRUPTCY_STATUS'));
  assert.equal(items.some((item) => item.primaryListing.symbol === 'BADW'), false);
  assert.equal(items.some((item) => item.primaryListing.symbol === 'TEST'), false);
});

test('other-listed parser maps NYSE/Arca and the official ETF flag without treating preferred stock as equity', () => {
  const items = parseOtherListedUniverse(other);
  assert.deepEqual(items.map((item) => item.primaryListing.symbol), ['IBM', 'SPY']);
  assert.equal(items.find((item) => item.primaryListing.symbol === 'IBM').primaryListing.mic, 'XNYS');
  assert.equal(items.find((item) => item.primaryListing.symbol === 'SPY').primaryListing.mic, 'ARCX');
  assert.equal(items.find((item) => item.primaryListing.symbol === 'SPY').assetClass, 'ETF');
});

test('provider honors requested asset class and bounded discovery limit', async () => {
  const provider = createNasdaqUsListedUniverseProvider();
  const fetchImpl = async (url) => ({
    ok: true,
    text: async () => String(url).includes('nasdaqlisted') ? nasdaq : other,
  });
  const result = await provider.discover({ assetClasses: ['ETF'], fetchImpl, now: '2026-08-09T12:00:00.000Z', limit: 1 });
  assert.equal(result.instruments.length, 1);
  assert.equal(result.instruments[0].assetClass, 'ETF');
  assert.equal(result.truncated, true);
});
