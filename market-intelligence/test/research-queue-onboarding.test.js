import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQueuedResearchRecords, resolveQueuedResearchUniverse } from '../src/research-queue-onboarding.js';

function secPayload() {
  return {
    fields: ['cik', 'name', 'ticker', 'exchange'],
    data: [
      [1045810, 'NVIDIA CORP', 'NVDA', 'Nasdaq'],
      [1652044, 'ALPHABET INC', 'GOOGL', 'Nasdaq'],
    ],
  };
}

test('queue records dedupe and keep only active queued canonical symbols', () => {
  const rows = normalizeQueuedResearchRecords([
    { symbol: 'nvda.us', status: 'QUEUED', lastRequestedAt: '2026-09-01T00:00:00Z' },
    { symbol: 'NVDA.US', status: 'QUEUED', lastRequestedAt: '2026-09-02T00:00:00Z' },
    { symbol: 'SPCE.US', status: 'COMPLETED' },
    { symbol: 'bad', status: 'QUEUED' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, 'NVDA.US');
  assert.equal(rows[0].lastRequestedAt, '2026-09-02T00:00:00Z');
});

test('queued US symbol resolves through SEC identity into a canonical focus company', async () => {
  const result = await resolveQueuedResearchUniverse([
    { symbol: 'NVDA.US', status: 'QUEUED', firstRequestedAt: '2026-09-01T00:00:00Z' },
  ], {
    generatedAt: '2026-09-23T12:00:00Z',
    secUserAgent: 'Investor Control test test@example.com',
    fetchImpl: async () => new Response(JSON.stringify(secPayload()), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  assert.equal(result.requestedCount, 1);
  assert.equal(result.resolvedCount, 1);
  assert.equal(result.companies[0].companyId, 'company:sec:0001045810');
  assert.equal(result.companies[0].cik, '0001045810');
  assert.equal(result.companies[0].primaryListing.symbol, 'NVDA');
  assert.equal(result.companies[0].primaryListing.mic, 'XNAS');
  assert.equal(result.companies[0].researchQueue.requestedSymbol, 'NVDA.US');
});

test('queued Greek symbol remains fail-closed until dynamic official identity resolver exists', async () => {
  const result = await resolveQueuedResearchUniverse([
    { symbol: 'NEWCO.GR', status: 'QUEUED' },
  ], {
    generatedAt: '2026-09-23T12:00:00Z',
    secUserAgent: 'Investor Control test test@example.com',
    fetchImpl: async () => { throw new Error('US provider must not run'); },
  });
  assert.equal(result.resolvedCount, 0);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.results[0].code, 'DYNAMIC_QUEUE_MARKET_IDENTITY_NOT_SUPPORTED');
});

test('ambiguous or missing SEC identity never creates a focus company', async () => {
  const result = await resolveQueuedResearchUniverse([
    { symbol: 'ZZZZ.US', status: 'QUEUED' },
  ], {
    generatedAt: '2026-09-23T12:00:00Z',
    secUserAgent: 'Investor Control test test@example.com',
    fetchImpl: async () => new Response(JSON.stringify(secPayload()), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  assert.equal(result.resolvedCount, 0);
  assert.equal(result.results[0].code, 'QUEUE_IDENTITY_NOT_FOUND');
});
