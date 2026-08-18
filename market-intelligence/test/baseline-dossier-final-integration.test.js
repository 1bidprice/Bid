import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchDossier } from '../src/research-dossier.js';
import { evaluateFinalAction } from '../src/final-action-policy.js';

const NOW = '2026-08-08T12:00:00.000Z';
const latestTimestamp = Math.floor(new Date('2026-08-07T20:00:00.000Z').getTime() / 1000);

const company = {
  companyId: 'company:test:baseline-integration',
  displayName: 'Example Baseline Co',
  legalName: 'Example Baseline Co Inc.',
  primaryListing: { symbol: 'EXBL', exchange: 'NYSE', mic: 'XNYS', currency: 'USD' },
};

const structuredEvidence = [
  {
    id: 'evidence:structured:fundamental',
    companyIds: [company.companyId],
    sourceName: 'SEC structured financial data',
    sourceType: 'STRUCTURED_FUNDAMENTALS',
    sourceUrl: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json',
    title: 'Verified structured fundamentals',
    publishedAt: '2026-08-07T12:00:00.000Z',
    contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    independenceGroup: 'structured-fundamentals:data.sec.gov',
    isPrimarySource: true,
    document: { reviewed: true, status: 'VERIFIED_STRUCTURED_DATA' },
  },
  {
    id: 'evidence:structured:market',
    companyIds: [company.companyId],
    sourceName: 'Licensed market data',
    sourceType: 'VERIFIED_MARKET_DATA',
    sourceUrl: 'https://example.test/market',
    title: 'Verified market state',
    publishedAt: '2026-08-07T20:00:00.000Z',
    contentHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    independenceGroup: 'market-data:LICENSED_MARKET_DATA',
    isPrimarySource: false,
    document: { reviewed: true, status: 'VERIFIED_STRUCTURED_DATA' },
  },
];

const marketMetrics = {
  companyId: company.companyId,
  companyName: company.displayName,
  appSymbol: 'EXBL',
  providerSymbol: 'EXBL',
  latestClose: 20,
  latestTimestamp,
  currency: 'USD',
  observationCount: 250,
  readiness: {
    priceHistoryReady: true,
    liquidityReady: true,
    relativeStrengthReady: true,
    sourceReady: true,
    crossCheckReady: true,
    benchmarkReady: true,
    marketMetricsReady: true,
  },
  dataQuality: {
    sourceReady: true,
    crossCheckReady: true,
    benchmarkReady: true,
    historySource: 'LICENSED_MARKET_DATA',
    benchmarkSource: 'LICENSED_MARKET_DATA',
  },
  liquidity: { score: 80 },
  relativeStrength: { excessReturnPct: 2 },
  trend: { distanceFromSma50Pct: 1, distanceFromSma200Pct: 4 },
  risk: { flags: [] },
};

const decisionCorroboration = {
  ready: true,
  decisionBasisEligible: 'FUNDAMENTAL_BASELINE',
  evidenceIds: structuredEvidence.map((record) => record.id),
  eventClaimCorroborated: false,
};

const dossier = () => buildResearchDossier({
  company,
  generatedAt: NOW,
  decisionBasis: 'FUNDAMENTAL_BASELINE',
  decisionCorroboration,
  category: 'FUNDAMENTAL_BASELINE',
  proposedAction: 'HOLD',
  timeHorizon: 'MONTHS',
  evidence: structuredEvidence,
  requireCanonicalClaim: false,
  fundamentals: { metricsReady: true },
  historicalMarketMetrics: marketMetrics,
  fundamentalRisk: { metricsReady: true, riskScore: 35, flags: [] },
  crossCheck: { recommendationReady: false, contradictionCount: 0 },
  thesis: 'Verified structured fundamentals and independently verified market history support a neutral HOLD baseline while no uncorroborated event is used as a catalyst.',
  causalMechanism: 'The position is governed by earnings quality, balance-sheet resilience, valuation and independently measured market risk.',
  catalysts: [{ text: 'Sustained improvement in verified financial performance would strengthen the baseline thesis.', evidenceIds: ['evidence:structured:fundamental'], confidence: 0.85, inference: true }],
  bullCase: 'Verified earnings and balance-sheet quality improve while valuation remains compatible with the measured risk profile.',
  bearCase: 'Verified profitability or balance-sheet quality deteriorates, or market risk weakens enough to invalidate the baseline thesis.',
  risks: [
    { text: 'Financial performance can deteriorate between reporting periods.', evidenceIds: ['evidence:structured:fundamental'], confidence: 0.9, inference: true },
    { text: 'Market risk and relative strength can change before the next financial report.', evidenceIds: ['evidence:structured:market'], confidence: 0.85, inference: true },
  ],
  invalidationCondition: 'The thesis is invalidated if verified fundamentals or market-risk measurements materially violate the baseline assumptions.',
  reviewDate: '2026-09-30',
});

test('FUNDAMENTAL_BASELINE decision corroboration survives dossier serialization into final action', () => {
  const built = dossier();
  assert.equal(built.status, 'REVIEW_READY', JSON.stringify(built.readiness, null, 2));
  assert.equal(built.decisionBasis, 'FUNDAMENTAL_BASELINE');
  assert.equal(built.metrics.decisionCorroboration?.ready, true, JSON.stringify(built.metrics, null, 2));
  assert.equal(built.metrics.crossCheck?.recommendationReady, false);
  assert.equal(built.integrityContractVersion, 1);
  assert.ok(built.evidence.every((record) => record.companyIds.includes(company.companyId)));

  const action = evaluateFinalAction(built, { now: NOW });
  assert.equal(action.status, 'FINAL', JSON.stringify(action, null, 2));
  assert.equal(action.marketAction, 'HOLD');
  assert.equal(action.holderAction, 'HOLD');
  assert.equal(action.nonHolderAction, 'WATCH');
  assert.ok(!action.blockers.includes('CROSS_CHECK_NOT_READY'));
  assert.ok(!action.blockers.includes('REFERENCE_PRICE_NOT_EXECUTION_ELIGIBLE'));
});

test('same evidence remains blocked when explicitly treated as EVENT_DRIVEN without event corroboration', () => {
  const built = dossier();
  built.decisionBasis = 'EVENT_DRIVEN';
  const action = evaluateFinalAction(built, { now: NOW });
  assert.equal(action.status, 'BLOCKED');
  assert.ok(action.blockers.includes('CROSS_CHECK_NOT_READY'));
});
