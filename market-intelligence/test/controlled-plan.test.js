import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFinalAction } from '../src/final-action-policy.js';
import { assessFundamentalRisk } from '../src/fundamental-risk.js';

const NOW = '2026-08-07T08:30:00.000Z';

test('blocked dossier keeps final action neutral but exposes a conservative controlled plan', () => {
  const dossier = {
    dossierId: 'dossier:test:controlled',
    companyId: 'company:test',
    companyName: 'Test Company',
    generatedAt: NOW,
    status: 'DRAFT_RESEARCH',
    proposedAction: 'WATCH',
    referencePrice: { value: 10, timestamp: '2026-08-05T08:30:00.000Z', currency: 'EUR' },
    evidence: [{ evidenceId: 'e1' }],
    reviewDate: null,
    readiness: { publishable: false, blockers: ['FUNDAMENTALS_REQUIRED'] },
    metrics: {
      fundamentals: { metricsReady: false },
      fundamentalRisk: { metricsReady: false, riskScore: 50, flags: [] },
      market: { readiness: { marketMetricsReady: true }, risk: { flags: [] }, liquidity: { score: 70 } },
      crossCheck: { recommendationReady: false, contradictionCount: 0 },
    },
  };
  const result = evaluateFinalAction(dossier, { now: NOW });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.marketAction, 'WATCH');
  assert.equal(result.controlledPlan?.status, 'AVAILABLE');
  assert.equal(result.controlledPlan?.level, 'INTERIM_RISK_CONTROL');
  assert.equal(result.controlledPlan?.holderAction, 'HOLD');
  assert.equal(result.controlledPlan?.nonHolderAction, 'DO_NOT_BUY');
  assert.equal(result.controlledPlan?.newBuyAllowed, false);
  assert.equal(result.controlledPlan?.sellSignalApproved, false);
});

test('extreme net margin caused by a tiny revenue base is marked non-comparable and does not create a net-margin risk flag', () => {
  const fundamentals = {
    metricsReady: true,
    annual: {
      revenue: [{ value: 1_000_000 }],
      netIncome: [{ value: -200_000_000 }],
      dilutedShares: [{ value: 50_000_000 }],
    },
    instant: {
      cash: { value: 400_000_000 },
      assets: { value: 1_000_000_000 },
      liabilities: { value: 300_000_000 },
      equity: { value: 700_000_000 },
    },
    metrics: {
      latestAnnualFreeCashFlowUSD: -50_000_000,
      dilutedSharesChangePct: 2,
    },
  };
  const risk = assessFundamentalRisk(fundamentals, 3, { companyId: 'company:test', generatedAt: NOW });
  assert.equal(risk.profitability.netMarginComparable, false);
  assert.match(risk.profitability.netMarginDisplay, /Μη συγκρίσιμο/);
  assert.equal(risk.flags.includes('SEVERE_NEGATIVE_NET_MARGIN'), false);
  assert.equal(risk.flags.includes('NEGATIVE_NET_MARGIN'), false);
});
