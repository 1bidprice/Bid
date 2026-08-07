import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFundamentalModel } from '../src/fundamental-model.js';

test('ordinary operating companies remain eligible for the generic model', () => {
  const model = classifyFundamentalModel({
    displayName: 'Virgin Galactic',
    legalName: 'Virgin Galactic Holdings, Inc.',
    sector: 'Industrials',
  });
  assert.equal(model.type, 'GENERIC_OPERATING');
  assert.equal(model.genericValuationEligible, true);
  assert.equal(model.specializedModelRequired, false);
  assert.equal(model.modelReady, true);
});

test('real-estate issuers are routed away from generic valuation', () => {
  const model = classifyFundamentalModel({
    displayName: 'PREMIA REAL ESTATE INVESTMENT COMPANY',
    sector: 'Real Estate',
  });
  assert.equal(model.type, 'REAL_ESTATE');
  assert.equal(model.genericValuationEligible, false);
  assert.equal(model.specializedModelRequired, true);
  assert.ok(model.requiredSpecializedMetrics.includes('NOI_OR_FFO'));
});

test('bank issuers are routed to a financial-institution model', () => {
  const model = classifyFundamentalModel({
    displayName: 'CrediaBank',
    legalName: 'CrediaBank S.A.',
    sector: 'Financials',
    industry: 'Banking',
  });
  assert.equal(model.type, 'FINANCIAL_INSTITUTION');
  assert.equal(model.genericValuationEligible, false);
  assert.equal(model.specializedModelRequired, true);
  assert.ok(model.requiredSpecializedMetrics.includes('CAPITAL_ADEQUACY'));
});

test('XBRL concept signatures can identify a specialized model even when issuer metadata is incomplete', () => {
  const realEstate = classifyFundamentalModel({ displayName: 'Issuer A' }, {
    concepts: ['RealEstateInvestmentPropertyAtCost', 'Assets', 'Liabilities'],
  });
  const bank = classifyFundamentalModel({ displayName: 'Issuer B' }, {
    concepts: ['LoansAndLeasesReceivableNetReportedAmount', 'Deposits', 'Assets'],
  });
  assert.equal(realEstate.type, 'REAL_ESTATE');
  assert.equal(bank.type, 'FINANCIAL_INSTITUTION');
});

test('banking XBRL signals outrank incidental real-estate balance-sheet concepts', () => {
  const model = classifyFundamentalModel({
    displayName: 'COASTAL FINANCIAL',
    legalName: 'COASTAL FINANCIAL CORP',
  }, {
    concepts: [
      'LoansAndLeasesReceivableNetReportedAmount',
      'Deposits',
      'AllowanceForCreditLossesFinancingReceivables',
      'RealEstateLoans',
      'RealEstateOwned',
      'Assets',
    ],
  });

  assert.equal(model.type, 'FINANCIAL_INSTITUTION');
  assert.equal(model.genericValuationEligible, false);
  assert.ok(model.reasonCodes.includes('FINANCIAL_XBRL_SIGNAL'));
});
