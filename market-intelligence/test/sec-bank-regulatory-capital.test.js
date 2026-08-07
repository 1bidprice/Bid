import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSecBankRegulatoryCapitalFromEvidence } from '../src/sec-bank-regulatory-capital.js';
import { applyReviewedRegulatoryCapitalToBankPassport, reviewedRegulatoryCapitalReady } from '../src/sec-bank-passport.js';

function reviewedRecord(text, overrides = {}) {
  return {
    id: 'evidence:sec:0001437958-26-000039',
    sourceType: 'REGULATORY_FILING',
    sourceName: 'SEC EDGAR',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1437958/000143795826000039/cofs-20260331.htm',
    sourceDocumentId: '0001437958-26-000039',
    publishedAt: '2026-05-08T12:00:00.000Z',
    retrievedAt: '2026-08-07T12:00:00.000Z',
    title: '10-Q filing — COASTAL FINANCIAL',
    rawText: `${text}\n${'Reviewed filing context '.repeat(30)}`,
    isPrimarySource: true,
    document: {
      reviewed: true,
      status: 'REVIEWED_TEXT',
      fetchedAt: '2026-08-07T12:00:00.000Z',
      textLength: 2000,
    },
    ...overrides,
  };
}

test('reviewed SEC capital table extracts actual CET1, Tier-1 and Total ratios from one filing', () => {
  const record = reviewedRecord(`
Capital ratios and regulatory requirements
Minimum required common equity tier 1 capital ratio 4.50%
Common equity tier 1 capital ratio 12.08% 7.00% 6.50%
Minimum required Tier 1 capital ratio 6.00%
Tier 1 capital ratio 12.17% 8.50% 8.00%
Minimum required total capital ratio 8.00%
Total capital ratio 14.54% 10.50% 10.00%
`);

  const result = extractSecBankRegulatoryCapitalFromEvidence([record]);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.capital.commonEquityTier1Pct, 12.08);
  assert.equal(result.capital.tier1CapitalPct, 12.17);
  assert.equal(result.capital.totalCapitalPct, 14.54);
  assert.equal(result.capital.sourceRole, 'REVIEWED_SEC_FILING_TABLE');
  assert.equal(result.capital.accession, '0001437958-26-000039');
  assert.equal(result.capital.validation.allThreeRatiosFromSameFiling, true);
  assert.equal(reviewedRegulatoryCapitalReady(result.capital), true);
});

test('unreviewed filings can never unlock regulatory capital', () => {
  const record = reviewedRecord(`
Common equity tier 1 capital ratio 12.08%
Tier 1 capital ratio 12.17%
Total capital ratio 14.54%
`, { document: { reviewed: false, status: 'TEXT_TOO_SHORT' } });
  const result = extractSecBankRegulatoryCapitalFromEvidence([record]);
  assert.equal(result.capital, null);
  assert.ok(result.diagnostics.some((item) => item.code === 'SEC_BANK_REVIEWED_10K_10Q_REQUIRED'));
});

test('inconsistent capital ordering is rejected instead of normalized or guessed', () => {
  const record = reviewedRecord(`
Common equity tier 1 capital ratio 14.00%
Tier 1 capital ratio 12.00%
Total capital ratio 13.00%
`);
  const result = extractSecBankRegulatoryCapitalFromEvidence([record]);
  assert.equal(result.capital, null);
  assert.ok(result.diagnostics.some((item) => item.code === 'SEC_BANK_REGULATORY_CAPITAL_NOT_VERIFIED_IN_FILING'));
});

test('bank passport becomes decision-model ready only with reviewed same-filing capital evidence', () => {
  const partial = {
    format: 'investor-control-sec-bank-passport',
    version: 1,
    coverage: { coreDataReady: true, assetQualityReady: true, regulatoryCapitalReady: false },
    blockers: ['BANK_REGULATORY_CAPITAL_REQUIRED'],
    accountingPolicy: { regulatoryCapitalMayBeInferredFromEquityRatio: false },
  };
  const record = reviewedRecord(`
Common equity tier 1 capital ratio 12.08%
Tier 1 capital ratio 12.17%
Total capital ratio 14.54%
`);
  const capital = extractSecBankRegulatoryCapitalFromEvidence([record]).capital;
  const complete = applyReviewedRegulatoryCapitalToBankPassport(partial, capital);

  assert.equal(complete.coverage.regulatoryCapitalReady, true);
  assert.equal(complete.status, 'DECISION_MODEL_READY');
  assert.equal(complete.modelReady, true);
  assert.equal(complete.decisionReady, true);
  assert.deepEqual(complete.blockers, []);
});
