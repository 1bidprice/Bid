import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperationalHealth } from '../src/operational-health.js';

test('full current market coverage stays operational when historical analytics coverage is only partial', () => {
  const health = buildOperationalHealth({
    generatedAt: '2026-09-12T12:11:15.474Z',
    analysedCompanyCount: 32,
    marketSnapshotCount: 32,
    historicalMarketMetricsCount: 23,
    readyHistoricalMarketMetricsCount: 23,
    fundamentalSnapshotCount: 32,
    finalActionCount: 8,
    blockedDecisionCount: 24,
    researchDossierCount: 32,
  });

  assert.equal(health.status, 'OPERATIONAL');
  assert.equal(health.marketDataStatus, 'OPERATIONAL');
  assert.equal(health.historicalAnalyticsStatus, 'PARTIAL');
  assert.equal(health.historyCoverageRatio, 0.7188);
  assert.equal(health.fundamentalsStatus, 'OPERATIONAL');
  assert.equal(health.decisionEngineStatus, 'READY');
});

test('actual current market-data coverage failure still degrades the system', () => {
  const health = buildOperationalHealth({
    analysedCompanyCount: 32,
    marketSnapshotCount: 20,
    historicalMarketMetricsCount: 32,
    readyHistoricalMarketMetricsCount: 32,
    fundamentalSnapshotCount: 32,
    finalActionCount: 8,
    blockedDecisionCount: 24,
    researchDossierCount: 32,
  });

  assert.equal(health.status, 'DEGRADED');
  assert.equal(health.marketDataStatus, 'DEGRADED');
  assert.equal(health.historicalAnalyticsStatus, 'OPERATIONAL');
});

test('missing historical analytics is explicit but does not masquerade as a current quote outage', () => {
  const health = buildOperationalHealth({
    analysedCompanyCount: 12,
    marketSnapshotCount: 12,
    historicalMarketMetricsCount: 0,
    readyHistoricalMarketMetricsCount: 0,
    fundamentalSnapshotCount: 12,
    finalActionCount: 0,
    blockedDecisionCount: 12,
    researchDossierCount: 12,
  });

  assert.equal(health.status, 'OPERATIONAL');
  assert.equal(health.marketDataStatus, 'OPERATIONAL');
  assert.equal(health.historicalAnalyticsStatus, 'UNAVAILABLE');
  assert.equal(health.decisionEngineStatus, 'BLOCKED_BY_EVIDENCE');
  assert.equal(health.finalActionCount, 0);
  assert.equal(health.blockedDecisionCount, 12);
});

test('fundamental coverage remains a genuine global health dependency', () => {
  const health = buildOperationalHealth({
    analysedCompanyCount: 20,
    marketSnapshotCount: 20,
    historicalMarketMetricsCount: 20,
    readyHistoricalMarketMetricsCount: 20,
    fundamentalSnapshotCount: 10,
    finalActionCount: 0,
    blockedDecisionCount: 20,
    researchDossierCount: 20,
  });

  assert.equal(health.marketDataStatus, 'OPERATIONAL');
  assert.equal(health.fundamentalsStatus, 'DEGRADED');
  assert.equal(health.status, 'DEGRADED');
});
