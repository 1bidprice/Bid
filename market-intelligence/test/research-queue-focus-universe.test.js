import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFocusUniverse } from '../src/run-autonomous-intelligence.js';

const seed = [{
  companyId: 'company:seed',
  displayName: 'Seed Co',
  cik: '0000000001',
  primaryListing: { symbol: 'SEED', exchange: 'NASDAQ', mic: 'XNAS', currency: 'USD' },
  active: true,
}];

const queued = [{
  companyId: 'company:sec:0001045810',
  displayName: 'NVIDIA CORP',
  cik: '0001045810',
  primaryListing: { symbol: 'NVDA', exchange: 'NASDAQ', mic: 'XNAS', currency: 'USD' },
  aliases: ['NVDA'],
  researchQueue: { source: 'MINBEIS_PERSISTENT_RESEARCH_QUEUE', requestedSymbol: 'NVDA.US' },
}];

test('queued canonical company becomes part of focus universe without replacing seed identity', () => {
  const focus = buildFocusUniverse(seed, queued);
  assert.equal(focus.length, 2);
  assert.ok(focus.some((item) => item.companyId === 'company:seed'));
  const nvda = focus.find((item) => item.companyId === 'company:sec:0001045810');
  assert.equal(nvda.primaryListing.symbol, 'NVDA');
  assert.equal(nvda.researchQueue.requestedSymbol, 'NVDA.US');
});

test('queued duplicate cannot override earlier canonical seed identity', () => {
  const duplicate = [{
    companyId: 'company:seed',
    displayName: 'Wrong Override',
    cik: '0000000001',
    primaryListing: { symbol: 'SEED', exchange: 'WRONG', mic: 'XNAS', currency: 'USD' },
    researchQueue: { requestedSymbol: 'SEED.US' },
  }];
  const [merged] = buildFocusUniverse(seed, duplicate);
  assert.equal(merged.displayName, 'Seed Co');
  assert.equal(merged.primaryListing.exchange, 'NASDAQ');
});
