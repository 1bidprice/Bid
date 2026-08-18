import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSecFundamentalSnapshot, fetchSecCompanyFacts } from '../src/adapters/sec-companyfacts.js';

const SPCE = {
  companyId: 'company:virgin-galactic-holdings',
  legalName: 'Virgin Galactic Holdings, Inc.',
  displayName: 'Virgin Galactic',
  cik: '0001706946',
};

const CBL = {
  companyId: 'company:sec:0000910612',
  legalName: 'CBL & ASSOCIATES PROPERTIES INC',
  displayName: 'CBL & ASSOCIATES PROPERTIES',
  cik: '0000910612',
};

function annual(val, end, filed, accn, conceptFrame = null) {
  return {
    start: `${Number(end.slice(0, 4)) - 1}-01-01`,
    end,
    val,
    accn,
    fy: Number(end.slice(0, 4)),
    fp: 'FY',
    form: '10-K',
    filed,
    frame: conceptFrame,
  };
}

function instant(val, end, filed, accn, form = '10-K') {
  return { end, val, accn, fy: Number(end.slice(0, 4)), fp: form === '10-K' ? 'FY' : 'Q2', form, filed };
}

function payload() {
  return {
    facts: {
      'us-gaap': {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              annual(100_000_000, '2025-12-31', '2026-02-20', '0001-26-000001'),
              annual(80_000_000, '2024-12-31', '2025-02-20', '0001-25-000001'),
            ],
          },
        },
        NetIncomeLoss: {
          units: {
            USD: [annual(-20_000_000, '2025-12-31', '2026-02-20', '0001-26-000001')],
          },
        },
        NetCashProvidedByUsedInOperatingActivities: {
          units: {
            USD: [annual(-30_000_000, '2025-12-31', '2026-02-20', '0001-26-000001')],
          },
        },
        PaymentsToAcquirePropertyPlantAndEquipment: {
          units: {
            USD: [annual(5_000_000, '2025-12-31', '2026-02-20', '0001-26-000001')],
          },
        },
        WeightedAverageNumberOfDilutedSharesOutstanding: {
          units: {
            shares: [
              annual(50_000_000, '2025-12-31', '2026-02-20', '0001-26-000001'),
              annual(40_000_000, '2024-12-31', '2025-02-20', '0001-25-000001'),
            ],
          },
        },
        CashAndCashEquivalentsAtCarryingValue: {
          units: { USD: [instant(120_000_000, '2026-06-30', '2026-08-05', '0001-26-000099', '10-Q')] },
        },
        Assets: {
          units: { USD: [instant(500_000_000, '2026-06-30', '2026-08-05', '0001-26-000099', '10-Q')] },
        },
        Liabilities: {
          units: { USD: [instant(200_000_000, '2026-06-30', '2026-08-05', '0001-26-000099', '10-Q')] },
        },
        StockholdersEquity: {
          units: { USD: [instant(300_000_000, '2026-06-30', '2026-08-05', '0001-26-000099', '10-Q')] },
        },
      },
    },
  };
}

function cblPayload() {
  return {
    facts: {
      'us-gaap': {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              annual(16_243_000, '2025-12-31', '2026-02-27', '0002-26-000001'),
              annual(18_574_000, '2024-12-31', '2025-02-28', '0002-25-000001'),
            ],
          },
        },
        Revenues: {
          units: {
            USD: [
              annual(560_000_000, '2025-12-31', '2026-02-27', '0002-26-000001'),
              annual(535_000_000, '2024-12-31', '2025-02-28', '0002-25-000001'),
              annual(520_000_000, '2023-12-31', '2024-02-29', '0002-24-000001'),
            ],
          },
        },
        NetIncomeLoss: {
          units: { USD: [annual(135_967_000, '2025-12-31', '2026-02-27', '0002-26-000001')] },
        },
        NetCashProvidedByUsedInOperatingActivities: {
          units: { USD: [annual(205_000_000, '2025-12-31', '2026-02-27', '0002-26-000001')] },
        },
        PaymentsToAcquirePropertyPlantAndEquipment: {
          units: { USD: [annual(50_000_000, '2025-12-31', '2026-02-27', '0002-26-000001')] },
        },
        WeightedAverageNumberOfDilutedSharesOutstanding: {
          units: {
            shares: [
              annual(31_000_000, '2025-12-31', '2026-02-27', '0002-26-000001'),
              annual(31_100_000, '2024-12-31', '2025-02-28', '0002-25-000001'),
            ],
          },
        },
        CashAndCashEquivalentsAtCarryingValue: {
          units: { USD: [instant(45_000_000, '2026-06-30', '2026-08-05', '0002-26-000099', '10-Q')] },
        },
        Assets: {
          units: { USD: [instant(4_100_000_000, '2026-06-30', '2026-08-05', '0002-26-000099', '10-Q')] },
        },
        Liabilities: {
          units: { USD: [instant(2_900_000_000, '2026-06-30', '2026-08-05', '0002-26-000099', '10-Q')] },
        },
        StockholdersEquity: {
          units: { USD: [instant(1_200_000_000, '2026-06-30', '2026-08-05', '0002-26-000099', '10-Q')] },
        },
        RealEstateInvestmentPropertyAtCost: {
          units: { USD: [instant(3_500_000_000, '2026-06-30', '2026-08-05', '0002-26-000099', '10-Q')] },
        },
      },
    },
  };
}

test('SEC company facts snapshot calculates only provenance-backed annual metrics', () => {
  const snapshot = buildSecFundamentalSnapshot(payload(), SPCE, {
    generatedAt: '2026-08-06T00:00:00.000Z',
  });

  assert.equal(snapshot.model.type, 'GENERIC_OPERATING');
  assert.equal(snapshot.model.genericValuationEligible, true);
  assert.equal(snapshot.quality.revenueSelection.selectedConcept, 'RevenueFromContractWithCustomerExcludingAssessedTax');
  assert.equal(snapshot.metrics.annualRevenueGrowthPct, 25);
  assert.equal(snapshot.metrics.annualNetMarginPct, -20);
  assert.equal(snapshot.metrics.dilutedSharesChangePct, 25);
  assert.equal(snapshot.metrics.latestAnnualFreeCashFlowUSD, -35_000_000);
  assert.equal(snapshot.instant.cash.value, 120_000_000);
  assert.equal(snapshot.coverage.available, 6);
  assert.equal(snapshot.coverage.score, 100);
  assert.equal(snapshot.dataReady, true);
  assert.equal(snapshot.metricsReady, true);
  assert.equal(snapshot.annual.revenue[0].accession, '0001-26-000001');
  assert.equal(snapshot.annual.revenue[0].concept, 'RevenueFromContractWithCustomerExcludingAssessedTax');
});

test('SEC revenue policy chooses the more complete total annual revenue series and real-estate issuers fail closed on the generic model', () => {
  const snapshot = buildSecFundamentalSnapshot(cblPayload(), CBL, {
    generatedAt: '2026-08-07T12:00:00.000Z',
  });

  assert.equal(snapshot.quality.revenueSelection.policy, 'MOST_COMPLETE_CONSOLIDATED_ANNUAL_SERIES_V1');
  assert.equal(snapshot.quality.revenueSelection.selectedConcept, 'Revenues');
  assert.equal(snapshot.annual.revenue[0].value, 560_000_000);
  assert.equal(snapshot.model.type, 'REAL_ESTATE');
  assert.equal(snapshot.model.specializedModelRequired, true);
  assert.equal(snapshot.model.genericValuationEligible, false);
  assert.equal(snapshot.dataReady, true);
  assert.equal(snapshot.metricsReady, false);
  assert.equal(snapshot.metrics.annualRevenueGrowthPct, null);
  assert.equal(snapshot.metrics.annualNetMarginPct, null);
  assert.equal(snapshot.metrics.latestAnnualFreeCashFlowUSD, null);
  assert.equal(snapshot.quality.genericMetricsSuppressed, true);
});

test('SEC company facts adapter requires an identifying User-Agent', async () => {
  const result = await fetchSecCompanyFacts(SPCE, { fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal(result.snapshot, null);
  assert.ok(result.diagnostics.some((item) => item.code === 'SEC_USER_AGENT_MISSING'));
});

test('SEC company facts adapter fetches the official companyfacts endpoint', async () => {
  let requestedUrl = null;
  let requestedUserAgent = null;
  const fetchImpl = async (url, options) => {
    requestedUrl = String(url);
    requestedUserAgent = options.headers['User-Agent'];
    return { ok: true, status: 200, json: async () => payload() };
  };

  const result = await fetchSecCompanyFacts(SPCE, {
    fetchImpl,
    userAgent: 'Investor Control intelligence ops@example.com',
    generatedAt: '2026-08-06T00:00:00.000Z',
  });

  assert.match(requestedUrl, /data\.sec\.gov\/api\/xbrl\/companyfacts\/CIK0001706946\.json/);
  assert.match(requestedUserAgent, /ops@example\.com/);
  assert.equal(result.snapshot.metricsReady, true);
  assert.equal(result.diagnostics.length, 0);
});

test('SEC specialized real-estate model requirement is surfaced as an explicit diagnostic', async () => {
  const result = await fetchSecCompanyFacts(CBL, {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => cblPayload() }),
    userAgent: 'Investor Control intelligence ops@example.com',
  });
  assert.equal(result.snapshot.model.type, 'REAL_ESTATE');
  assert.equal(result.snapshot.metricsReady, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'SEC_FUNDAMENTAL_SPECIALIZED_MODEL_REQUIRED' && item.modelType === 'REAL_ESTATE'));
});
