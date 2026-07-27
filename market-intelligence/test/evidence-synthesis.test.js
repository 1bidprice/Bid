import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeEvidenceOnlyResearch } from '../src/evidence-synthesis.js';

const NOW = '2026-07-27T12:00:00.000Z';
const COMPANY = {
  companyId: 'company:virgin-galactic-holdings',
  legalName: 'Virgin Galactic Holdings, Inc.',
  displayName: 'Virgin Galactic',
  primaryListing: { exchange: 'New York Stock Exchange', symbol: 'SPCE', mic: 'XNYS' },
};

function reviewedEvidence() {
  return {
    id: 'evidence:sec:dilution',
    title: '8-K — Unregistered Sales of Equity Securities',
    notes: 'Item 3.02',
    rawText: 'The company issued new shares and disclosed unregistered sales of equity securities.',
    document: { reviewed: true, status: 'REVIEWED_TEXT' },
  };
}

test('synthesis converts reviewed dilution evidence into a grounded risk dossier draft', () => {
  const result = synthesizeEvidenceOnlyResearch({
    company: COMPANY,
    evidence: [reviewedEvidence()],
    generatedAt: NOW,
    fundamentals: {
      metrics: {
        annualRevenueGrowthPct: 5,
        annualNetMarginPct: -120,
        dilutedSharesChangePct: 35,
      },
    },
    historicalMarketMetrics: {
      returnsPct: { d60: -20 },
      relativeStrength: { excessReturnPct: -15 },
    },
    fundamentalRisk: {
      riskScore: 92,
      flags: ['SEVERE_DILUTION', 'NEGATIVE_FREE_CASH_FLOW', 'SEVERE_NEGATIVE_NET_MARGIN'],
    },
  });
  assert.equal(result.category, 'EVENT_RISK');
  assert.equal(result.proposedAction, 'CONSIDER_REDUCE');
  assert.equal(result.timeHorizon, 'WEEKS');
  assert.ok(result.thesis.length >= 80);
  assert.ok(result.thesis.includes('μεταβολή απομειωμένου αριθμού μετοχών 35%'));
  assert.ok(result.thesis.includes('δεν υποκαθιστούν τους ελέγχους τεκμηρίωσης'));
  assert.ok(result.catalysts[0].evidenceIds.includes('evidence:sec:dilution'));
  assert.ok(result.risks.length >= 2);
  assert.equal(result.reviewDate, '2026-08-26');
});

test('synthesis refuses narrative creation without reviewed evidence', () => {
  const result = synthesizeEvidenceOnlyResearch({
    company: COMPANY,
    evidence: [{ ...reviewedEvidence(), document: { reviewed: false, status: 'TEXT_TOO_SHORT' } }],
    generatedAt: NOW,
  });
  assert.equal(result.proposedAction, 'WATCH');
  assert.equal(result.thesis, null);
  assert.ok(result.blockers.includes('REVIEWED_EVIDENCE_REQUIRED'));
});
