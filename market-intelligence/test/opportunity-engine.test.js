import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSET_CLASS, buildInstrumentProfile } from '../src/instrument-profile.js';
import { scoreOpportunityCandidate, rankOpportunityUniverse } from '../src/opportunity-engine.js';

const verified = (score, sourceCount = 2, ageHours = 12) => ({ score, verified: true, sourceCount, ageHours });

function equityProfile(id = 'eq:quality') {
  return buildInstrumentProfile({
    instrumentId: id,
    displayName: 'Quality Equity',
    assetClass: 'EQUITY',
    primaryListing: { symbol: 'QUAL', mic: 'XNYS', exchange: 'NYSE', currency: 'USD' },
    sector: 'Industrials',
  });
}

test('multi-factor verified equity can become a SUPER_OPPORTUNITY_CANDIDATE without becoming a final BUY', () => {
  const result = scoreOpportunityCandidate({
    instrumentId: 'eq:quality',
    displayName: 'Quality Equity',
    profile: equityProfile(),
    factors: {
      valuation: verified(94, 3),
      quality: verified(91, 3),
      growth: verified(84, 2),
      momentum: verified(88, 2),
      catalyst: verified(82, 2),
      balanceSheet: verified(95, 3),
      liquidity: verified(92, 2),
      diversificationBenefit: verified(78, 2),
    },
    evidenceQualityScore: 92,
    executionQualityScore: 90,
    riskScore: 28,
    contradictionCount: 0,
    severeRiskFlags: [],
  });

  assert.equal(result.tier, 'SUPER_OPPORTUNITY_CANDIDATE');
  assert.equal(result.discoveryAction, 'DEEP_VERIFY_NOW');
  assert.equal(result.finalActionEligible, false);
  assert.ok(result.opportunityScore >= 88);
  assert.ok(result.strongPillars.length >= 4);
  assert.equal(result.blockers.length, 0);
});

test('cheap distressed equity is never called super merely because valuation is extreme', () => {
  const result = scoreOpportunityCandidate({
    instrumentId: 'eq:value-trap',
    displayName: 'Value Trap',
    profile: equityProfile('eq:value-trap'),
    factors: {
      valuation: verified(99),
      quality: verified(22),
      growth: verified(18),
      momentum: verified(30),
      catalyst: verified(55),
      balanceSheet: verified(12),
      liquidity: verified(70),
      diversificationBenefit: verified(60),
    },
    evidenceQualityScore: 90,
    executionQualityScore: 72,
    riskScore: 88,
    contradictionCount: 0,
    severeRiskFlags: ['DISTRESS_OR_SOLVENCY_RISK'],
  });

  assert.notEqual(result.tier, 'SUPER_OPPORTUNITY_CANDIDATE');
  assert.ok(result.blockers.includes('RISK_TOO_HIGH_FOR_SUPER_TIER'));
  assert.ok(result.blockers.includes('SEVERE_RISK_FLAG'));
  assert.ok(result.weakPillars.includes('balanceSheet'));
});

test('option cannot enter super tier without verified strategy context and defined risk', () => {
  const profile = buildInstrumentProfile({
    instrumentId: 'opt:test',
    displayName: 'Index Call Spread',
    assetClass: 'OPTION',
    strike: 100,
  });
  assert.equal(profile.assetClass, ASSET_CLASS.OPTION);

  const candidate = {
    instrumentId: 'opt:test',
    profile,
    factors: {
      strategyEdge: verified(96),
      volatilityEdge: verified(92),
      payoffAsymmetry: verified(95),
      catalyst: verified(85),
      liquidity: verified(88),
      riskDefinition: verified(90),
    },
    evidenceQualityScore: 93,
    executionQualityScore: 86,
    riskScore: 42,
    severeRiskFlags: [],
  };

  const blocked = scoreOpportunityCandidate(candidate);
  assert.notEqual(blocked.tier, 'SUPER_OPPORTUNITY_CANDIDATE');
  assert.ok(blocked.blockers.includes('STRATEGY_CONTEXT_REQUIRED'));

  const verifiedStrategy = scoreOpportunityCandidate({ ...candidate, strategyContextVerified: true });
  assert.equal(verifiedStrategy.tier, 'SUPER_OPPORTUNITY_CANDIDATE');
});

test('cross-asset universe ranks each instrument after asset-specific scoring', () => {
  const equity = {
    instrumentId: 'eq:one',
    displayName: 'Equity One',
    profile: equityProfile('eq:one'),
    factors: {
      valuation: verified(92), quality: verified(90), growth: verified(86), momentum: verified(89), catalyst: verified(84), balanceSheet: verified(93), liquidity: verified(90), diversificationBenefit: verified(80),
    },
    evidenceQualityScore: 91,
    executionQualityScore: 89,
    riskScore: 30,
  };

  const bondProfile = buildInstrumentProfile({ instrumentId: 'bond:one', displayName: 'Bond One', assetClass: 'BOND', maturityDate: '2032-01-01' });
  const bond = {
    instrumentId: 'bond:one',
    displayName: 'Bond One',
    profile: bondProfile,
    factors: {
      carry: verified(85), relativeValue: verified(88), creditQuality: verified(92), creditMomentum: verified(80), durationFit: verified(78), catalyst: verified(70), liquidity: verified(82), diversificationBenefit: verified(90),
    },
    evidenceQualityScore: 88,
    executionQualityScore: 80,
    riskScore: 24,
  };

  const ranked = rankOpportunityUniverse([bond, equity], { generatedAt: '2026-08-09T10:00:00.000Z' });
  assert.equal(ranked.scannedCount, 2);
  assert.equal(ranked.items.length, 2);
  assert.equal(ranked.items[0].rank, 1);
  assert.ok(ranked.items.every((item) => item.finalActionEligible === false));
  assert.ok(ranked.items.every((item) => ['EQUITY', 'BOND'].includes(item.assetClass)));
});
