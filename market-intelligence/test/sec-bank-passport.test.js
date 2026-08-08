import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSecBankPassport } from '../src/sec-bank-passport.js';
import { buildSecFundamentalSnapshot } from '../src/adapters/sec-companyfacts.js';
import { assessFundamentalRisk } from '../src/fundamental-risk.js';

const company = {
  companyId: 'company:sec:coastal-fixture',
  displayName: 'COASTAL FINANCIAL',
  legalName: 'COASTAL FINANCIAL CORP',
  cik: '0001437958',
};

function instant(val, end = '2026-03-31', filed = '2026-05-08', accn = '0001437958-26-000039') {
  return { end, val, accn, fy: 2026, fp: 'Q1', form: '10-Q', filed };
}

function annual(val, conceptEnd = '2025-12-31') {
  return {
    start: '2025-01-01',
    end: conceptEnd,
    val,
    accn: '0001437958-26-000010',
    fy: 2025,
    fp: 'FY',
    form: '10-K',
    filed: '2026-03-02',
  };
}

function bankPayload() {
  return {
    facts: {
      'us-gaap': {
        Revenues: { units: { USD: [annual(420_000_000), { ...annual(350_000_000, '2024-12-31'), start: '2024-01-01', fy: 2024, filed: '2025-03-03', accn: '0001437958-25-000010' }] } },
        NetIncomeLoss: { units: { USD: [annual(46_993_000)] } },
        NetCashProvidedByUsedInOperatingActivities: { units: { USD: [annual(100_000_000)] } },
        WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [annual(15_350_000)] } },
        CashAndCashEquivalentsAtCarryingValue: { units: { USD: [instant(1_495_500_000)] } },
        Assets: { units: { USD: [instant(5_660_000_000)] } },
        Liabilities: { units: { USD: [instant(5_160_000_000)] } },
        StockholdersEquity: { units: { USD: [instant(500_000_000)] } },
        LoansAndLeasesReceivableNetReportedAmount: { units: { USD: [instant(3_860_000_000)] } },
        Deposits: { units: { USD: [instant(5_040_000_000)] } },
        AllowanceForCreditLossesFinancingReceivables: { units: { USD: [instant(172_400_000)] } },
        FinancingReceivableRecordedInvestmentNonaccrualStatus: { units: { USD: [instant(18_000_000)] } },
        RealEstateLoans: { units: { USD: [instant(1_200_000_000)] } },
      },
    },
  };
}

test('SEC Bank Passport calculates bank-specific ratios from provenance-backed XBRL facts', () => {
  const base = buildSecFundamentalSnapshot(bankPayload(), company, { generatedAt: '2026-05-08T12:00:00.000Z' });
  const bank = base.specializedModels.bank;

  assert.equal(base.model.type, 'FINANCIAL_INSTITUTION');
  assert.equal(base.model.specializedModelImplemented, true);
  assert.equal(bank.status, 'BANK_MODEL_PARTIAL');
  assert.equal(bank.coverage.coreDataReady, true);
  assert.equal(bank.coverage.assetQualityReady, true);
  assert.equal(bank.coverage.regulatoryCapitalReady, false);
  assert.equal(bank.metrics.loanToDepositPct, 76.59);
  assert.equal(bank.metrics.allowanceToLoansPct, 4.47);
  assert.equal(bank.metrics.nonaccrualToLoansPct, 0.47);
  assert.equal(bank.metrics.equityToAssetsPct, 8.83);
  assert.ok(bank.blockers.includes('BANK_REGULATORY_CAPITAL_REQUIRED'));
  assert.equal(base.metricsReady, false);
});

test('regulatory capital cannot be inferred from equity/assets but reviewed capital inputs can complete the bank passport', () => {
  const base = {
    companyId: company.companyId,
    companyName: company.displayName,
    generatedAt: '2026-05-08T12:00:00.000Z',
    sourceUrl: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0001437958.json',
    annual: {
      netIncome: [{ concept: 'NetIncomeLoss', unit: 'USD', value: 46_993_000, end: '2025-12-31', filed: '2026-03-02', accession: 'x', form: '10-K' }],
      dilutedShares: [{ concept: 'WeightedAverageNumberOfDilutedSharesOutstanding', unit: 'shares', value: 15_350_000, end: '2025-12-31', filed: '2026-03-02', accession: 'x', form: '10-K' }],
    },
    instant: {
      assets: { unit: 'USD', value: 5_660_000_000 },
      equity: { unit: 'USD', value: 500_000_000 },
    },
  };
  const capital = {
    commonEquityTier1Pct: 12.08,
    tier1CapitalPct: 12.17,
    totalCapitalPct: 14.54,
    sourceRole: 'REVIEWED_SEC_FILING_TABLE',
    evidenceId: 'evidence:sec:0001437958-26-000039',
    accession: '0001437958-26-000039',
    form: '10-Q',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1437958/000143795826000039/cofs-20260331.htm',
  };
  const bank = buildSecBankPassport(bankPayload(), base, company, { regulatoryCapital: capital });

  assert.equal(bank.coverage.regulatoryCapitalReady, true);
  assert.equal(bank.decisionReady, true);
  assert.equal(bank.modelReady, true);
  assert.equal(bank.status, 'DECISION_MODEL_READY');
  assert.equal(bank.regulatoryCapital.accession, '0001437958-26-000039');
  assert.equal(bank.accountingPolicy.regulatoryCapitalMayBeInferredFromEquityRatio, false);
});

test('fundamental risk exposes bank valuation separately and never revives generic P/S or cash-runway logic', () => {
  const snapshot = buildSecFundamentalSnapshot(bankPayload(), company, { generatedAt: '2026-05-08T12:00:00.000Z' });
  const risk = assessFundamentalRisk(snapshot, 44.67, { companyId: company.companyId, currency: 'USD' });

  assert.equal(risk.valuation.priceToSales, null);
  assert.equal(risk.valuation.priceToBook, null);
  assert.equal(risk.balanceSheet.cashRunwayYears, null);
  assert.equal(risk.riskScore, null);
  assert.equal(risk.specializedAnalysis.type, 'BANK');
  assert.equal(risk.specializedAnalysis.status, 'BANK_MODEL_PARTIAL');
  assert.equal(risk.specializedAnalysis.decisionReady, false);
  assert.ok(risk.specializedAnalysis.valuation.priceToBook > 1);
  assert.ok(risk.specializedAnalysis.blockers.includes('BANK_REGULATORY_CAPITAL_REQUIRED'));
});
