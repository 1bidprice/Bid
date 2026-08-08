import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstrumentProfile } from '../src/instrument-profile.js';
import { assessDecisionCorroboration } from '../src/decision-corroboration.js';
import { synthesizeFundamentalBaseline } from '../src/fundamental-baseline-synthesis.js';

const company = {
  companyId: 'company:test:operating',
  displayName: 'Example Operating Co',
  sector: 'Industrials',
  primaryListing: { symbol: 'EXOP', mic: 'XNYS', exchange: 'NYSE', currency: 'USD' },
  cik: '0000009876',
};

function readyInput() {
  const instrumentProfile = buildInstrumentProfile(company);
  const fundamentals = {
    metricsReady: true,
    sourceUrl: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000009876.json',
    generatedAt: '2026-08-08T12:00:00.000Z',
    metrics: { annualRevenueGrowthPct: 12, annualNetMarginPct: 8, dilutedSharesChangePct: 1 },
  };
  const marketSnapshot = {
    quoteContract: { sourceRole: 'LICENSED_MARKET_DATA', analysisReferenceEligible: true, valuationEligible: true },
    sourceRole: 'LICENSED_MARKET_DATA',
  };
  const marketMetrics = {
    latestClose: 25,
    latestTimestamp: 1786204800,
    readiness: { marketMetricsReady: true },
    relativeStrength: { excessReturnPct: 5 },
    trend: { distanceFromSma50Pct: 4, distanceFromSma200Pct: 8 },
  };
  const fundamentalRisk = { metricsReady: true, riskScore: 35, flags: [], valuation: { priceToSales: 2.5, priceToBook: 3 } };
  const structuredEvidence = [
    { id: 'evidence:f', decisionEvidenceRole: 'FUNDAMENTAL_BASELINE', document: { reviewed: true } },
    { id: 'evidence:m', decisionEvidenceRole: 'MARKET_BASELINE', document: { reviewed: true } },
  ];
  return { instrumentProfile, fundamentals, marketSnapshot, marketMetrics, fundamentalRisk, structuredEvidence };
}

test('fundamental decision corroboration can be ready while an event claim remains uncorroborated', () => {
  const input = readyInput();
  const decision = assessDecisionCorroboration({ company, ...input, eventCrossCheck: { recommendationReady: false, contradictionCount: 0 } });
  assert.equal(decision.ready, true);
  assert.equal(decision.eventClaimCorroborated, false);
  assert.equal(decision.eventClaimSeparationInvariant, 'DECISION_CORROBORATION_NEVER_UPGRADES_EVENT_CLAIM');
  assert.ok(decision.evidenceIds.includes('evidence:f'));
  assert.ok(decision.evidenceIds.includes('evidence:m'));
});

test('fundamental baseline synthesis ignores the uncorroborated event and can generate a conservative model action', () => {
  const input = readyInput();
  const decisionCorroboration = assessDecisionCorroboration({ company, ...input, eventCrossCheck: { recommendationReady: false, contradictionCount: 0 } });
  const synthesis = synthesizeFundamentalBaseline({
    company,
    ...input,
    decisionCorroboration,
    generatedAt: '2026-08-08T12:00:00.000Z',
  });
  assert.equal(synthesis.decisionBasis, 'FUNDAMENTAL_BASELINE');
  assert.equal(synthesis.requireCanonicalClaim, false);
  assert.equal(synthesis.proposedAction, 'CONSIDER_BUY');
  assert.match(synthesis.thesis, /χωρίς να χρησιμοποιεί μη διασταυρωμένο εταιρικό γεγονός/);
  assert.ok(synthesis.risks.length >= 2);
  assert.ok(synthesis.catalysts[0].evidenceIds.includes('evidence:f'));
});

test('unsupported specialized equity model never becomes baseline-ready merely because generic fields exist', () => {
  const insurer = { ...company, companyId: 'company:test:insurer', displayName: 'Example Insurance Group', sector: 'Insurance' };
  const instrumentProfile = buildInstrumentProfile(insurer);
  const input = readyInput();
  const decision = assessDecisionCorroboration({ company: insurer, ...input, instrumentProfile, eventCrossCheck: { recommendationReady: false, contradictionCount: 0 } });
  assert.equal(instrumentProfile.analysisModel, 'EQUITY_INSURANCE');
  assert.equal(decision.ready, false);
  assert.ok(decision.blockers.includes('BASELINE_MODEL_NOT_SUPPORTED'));
});
