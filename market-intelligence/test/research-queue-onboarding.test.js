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

function athensDirectoryHtml() {
  return `
  <table>
    <thead><tr><th>Issuer</th><th>ISIN Code</th><th>OASIS Code</th><th>Market</th><th>MIFID</th><th>Market Segment</th><th>Product</th><th>Product Name</th></tr></thead>
    <tbody>
      <tr>
        <td><a href="/en/market-data/issuers/4321">QUEST HOLDINGS S.A.</a></td>
        <td>GRS310003009</td>
        <td><a href="/en/market-data/instruments/stocks/QUEST">QUEST</a></td>
        <td>ATHEX</td><td>SHRS</td><td>MAIN MARKET</td><td>Stock</td><td>QUEST HOLDINGS</td>
      </tr>
    </tbody>
  </table>`;
}

test('queue records dedupe and retain completed research enrollments', () => {
  const rows = normalizeQueuedResearchRecords([
    { symbol: 'nvda.us', status: 'QUEUED', lastRequestedAt: '2026-09-01T00:00:00Z' },
    { symbol: 'NVDA.US', status: 'QUEUED', lastRequestedAt: '2026-09-02T00:00:00Z' },
    { symbol: 'SPCE.US', status: 'COMPLETED' },
    { symbol: 'bad', status: 'QUEUED' },
  ]);
  assert.equal(rows.length, 2);
  const nvda = rows.find((row) => row.symbol === 'NVDA.US');
  const spce = rows.find((row) => row.symbol === 'SPCE.US');
  assert.equal(nvda.lastRequestedAt, '2026-09-02T00:00:00Z');
  assert.equal(spce.status, 'COMPLETED');
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

test('completed research enrollment remains in the canonical focus universe', async () => {
  const result = await resolveQueuedResearchUniverse([
    { symbol: 'GOOGL.US', status: 'COMPLETED', firstRequestedAt: '2026-09-01T00:00:00Z' },
  ], {
    generatedAt: '2026-09-23T12:00:00Z',
    secUserAgent: 'Investor Control test test@example.com',
    fetchImpl: async () => new Response(JSON.stringify(secPayload()), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  assert.equal(result.requestedCount, 1);
  assert.equal(result.queuedCount, 0);
  assert.equal(result.completedEnrollmentCount, 1);
  assert.equal(result.resolvedCount, 1);
  assert.equal(result.companies[0].companyId, 'company:sec:0001652044');
  assert.equal(result.companies[0].researchQueue.requestedSymbol, 'GOOGL.US');
  assert.equal(result.companies[0].researchQueue.status, 'COMPLETED');
});

test('queued Greek symbol resolves through official Euronext Athens trading directory', async () => {
  const result = await resolveQueuedResearchUniverse([
    { symbol: 'QUEST.GR', status: 'QUEUED', firstRequestedAt: '2026-09-01T00:00:00Z' },
  ], {
    generatedAt: '2026-09-23T12:00:00Z',
    secUserAgent: 'Investor Control test test@example.com',
    fetchImpl: async () => new Response(athensDirectoryHtml(), { status: 200, headers: { 'Content-Type': 'text/html' } }),
  });
  assert.equal(result.requestedCount, 1);
  assert.equal(result.resolvedCount, 1);
  assert.equal(result.blockedCount, 0);
  assert.equal(result.companies[0].companyId, 'company:xath:issuer-4321');
  assert.equal(result.companies[0].issuerId, '4321');
  assert.equal(result.companies[0].isin, 'GRS310003009');
  assert.equal(result.companies[0].primaryListing.symbol, 'QUEST');
  assert.equal(result.companies[0].primaryListing.mic, 'XATH');
  assert.equal(result.companies[0].primaryListing.currency, 'EUR');
  assert.equal(result.companies[0].primaryListing.activeTradingVerified, true);
  assert.equal(result.companies[0].researchQueue.requestedSymbol, 'QUEST.GR');
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


test('unknown Greek symbol remains fail-closed without inventing an issuer', async () => {
  const result = await resolveQueuedResearchUniverse([
    { symbol: 'ZZZZ.GR', status: 'QUEUED' },
  ], {
    generatedAt: '2026-09-23T12:00:00Z',
    fetchImpl: async () => new Response(athensDirectoryHtml(), { status: 200, headers: { 'Content-Type': 'text/html' } }),
  });
  assert.equal(result.resolvedCount, 0);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.results[0].code, 'ATHENS_SYMBOL_IDENTITY_NOT_FOUND');
});
