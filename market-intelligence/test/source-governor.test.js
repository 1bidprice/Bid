import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PURPOSES,
  SOURCE_ROLES,
  buildSourcePlan,
  evaluateSourceCandidate,
  sourceGovernorSummary,
} from '../src/source-governor.js';

test('SEC is approved as primary regulatory evidence for US filings', () => {
  const decision = evaluateSourceCandidate({
    purpose: PURPOSES.OFFICIAL_DOCUMENT,
    market: 'US',
    url: 'https://www.sec.gov/Archives/edgar/data/123/filing.htm',
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.sourceRole, SOURCE_ROLES.PRIMARY_REGULATORY);
  assert.equal(decision.decisionEligible, true);
});

test('trusted publisher is corroboration evidence, not primary market data', () => {
  const corroboration = evaluateSourceCandidate({
    purpose: PURPOSES.INDEPENDENT_CORROBORATION,
    market: 'US',
    url: 'https://www.reuters.com/business/example',
    sourceName: 'Reuters',
  });
  assert.equal(corroboration.allowed, true);
  assert.equal(corroboration.sourceRole, SOURCE_ROLES.SECONDARY_INDEPENDENT);
  assert.equal(corroboration.corroborationEligible, true);
  assert.equal(corroboration.decisionEligible, false);

  const quote = evaluateSourceCandidate({
    purpose: PURPOSES.CURRENT_QUOTE,
    market: 'US',
    url: 'https://www.reuters.com/business/example',
    sourceName: 'Reuters',
  });
  assert.equal(quote.allowed, false);
});

test('unknown domains are rejected and AI cannot approve them', () => {
  const decision = evaluateSourceCandidate({
    purpose: PURPOSES.DISCOVERY,
    market: 'US',
    url: 'https://unknown.example/opinion',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.sourceRole, SOURCE_ROLES.UNKNOWN);
  assert.ok(decision.reasons.includes('SOURCE_DOMAIN_NOT_APPROVED'));

  const summary = sourceGovernorSummary();
  assert.equal(summary.runtimeAiMayProposeSources, true);
  assert.equal(summary.runtimeAiSourceSelection, false);
});

test('source plan separates official evidence from independent corroboration', () => {
  const officialPlan = buildSourcePlan({
    company: { companyId: 'company:test', country: 'GR', primaryListing: { mic: 'XATH' } },
    purpose: PURPOSES.OFFICIAL_DOCUMENT,
  });
  assert.equal(officialPlan.market, 'GR');
  assert.ok(officialPlan.requiredRoles.includes(SOURCE_ROLES.PRIMARY_EXCHANGE));
  assert.equal(officialPlan.runtimeAiMayApprove, false);
});
